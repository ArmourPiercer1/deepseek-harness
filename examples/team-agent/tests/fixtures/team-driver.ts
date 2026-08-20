#!/usr/bin/env node
/**
 * Keyless team-agent snapshot driver: one leader delegating to two
 * approval-gated teammates across a crash and cold recovery.
 *
 * The driver runs as two phases over the same `$DSH_HOME`, each booting the
 * SHIPPED profile composition — the `dsh-base` and `dsh-web-app` bundles
 * with the `team` agent preset as the composition entry — in its own process:
 *
 * - `DSH_TEAM_DRIVER_PHASE=crash` runs delegation and the approval flow, then
 *   flushes the leader and the suspended sentry and exits the process HARD
 *   (no fiber dispose), so sentry's approval-gated call is left pending in
 *   the durable log. The crash record carries the child session ids.
 * - `DSH_TEAM_DRIVER_PHASE=recover` re-boots from the same home, resumes the
 *   leader (its `agent/created` re-points team-local discovery at the
 *   workspace), discovers the stale decision no longer resolves, cold-resumes
 *   sentry through `subagents.followup` (the suspended call repairs to
 *   `TOOL_OUTCOME_UNKNOWN`), and lets the fresh request approve and settle.
 *
 * The child ids cross the crash as `DSH_TEAM_CHILD_SESSIONS` (JSON) set by
 * the caller from the crash record. The only model is `team-mock-llm.mjs`
 * (copied beside the generated profile patch layer); the mock scripts every
 * response from visible history, so the persisted session transcripts are
 * deterministic. Each phase prints one JSONL result record; the snapshot
 * test asserts on the persisted session logs, not on stdout beyond that.
 */

import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  boot,
  healProfilesModuleFallback,
  initProfile,
  installFailLoud,
  loadProfile,
  loadOptionalPatches,
  PROFILE_PATCH_FILENAME,
} from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'

const NAME = 'team-agent-test-driver'
const PROFILE_NAME = 'team-agent'
const LEADER_ID = SessionId('team-agent-leader')
const LEADER_ROUTE = { provider: 'team-mock', model: 'team-mock' }

const fixtureDir = dirname(fileURLToPath(import.meta.url))
const exampleDir = resolve(fixtureDir, '..', '..')
const repoRoot = resolve(exampleDir, '..', '..')
const INSTALL_ANCHOR = join(repoRoot, 'apps', 'cli', 'package.json')
const SHIPPED_PRESET_ROOT = join(repoRoot, 'apps', 'cli', 'config', 'agent-presets') + (process.platform === 'win32' ? '\\' : '/')
const MOCK_SOURCE = join(exampleDir, 'team-mock-llm.mjs')
const TEAMMATE_SOURCE_DIR = join(exampleDir, 'tests', 'fixtures', 'teammates')

/** The scenario markers shared with the scripted mock. */
const MARKERS = {
  scenario: 'TEAM_SCENARIO: delegate WRITER_TASK to writer, then SENTRY_TASK to sentry.',
  resume: 'TEAM_RESUME: the harness restarted. Review any pending team request, then finish.',
  sentryFollowup: 'SENTRY_FOLLOWUP: the harness restarted; re-record the watch.',
} as const

interface DriverState {
  memberChildIds: Map<string, string>
  leaderTurns: number
  controlRequests: Set<string>
  writerFinished: boolean
  sentryFinished: boolean
}

function newState(): DriverState {
  return {
    memberChildIds: new Map(),
    leaderTurns: 0,
    controlRequests: new Set(),
    writerFinished: false,
    sentryFinished: false,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => { setTimeout(resolveDelay, ms) })
}

/** Whether the agent is quiescent right now (short race, no unbounded wait). */
async function isIdle(agent: Agent): Promise<boolean> {
  return await Promise.race([
    agent.whenIdle().then(() => true),
    delay(50).then(() => false),
  ])
}

/** Poll `condition` until true or the budget expires. */
async function waitFor(label: string, budgetMs: number, condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    if (await condition()) return
    if (Date.now() >= deadline) {
      throw new Error(`${NAME}: timed out waiting for ${label}`)
    }
    await delay(100)
  }
}

/**
 * Observe the canonical events of every session, recording scenario facts.
 * `team/member-bound` is a seed event (constructor seeds do not emit
 * `session/event`), so the member-to-child-session map is captured from
 * `team/control-request` instead: it is appended mid-turn and carries the
 * member id, with the child session as its subject.
 */
function observe(ctx: Context, state: DriverState, leaderId: string): () => void {
  return ctx.on('session/event', (session, event) => {
    if (event.type === 'team/control-request') {
      state.controlRequests.add(event.data.memberId)
      state.memberChildIds.set(event.data.memberId, session.id)
      return
    }
    if (session.id === leaderId && event.type === 'turn/end') {
      state.leaderTurns += 1
      return
    }
    if (event.type !== 'assistant/message') return
    const text = event.data.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    if (text === 'File written.') state.writerFinished = true
    if (text === 'Watch re-recorded.') state.sentryFinished = true
  })
}

/** Generate the profile user patch layer (the keyless test composition). */
function userPatch(home: string): string {
  return [
    '# team-agent user patch layer: the keyless test composition over the',
    '# shipped base + web-app bundles. `agent-presets` makes the shipped `team`',
    '# preset the composition entry; the mock adapter file is copied beside this',
    '# profile by the driver, so it is addressed relatively.',
    '',
    '- id: agent-presets',
    '  config:',
    '    default: team',
    '    includeUserRoot: false',
    '    roots:',
    `      - path: ${SHIPPED_PRESET_ROOT}`,
    '        trust: system',
    '',
    '- id: llm-deepseek',
    '  disabled: true',
    '',
    '- id: session-title-llm',
    '  disabled: true',
    '',
    '- id: session-telemetry-otel',
    '  disabled: true',
    '',
    '- id: webserver',
    '  disabled: true',
    '',
    '- id: web-runtime',
    '  disabled: true',
    '',
    '- id: modules',
    '  disabled: true',
    '',
    '- id: connection',
    '  disabled: true',
    '',
    '- id: client-hmr',
    '  disabled: true',
    '',
    '- id: directory-picker',
    '  disabled: true',
    '',
    '- id: settings',
    '  config:',
    `    path: ${join(home, 'settings.yaml')}`,
    '    watch: false',
    '',
    '# Plaintext persistence so the snapshot test reads the durable logs',
    '# without a decoder; the shipped default is zstd.',
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${join(home, 'sessions')}`,
    '    compression: none',
    '',
    '- insert:',
    '    - id: team-mock-llm',
    '      name: ./team-mock-llm.mjs',
    '',
    '# The api-proxy injects `directoryPicker`; the browse variant supplies it',
    '# without the disabled webserver.',
    '- insert:',
    '    - id: directory-picker-browse',
    "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
    '    - id: ui-directory-picker-browse',
    "      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'",
    '',
  ].join('\n')
}

/**
 * Boot one profile generation of the team-agent composition: base + web-app
 * bundles, the user patch layer, and the team preset as composition entry.
 * The generated workspace fixtures (home-member under $DSH_HOME, writer and
 * sentry under workspace-a) are written beside the run cwd.
 */
async function bootProfile(home: string): Promise<Context> {
  healProfilesModuleFallback(INSTALL_ANCHOR)
  const profileDir = join(home, 'profiles', PROFILE_NAME)
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(home, 'settings.yaml'), '')
  initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  writeFileSync(join(profileDir, PROFILE_PATCH_FILENAME), userPatch(home))
  cpSync(MOCK_SOURCE, join(profileDir, 'team-mock-llm.mjs'))
  // Home defines a leader plus `home-member`. The leader session's cwd
  // (workspace-a) self-defines its own leader, `writer`, and `sentry`,
  // shadowing the home set once the agent/created event re-points team-local
  // discovery at it. Each loaded set must carry exactly one leader.
  const homeTeammates = join(home, 'teammates')
  mkdirSync(homeTeammates, { recursive: true })
  for (const file of ['home-leader.md', 'home-member.md']) {
    cpSync(join(TEAMMATE_SOURCE_DIR, file), join(homeTeammates, file))
  }
  const workspaceA = join(process.cwd(), 'workspace-a')
  const workspaceTeammates = join(workspaceA, '.dsh', 'teammates')
  mkdirSync(workspaceTeammates, { recursive: true })
  for (const file of ['team-leader.md', 'writer.md', 'sentry.md']) {
    cpSync(join(TEAMMATE_SOURCE_DIR, file), join(workspaceTeammates, file))
  }

  const profile = loadProfile(NAME, PROFILE_NAME, INSTALL_ANCHOR, home)
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const homePatches = loadOptionalPatches(NAME, join(home, PROFILE_PATCH_FILENAME)) ?? []
  const patches = [
    ...bundlePatches,
    ...profile.patches,
    ...homePatches,
  ]
  return await boot(
    NAME,
    join(profileDir, 'cordis.yml'),
    structuredClone(patches),
    (hostCtx) => {
      // Launcher facts the web-app rows inject: an empty command line and a
      // no-op exit request. Provided directly so the driver imports no
      // package beyond the declared example set.
      hostCtx.provide('cmdlineArgs', { get: () => Object.freeze([]) })
      hostCtx.provide('appExit', (code: number) => { process.exitCode = code })
    },
  )
}

/** Mount the team preset into one agent's scoped world. */
function mountTeamSetup(ctx: Context) {
  return async (agentCtx: Context): Promise<void> => {
    await ctx.get('agentPresets')!.mount(agentCtx)
  }
}

/** Drive one agent task and wait for the turn to complete. */
async function drive(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await waitFor(`agent ${agent.id} idle`, 25_000, () => isIdle(agent))
}

/**
 * Wait until the preset's team registry lists every id. The agent/created
 * re-point reload is asynchronous; delegation must not race it.
 */
async function waitForTeamMembers(ctx: Context, agent: Agent, ids: readonly string[]): Promise<void> {
  const team = ctx.get('agentPresets')!.serviceFor(agent, 'team')
  if (team === undefined) throw new Error(`${NAME}: the team preset did not mount the team service`)
  await waitFor(`team registry to list ${ids.join(', ')}`, 25_000, async () => {
    const listed = team.list().map(member => member.id as string)
    return ids.every(id => listed.includes(id))
  })
}

/** Validate the `DSH_TEAM_DRIVER_PHASE` selector. */
function driverPhase(): 'crash' | 'recover' {
  const raw = process.env.DSH_TEAM_DRIVER_PHASE
  if (raw === 'crash' || raw === 'recover') return raw
  throw new Error(`${NAME}: DSH_TEAM_DRIVER_PHASE must be 'crash' or 'recover'`)
}

/** The child session ids the crash phase records; the caller relays them to the recover phase. */
interface ChildSessions {
  leader: string
  writer: string
  sentry: string
}

/**
 * Phase one: delegation, approval, crash. After the scenario quiesces with
 * sentry suspended at its approval gate, the leader and sentry are flushed —
 * the immediate durability barrier — and the process exits HARD, without the
 * fiber dispose, so the approval hook's abort path never settles the
 * suspended call. The durable prefix ends at sentry's pending control
 * request; the recover phase's cold resume repairs it.
 */
async function runCrashPhase(home: string): Promise<void> {
  const workspaceA = join(process.cwd(), 'workspace-a')
  const ctx = await bootProfile(home)
  const state = newState()
  const disposeObserve = observe(ctx, state, LEADER_ID)
  let writerId = ''
  let sentryId = ''
  try {
    const leaderHandle = await ctx.agents.create({
      sessionId: LEADER_ID,
      meta: { cwd: workspaceA, agentPreset: 'team' },
      agentOptions: LEADER_ROUTE,
      setup: mountTeamSetup(ctx),
    })
    const leader = leaderHandle.agent
    await waitForTeamMembers(ctx, leader, ['writer', 'sentry'])

    await drive(leader, MARKERS.scenario)
    await waitFor(
      'boot-1 quiescence (both control requests seen, writer done, four leader turns)',
      30_000,
      async () => state.controlRequests.has('writer')
        && state.controlRequests.has('sentry')
        && state.writerFinished
        && state.leaderTurns >= 4
        && (await isIdle(leader)),
    )

    writerId = state.memberChildIds.get('writer') ?? ''
    sentryId = state.memberChildIds.get('sentry') ?? ''
    if (writerId === '' || sentryId === '') {
      throw new Error(`${NAME}: expected control-request events for writer and sentry`)
    }
    // The settled writer leaves the live store once its log is durable;
    // wait that out so no retirement drain is in flight at the hard exit.
    await waitFor('writer settlement to leave the live store', 25_000,
      () => Promise.resolve(ctx.sessions.get(SessionId(writerId)) === undefined))
    await delay(500)
    // Flush the still-resident leader and the suspended sentry so the crash
    // point of the durable prefix is exactly sentry's pending control request.
    const sentrySession = ctx.sessions.get(SessionId(sentryId))
    if (sentrySession === undefined) {
      throw new Error(`${NAME}: sentry is not live before the crash flush`)
    }
    await ctx.sessions.flush(leader.session)
    await ctx.sessions.flush(sentrySession)
  } finally {
    disposeObserve()
  }
  const sessions: ChildSessions = { leader: LEADER_ID, writer: writerId, sentry: sentryId }
  process.stdout.write(`${JSON.stringify({ type: 'result', phase: 'crash', sessions })}\n`)
  process.exit(0)
}

/**
 * Phase two: cold recovery. Re-boots the shipped composition from the same
 * home, resumes the leader (whose `agent/created` re-points team-local
 * discovery at the workspace), and re-drives sentry through
 * `subagents.followup` so the suspended call repairs and the fresh request
 * approves and settles.
 */
async function runRecoverPhase(home: string): Promise<void> {
  const record = JSON.parse(process.env.DSH_TEAM_CHILD_SESSIONS ?? '{}') as Partial<ChildSessions>
  if (record.sentry === undefined || record.writer === undefined || record.leader === undefined) {
    throw new Error(`${NAME}: DSH_TEAM_CHILD_SESSIONS must carry the crash phase's child ids`)
  }
  const sentryId = record.sentry
  const ctx = await bootProfile(home)
  const state = newState()
  const disposeObserve = observe(ctx, state, LEADER_ID)
  try {
    const leaderHandle = await ctx.agents.resume({
      resumeSessionId: LEADER_ID,
      agentOptions: LEADER_ROUTE,
      setup: mountTeamSetup(ctx),
    })
    const leader = leaderHandle.agent
    await waitFor('resumed leader idle', 25_000, () => isIdle(leader))
    await waitForTeamMembers(ctx, leader, ['writer', 'sentry'])

    await drive(leader, MARKERS.resume)

    const subagents = ctx.get('subagents')
    if (subagents === undefined) throw new Error(`${NAME}: subagents service unavailable`)
    await subagents.followup(
      leader,
      SessionId(sentryId),
      [{ type: 'text', text: MARKERS.sentryFollowup }],
      {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: leader.id },
        signal: new AbortController().signal,
      },
    )
    await waitFor(
      'boot-2 quiescence (sentry re-recorded, three post-resume leader turns)',
      30_000,
      async () => state.sentryFinished
        && state.leaderTurns >= 3
        && (await isIdle(leader)),
    )
    await delay(500)
    await waitFor('leader idle after grace', 25_000, () => isIdle(leader))
    // The re-driven sentry settled (its retirement drain persists the tail);
    // flush the still-resident leader — the only live session — then exit
    // hard: nothing left in this process needs settling.
    await ctx.sessions.flush(leader.session)
    const sessions: ChildSessions = { leader: record.leader, writer: record.writer, sentry: sentryId }
    process.stdout.write(`${JSON.stringify({ type: 'result', phase: 'recover', sessions })}\n`)
  } finally {
    disposeObserve()
  }
  process.exit(0)
}

async function main(): Promise<void> {
  const home = process.env.DSH_HOME
  if (home === undefined) throw new Error(`${NAME}: DSH_HOME must be set`)
  if (driverPhase() === 'crash') await runCrashPhase(home)
  else await runRecoverPhase(home)
}

const uninstallFailLoud = installFailLoud(NAME)
main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(() => {
    uninstallFailLoud()
  })
