/**
 * Deterministic scripted LLM adapter for the team-agent example.
 *
 * Plain ESM so the same file boots in src mode (tsx) and lib mode (plain
 * Node type stripping): the team-agent profile composition registers it as
 * the only model route. Every response is decided from the visible message
 * history alone — no state is shared with the driver — so a rerun of the
 * scenario produces byte-identical model-visible transcripts.
 *
 * The scripted cast:
 * - the leader delegates WRITER_TASK to `writer`, which warms up with a read,
 *   calls the approval-gated `write` tool, verifies the file, and settles;
 * - the leader delegates SENTRY_TASK to `sentry` when the writer settles;
 *   sentry warms up with a read and suspends on its approval-gated
 *   `todo_write` (the boot-1 crash point — the leader declines to decide);
 * - after the restart, the leader lists teammates, discovers its stale
 *   decision no longer resolves, approves the fresh request once sentry is
 *   re-driven, and the team settles.
 *
 * Each child keeps at least one full model step ahead of the leader's current
 * turn tail before it emits a leader-visible event (its warm-up read, and for
 * the writer a post-write verification read); that margin is what keeps the
 * leader's turn boundaries — and therefore the goldens — deterministic.
 *
 * @module team-mock-llm
 */
import { CallId, LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

const HIGH = ReasoningEffortId('high')
const OFF = ReasoningEffortId('off')

const WRITER_PROMPT = 'WRITER_TASK: create notes/hello.txt with the greeting.'
const SENTRY_PROMPT = 'SENTRY_TASK: record the watch with todo_write.'
const WATCH_TODOS = [{ content: 'Watch the inbox', status: 'in_progress' }]
const WRITER_WARMUP = '.dsh/teammates/writer.md'
const SENTRY_WARMUP = '.dsh/teammates/sentry.md'

/** Join the text content of one message. */
function textOf(message) {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * The newest tool call whose result has been delivered: the last assistant
 * tool-call block (in message order) that a later user message answers.
 * @returns the parsed call name/arguments and the rendered result, or undefined.
 */
function lastCompletedToolCall(messages) {
  const answered = new Set()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool-result') answered.add(block.toolCallId)
    }
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'assistant') continue
    for (let j = message.content.length - 1; j >= 0; j -= 1) {
      const block = message.content[j]
      if (block.type !== 'tool-call' || !answered.has(block.id)) continue
      let argumentsValue = {}
      try {
        argumentsValue = JSON.parse(block.arguments)
      } catch {
        argumentsValue = {}
      }
      const result = messages
        .flatMap(m => m.content)
        .find(candidate => candidate.type === 'tool-result' && candidate.toolCallId === block.id)
      const resultText = result === undefined
        ? ''
        : result.content
          .filter(candidate => candidate.type === 'text')
          .map(candidate => candidate.text)
          .join('')
      return { name: block.name, arguments: argumentsValue, resultText, isError: result?.isError === true }
    }
  }
  return undefined
}

/** The message index of the newest delivered user-side message carrying the marker, or -1. */
function markerIndex(messages, marker) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role === 'user' && message.source.kind !== 'tool' && textOf(message).includes(marker)) {
      return i
    }
  }
  return -1
}

/** Whether any already-delivered user-side message carries the marker. */
function historyHasMarker(messages, marker) {
  return markerIndex(messages, marker) >= 0
}

/** Whether the leader issued a `team_control` call carrying one request id (a failed attempt still counts). */
function decidedRequestId(messages, requestId) {
  return messages.some(message => message.role === 'assistant'
    && message.content.some(block => block.type === 'tool-call' && block.name === 'team_control'
      && (() => {
        try {
          return JSON.parse(block.arguments).request_id === requestId
        } catch {
          return false
        }
      })()))
}

/** Every approval request the leader has not decided yet, newest first. */
function pendingApprovals(messages) {
  const pending = []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'user' || message.source.kind === 'tool') continue
    const match = textOf(message).match(/requests approval to run "([^"]+)" \(request ([0-9a-f-]+)\)/)
    if (match === null || match[1] === undefined || match[2] === undefined) continue
    if (decidedRequestId(messages, match[2])) continue
    pending.push({ toolName: match[1], requestId: match[2] })
  }
  return pending
}

/** Whether any assistant tool call after the message at `afterIndex` carries the predicate. */
function assistantCallAfter(messages, afterIndex, test) {
  return messages.some((message, i) => i > afterIndex
    && message.role === 'assistant'
    && message.content.some(block => block.type === 'tool-call' && test(block)))
}

/** Whether the leader delegated to the teammate at or after the message at `afterIndex`. */
function delegatedAfter(messages, afterIndex, teammateId) {
  return assistantCallAfter(messages, afterIndex, block => block.name === 'delegate_to_teammate'
    && (() => {
      try {
        return JSON.parse(block.arguments).teammate_id === teammateId
      } catch {
        return false
      }
    })())
}

/** Whether the leader made any tool call after the TEAM_RESUME marker. */
function actedSinceResume(messages) {
  const index = markerIndex(messages, 'TEAM_RESUME')
  if (index < 0) return false
  return assistantCallAfter(messages, index, block => true)
}

/** The nth tool-call block named `toolName` in the visible history, 1-based. */
function toolCallOrdinal(messages, toolName) {
  let n = 0
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of message.content) {
      if (block.type === 'tool-call' && block.name === toolName) n += 1
    }
  }
  return n + 1
}

/**
 * Script the leader's response for one visible history. The leader serializes
 * the team: it addresses the writer's approval first, dispatches sentry only
 * when the writer settles, and declines to decide the `todo_write` request
 * until the restart marker says the pre-restart window is over.
 */
function scriptLeader(messages, lastCall, toolResponse) {
  const pending = pendingApprovals(messages)
  const resumeIndex = markerIndex(messages, 'TEAM_RESUME')
  const resumed = resumeIndex >= 0

  if (pending.length > 0) {
    // First leader response of the resume turn: survey the team before acting.
    if (resumed && !actedSinceResume(messages)) {
      return toolResponse('list_teammates', {})
    }
    // Pre-restart, the leader never decides the watch's `todo_write` request;
    // it decides everything else, so a declined request only ever coexists
    // with already-decided ones.
    const actionable = resumed
      ? pending[0]
      : pending.find(request => request.toolName !== 'todo_write')
    if (actionable === undefined) {
      return { final: 'Sentry request noted; it will be reviewed after the restart.' }
    }
    return toolResponse('team_control', {
      action: 'decide',
      request_id: actionable.requestId,
      decision: 'allow_once',
    })
  }

  // Post-restart, pre-restart notices were already handled in boot one, so
  // only a notice arriving after the resume marker is actionable.
  let noticeIndex = markerIndex(messages, 'finished and will do no further work')
  if (noticeIndex >= 0 && resumed && noticeIndex <= resumeIndex) noticeIndex = -1
  if (noticeIndex >= 0) {
    const notice = textOf(messages[noticeIndex])
    if (notice.includes('Watch re-recorded.')) {
      return { final: 'Team task complete.' }
    }
    if (notice.includes('File written.')) {
      if (!delegatedAfter(messages, noticeIndex, 'sentry')) {
        return toolResponse('delegate_to_teammate', {
          teammate_id: 'sentry',
          action: 'run',
          prompt: SENTRY_PROMPT,
        })
      }
      return { final: 'Both teammates dispatched.' }
    }
    return { final: 'Teammate finished; noted.' }
  }

  if (resumed) {
    if (lastCall?.name === 'team_control') {
      // The stale pre-restart id is rejected as `Error: Unknown control request`
      // inside a normal (non-error) tool result, so the outcome is read from
      // the rendered text.
      const stale = lastCall.resultText.includes('Error: Unknown control request')
      return stale
        ? { final: 'The pre-restart request no longer resolves; a fresh one will arrive.' }
        : { final: 'Fresh request approved.' }
    }
    return { final: 'Nothing pending.' }
  }

  if (historyHasMarker(messages, 'TEAM_SCENARIO') && !delegatedAfter(messages, -1, 'writer')) {
    return toolResponse('delegate_to_teammate', {
      teammate_id: 'writer',
      action: 'run',
      prompt: WRITER_PROMPT,
    })
  }

  return { final: 'Standing by for teammates.' }
}

/**
 * Script the writer: warm-up read, the approval-gated write with the schema's
 * `file_path` argument, a verification read, then settle.
 */
function scriptWriter(lastCall, toolResponse) {
  if (lastCall?.name === 'read' && !lastCall.isError && lastCall.arguments?.file_path === WRITER_WARMUP) {
    return toolResponse('write', { file_path: 'notes/hello.txt', content: 'hello from writer\n' })
  }
  if (lastCall?.name === 'write' && !lastCall.isError) {
    return toolResponse('read', { file_path: 'notes/hello.txt' })
  }
  if (lastCall?.name === 'read' && !lastCall.isError && lastCall.arguments?.file_path === 'notes/hello.txt') {
    return { final: 'File written.' }
  }
  return toolResponse('read', { file_path: WRITER_WARMUP })
}

/**
 * Script sentry. Pre-restart: warm-up read, then the approval-gated
 * `todo_write` (the crash point). After the re-drive: the repaired call's
 * `TOOL_OUTCOME_UNKNOWN` result falls through to the `skill` probe, which the
 * member guard denies; the fresh `todo_write` then decides and settles.
 */
function scriptSentry(messages, lastCall, toolResponse) {
  if (!historyHasMarker(messages, 'SENTRY_FOLLOWUP')) {
    if (lastCall?.name === 'read' && !lastCall.isError && lastCall.arguments?.file_path === SENTRY_WARMUP) {
      return toolResponse('todo_write', { todos: WATCH_TODOS })
    }
    return toolResponse('read', { file_path: SENTRY_WARMUP })
  }
  if (lastCall?.name === 'skill') {
    return toolResponse('todo_write', { todos: WATCH_TODOS })
  }
  if (lastCall?.name === 'todo_write' && !lastCall.isError) {
    return toolResponse('read', { file_path: SENTRY_WARMUP })
  }
  if (lastCall?.name === 'read' && !lastCall.isError) {
    return { final: 'Watch re-recorded.' }
  }
  return toolResponse('skill', { name: 'beta' })
}

/**
 * Script the response for one visible history. Tool responses carry a call id
 * unique within the session history: the same scripted tool may be called in
 * later turns (sentry's re-record), and a provider-valid transcript needs
 * distinct call ids per occurrence.
 */
function script(options) {
  const messages = options.messages
  const lastCall = lastCompletedToolCall(messages)
  const toolResponse = (tool, args) => ({
    callId: CallId(`team-mock-${tool}-call-${toolCallOrdinal(messages, tool)}`),
    tool,
    arguments: args,
  })
  // Leader markers first: the scenario text names both child tasks, so the
  // leader's own history carries `WRITER_TASK` / `SENTRY_TASK` in its
  // delegation arguments. A child history never carries a TEAM_* marker.
  if (historyHasMarker(messages, 'TEAM_SCENARIO') || historyHasMarker(messages, 'TEAM_RESUME')) {
    return scriptLeader(messages, lastCall, toolResponse)
  }
  if (historyHasMarker(messages, 'WRITER_TASK')) return scriptWriter(lastCall, toolResponse)
  if (historyHasMarker(messages, 'SENTRY_TASK')) return scriptSentry(messages, lastCall, toolResponse)
  return { final: 'No action.' }
}

/** Keyless team-agent adapter: the scripted cast above, streamed as canonical chunks. */
class TeamMockAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: OFF, name: 'Off' },
          { id: HIGH, name: 'High' },
        ],
        defaultEffort: HIGH,
      },
    }
  }

  async * stream(options) {
    const decision = script(options)
    if (decision.tool !== undefined) {
      const argumentsJson = JSON.stringify(decision.arguments)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: decision.callId, name: decision.tool, argumentsDelta: argumentsJson }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: decision.callId, name: decision.tool, arguments: argumentsJson } }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: decision.final }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: decision.final } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'team-mock-llm'
export const inject = ['llm']

/** Register the keyless `team-mock` adapter. */
export function apply(ctx) {
  ctx.llm.registerAdapter(['team-mock'], new TeamMockAdapter())
}
