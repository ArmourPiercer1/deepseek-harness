// @vitest-environment jsdom
/**
 * Event-stream section: the mixed approval/message rows in ascending order
 * (time, marker, actor, one-line summary), the pending waiting state and
 * the five decision labels with the optional decision reason, the plan-kind
 * marker, the 200-row default cap, the top "load earlier" (the depth append
 * over the snapshot stream, then the wire `messagesBefore` pages once it is
 * loaded: anchored at the oldest loaded message, spliced ascending, retired
 * at the observed messageCount), the loud error note with the counted
 * remainder when a page fails (the windowed fallback keeps its loud note),
 * the fetched pages resetting on a new snapshot frame, the one-line empty
 * state, the D9 row-click switch (message session, member session, the
 * inert session-less row), and the en/zh dictionary pairing.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { MessageAnchor, RpcResult, TeamMessagePage, TeamView } from '@deepseek-ai/dsh-client-runtime/client'
import { TeamFeed } from '../src/client/TeamFeed.tsx'
import { formatTeamClock } from '../src/client/team-timeline-model.ts'
import { en, zh } from '../src/client/locales.ts'

const LEADER = 'leader-s'

type MemberRow = TeamView['members'][number]
type ApprovalRow = TeamView['approvals'][number]
type MessageRow = TeamView['messages'][number]

function member(memberId: string, name: string, sessionId: string = `${memberId}-s`): MemberRow {
  return {
    memberId, name, role: 'teammate', sessionIds: [sessionId],
    status: 'bound', pendingControlCount: 0,
  }
}

function approval(requestId: string, requestedAt: number, overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    requestId,
    memberId: 'a',
    toolName: 'write_file',
    reason: `need to write ${requestId}`,
    requestedAt,
    ...overrides,
  }
}

function message(at: number, seq: number, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    from: 'lead', to: 'a', message: `message body ${seq}`, at, seq, sessionId: 'a-s',
    ...overrides,
  }
}

function view(overrides: Partial<TeamView> = {}): TeamView {
  return {
    teamId: LEADER,
    leaderSessionId: LEADER,
    rosterMemberCount: 3,
    members: [
      {
        memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
        status: 'bound', pendingControlCount: 0,
      },
      member('a', 'Alpha', 'a-s'),
      member('b', 'Beta', 'b-s'),
    ],
    delegations: [],
    tasks: [],
    approvals: [],
    messages: [],
    messageCount: 0,
    ...overrides,
  }
}

type PageStub = Parameters<typeof TeamFeed>[0]['pageMessages']

/** An unprogrammed page stub fails loud so an accidental wire call is visible. */
function unprogrammedPage(): PageStub {
  return vi.fn(async (): Promise<RpcResult<TeamMessagePage>> => ({
    ok: false,
    error: { code: 'internal', message: 'page not programmed', details: {} },
  }))
}

function makeProps(
  team: TeamView = view(),
  onSelectSession: (sessionId: string) => void = vi.fn(),
  dict: Record<string, string> = zh,
  pageMessages: PageStub = unprogrammedPage(),
): Parameters<typeof TeamFeed>[0] {
  return { view: team, pageMessages, onSelectSession, t: makeTranslate(dict) }
}

/** `count` messages at `base`+i, strictly earlier than the snapshot window, from the named session. */
function olderMessages(count: number, base: number, seqBase: number, sessionId: string) {
  return Array.from({ length: count }, (_, i) => message(base + i, seqBase + i, { sessionId }))
}

/** `count` messages at 1000+i ascending, recorded in the mate session. */
function manyMessages(count: number): MessageRow[] {
  return Array.from({ length: count }, (_, i) => message(1000 + i, i))
}

function feedRows(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-feed-row]')]
}

afterEach(cleanup)

describe('TeamFeed', () => {
  it('mixes approval and message rows into one ascending list (D8g/D8h)', () => {
    const team = view({
      approvals: [approval('r1', 2000)],
      messages: [message(1000, 1)],
    })
    const { container } = render(<TeamFeed {...makeProps(team)} />)
    const rows = feedRows(container)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.dataset.feedKind).toBe('message')
    expect(rows[1]?.dataset.feedKind).toBe('approval')
    expect(rows[0]?.querySelector('[data-feed-time]')?.textContent).toBe(formatTeamClock(1000))
    expect(rows[1]?.querySelector('[data-feed-time]')?.textContent).toBe(formatTeamClock(2000))
    expect(rows[0]?.querySelector('[data-feed-marker]')?.textContent).toBe('消息')
    expect(rows[1]?.querySelector('[data-feed-marker]')?.textContent).toBe('审批')
    expect(rows[0]?.querySelector('[data-feed-actor]')?.textContent).toBe('Lead → Alpha')
    expect(rows[1]?.querySelector('[data-feed-actor]')?.textContent).toBe('Alpha')
    expect(rows[0]?.querySelector('[data-feed-summary]')?.textContent).toBe('message body 1')
    expect(rows[1]?.querySelector('[data-feed-summary]')?.textContent).toBe('write_file need to write r1')
  })

  it('shows the plan-kind marker for plan approvals', () => {
    const team = view({ approvals: [approval('r1', 1000, { kind: 'plan' })] })
    const { container } = render(<TeamFeed {...makeProps(team)} />)
    expect(container.querySelector('[data-feed-marker]')?.textContent).toBe('计划审批')
  })

  it('badges the unpaired approval as pending with the warning dot', () => {
    const team = view({ approvals: [approval('r1', 1000)] })
    const { container } = render(<TeamFeed {...makeProps(team)} />)
    const row = feedRows(container)[0]
    expect(row?.querySelector('[data-feed-state][data-pending="true"]')?.textContent).toBe('等待裁决')
    expect(row?.querySelector<HTMLElement>('[data-state]')?.dataset.state).toBe('warning')
    expect(row?.dataset.decision).toBeUndefined()
  })

  it('shows all five decision labels after the request is paired (D8g)', () => {
    type Decision = NonNullable<ApprovalRow['decision']>
    const decisions: Decision[] = [
      { value: 'allow_once', decidedAt: 2000 },
      { value: 'deny', reason: 'not needed', decidedAt: 2000 },
      { value: 'escalate_to_user', decidedAt: 2000 },
      { value: 'approve_plan', decidedAt: 2000 },
      { value: 'request_revision', decidedAt: 2000 },
    ]
    const team = view({
      approvals: decisions.map((decision, i) => approval(`r${i}`, 1000 + i, { decision })),
    })
    const { container } = render(<TeamFeed {...makeProps(team)} />)
    const states = feedRows(container).map(row => row.querySelector('[data-feed-state]'))
    expect(states.map(state => state?.firstChild?.textContent)).toEqual([
      '单次允许', '拒绝', '升级给用户', '批准计划', '要求修订',
    ])
    expect(feedRows(container).map(row => row.dataset.decision)).toEqual([
      'allow_once', 'deny', 'escalate_to_user', 'approve_plan', 'request_revision',
    ])
    // The decision reason renders as its own truncated line only where present.
    const denyRow = feedRows(container)[1]
    expect(denyRow?.querySelector('[data-feed-state-reason]')?.textContent).toBe('not needed')
    expect(states[0]?.querySelector('[data-feed-state-reason]')).toBeNull()
    // Decided rows drop the waiting badge and read as settled (green).
    for (const row of feedRows(container)) {
      expect(row?.querySelector('[data-feed-state][data-pending="true"]')).toBeNull()
      expect(row?.querySelector<HTMLElement>('[data-state]')?.dataset.state).toBe('done')
    }
  })

  it('keeps the full text in the summary title (one-line truncation)', () => {
    const body = 'x'.repeat(300)
    const team = view({ messages: [message(1000, 1, { message: body })] })
    const { container } = render(<TeamFeed {...makeProps(team)} />)
    const summary = container.querySelector<HTMLElement>('[data-feed-summary]')
    expect(summary?.textContent).toBe(body)
    expect(summary?.getAttribute('title')).toBe(body)
  })

  it('caps the first render at the most recent 200 rows and offers "load earlier" (D8h)', () => {
    const team = view({ messages: manyMessages(250), messageCount: 250 })
    const { container } = render(<TeamFeed {...makeProps(team)} />)
    const rows = feedRows(container)
    expect(rows).toHaveLength(200)
    expect(rows[0]?.querySelector('[data-feed-summary]')?.textContent).toBe('message body 50')
    expect(rows[199]?.querySelector('[data-feed-summary]')?.textContent).toBe('message body 249')
    expect(screen.getByText('加载更早')).toBeTruthy()
  })

  it('appends older rows on "load earlier" without a wire call while the snapshot stream has depth', () => {
    const page = unprogrammedPage()
    const team = view({ messages: manyMessages(250), messageCount: 250 })
    const { container } = render(<TeamFeed {...makeProps(team, vi.fn(), zh, page)} />)
    fireEvent.click(screen.getByText('加载更早'))
    const rows = feedRows(container)
    expect(rows).toHaveLength(250)
    // The older half spliced ahead of the initial window.
    expect(rows[0]?.querySelector('[data-feed-summary]')?.textContent).toBe('message body 0')
    expect(rows[199]?.querySelector('[data-feed-summary]')?.textContent).toBe('message body 199')
    expect(rows[249]?.querySelector('[data-feed-summary]')?.textContent).toBe('message body 249')
    expect(screen.queryByText('加载更早')).toBeNull()
    expect(container.querySelector('[data-feed-truncated]')).toBeNull()
    expect(page).not.toHaveBeenCalled()
  })

  it('keeps appending across multiple clicks until the representable stream is loaded', () => {
    const page = unprogrammedPage()
    const team = view({ messages: manyMessages(500), messageCount: 500 })
    const { container } = render(<TeamFeed {...makeProps(team, vi.fn(), zh, page)} />)
    expect(feedRows(container)).toHaveLength(200)
    fireEvent.click(screen.getByText('加载更早'))
    expect(feedRows(container)).toHaveLength(400)
    expect(screen.getByText('加载更早')).toBeTruthy()
    fireEvent.click(screen.getByText('加载更早'))
    expect(feedRows(container)).toHaveLength(500)
    expect(screen.queryByText('加载更早')).toBeNull()
    expect(feedRows(container)[0]?.querySelector('[data-feed-summary]')?.textContent).toBe('message body 0')
    expect(page).not.toHaveBeenCalled()
  })

  it('pages the wire once the snapshot stream is loaded and retires at the observed total', async () => {
    const page = vi.fn(async (): Promise<RpcResult<TeamMessagePage>> => ({
      ok: true,
      value: {
        kind: 'message-page',
        teamId: LEADER,
        leaderSessionId: LEADER,
        messages: olderMessages(120, 880, 500, 'old-s'),
        messageCount: 620,
      },
    }))
    const team = view({ messages: manyMessages(500), messageCount: 620 })
    const { container } = render(<TeamFeed {...makeProps(team, vi.fn(), zh, page)} />)
    // Two depth clicks exhaust the snapshot stream (200 → 400 → 500 rows);
    // the third click is the first wire page.
    fireEvent.click(screen.getByText('加载更早'))
    fireEvent.click(screen.getByText('加载更早'))
    expect(feedRows(container)).toHaveLength(500)
    expect(page).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('加载更早'))
    await waitFor(() => { expect(feedRows(container)).toHaveLength(620) })
    expect(page).toHaveBeenCalledTimes(1)
    expect(page).toHaveBeenCalledWith(
      LEADER,
      { at: 1000, sessionId: 'a-s', seq: 0 },
      200,
    )
    // The paged rows splice ahead in global order; the stream is fully
    // loaded, so the control retires without a note.
    const rows = feedRows(container)
    expect(rows[0]?.querySelector('[data-feed-summary]')?.textContent).toBe('message body 500')
    expect(rows.map(row => row.querySelector('[data-feed-time]')?.textContent))
      .toEqual(rows.map(row => row.querySelector('[data-feed-time]')?.textContent).sort((x, y) => (x ?? '').localeCompare(y ?? '')))
    expect(screen.queryByText('加载更早')).toBeNull()
    expect(container.querySelector('[data-feed-truncated]')).toBeNull()
    expect(container.querySelector('[data-feed-load-failed]')).toBeNull()
  })

  it('chains each page from the newly loaded oldest message', async () => {
    const pages = [
      olderMessages(200, 800, 2000, 'old-s'),
      olderMessages(200, 600, 4000, 'old2-s'),
    ]
    let call = 0
    const page = vi.fn(async (_leaderSessionId: string, _anchor: MessageAnchor): Promise<RpcResult<TeamMessagePage>> => ({
      ok: true,
      value: {
        kind: 'message-page',
        teamId: LEADER,
        leaderSessionId: LEADER,
        messages: pages[call++] ?? [],
        messageCount: 900,
      },
    }))
    const team = view({ messages: manyMessages(500), messageCount: 900 })
    const { container } = render(<TeamFeed {...makeProps(team, vi.fn(), zh, page)} />)
    fireEvent.click(screen.getByText('加载更早'))
    fireEvent.click(screen.getByText('加载更早'))
    fireEvent.click(screen.getByText('加载更早')) // wire page 1
    await waitFor(() => { expect(feedRows(container)).toHaveLength(700) })
    fireEvent.click(screen.getByText('加载更早')) // wire page 2
    await waitFor(() => { expect(feedRows(container)).toHaveLength(900) })
    expect(page).toHaveBeenCalledTimes(2)
    expect(page.mock.calls[0]?.[1]).toEqual({ at: 1000, sessionId: 'a-s', seq: 0 })
    // The second anchor is page 1's oldest message, not the snapshot's.
    expect(page.mock.calls[1]?.[1]).toEqual({ at: 800, sessionId: 'old-s', seq: 2000 })
    expect(feedRows(container)[0]?.querySelector('[data-feed-summary]')?.textContent).toBe('message body 4000')
    expect(screen.queryByText('加载更早')).toBeNull()
  })

  it('keeps the button busy while a page is in flight and ignores a double click', async () => {
    let settle!: (value: RpcResult<TeamMessagePage>) => void
    const page = vi.fn((): Promise<RpcResult<TeamMessagePage>> => new Promise((res) => { settle = res }))
    const team = view({ messages: manyMessages(500), messageCount: 620 })
    const { container } = render(<TeamFeed {...makeProps(team, vi.fn(), zh, page)} />)
    fireEvent.click(screen.getByText('加载更早'))
    fireEvent.click(screen.getByText('加载更早'))
    fireEvent.click(screen.getByText('加载更早'))
    const button = container.querySelector<HTMLButtonElement>('[data-feed-load-earlier]')
    // The in-flight button is disabled: a click that lands anyway is
    // dropped, so no second page request starts.
    expect(button?.disabled).toBe(true)
    fireEvent.click(button!)
    expect(page).toHaveBeenCalledTimes(1)
    settle({
      ok: true,
      value: {
        kind: 'message-page' as const,
        teamId: LEADER,
        leaderSessionId: LEADER,
        messages: olderMessages(120, 880, 500, 'old-s'),
        messageCount: 620,
      },
    })
    await waitFor(() => { expect(feedRows(container)).toHaveLength(620) })
    expect(page).toHaveBeenCalledTimes(1)
  })

  it('shows the loud error note with the counted remainder when a page fails, and retries', async () => {
    const page = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'team-anchor-unknown' as const, message: 'anchor named no folded message', details: { leaderSessionId: LEADER } },
      })
      .mockImplementation(() => Promise.resolve({
        ok: true,
        value: {
          kind: 'message-page' as const,
          teamId: LEADER,
          leaderSessionId: LEADER,
          messages: olderMessages(120, 880, 500, 'old-s'),
          messageCount: 620,
        },
      }))
    const team = view({ messages: manyMessages(500), messageCount: 620 })
    const { container } = render(<TeamFeed {...makeProps(team, vi.fn(), zh, page)} />)
    fireEvent.click(screen.getByText('加载更早'))
    fireEvent.click(screen.getByText('加载更早'))
    fireEvent.click(screen.getByText('加载更早'))
    await waitFor(() => { expect(container.querySelector('[data-feed-load-failed]')).not.toBeNull() })
    // The failure is loud: the error text plus the counted remainder, and
    // the rows stay exactly where the snapshot left them.
    expect(container.querySelector('[data-feed-load-failed]')?.textContent)
      .toBe('更早消息加载失败：anchor named no folded message')
    expect(container.querySelector('[data-feed-truncated]')?.textContent)
      .toBe('还有 120 条更早的消息暂无法加载')
    expect(feedRows(container)).toHaveLength(500)
    // The retry succeeds: the note clears and the rows append.
    fireEvent.click(screen.getByText('加载更早'))
    await waitFor(() => { expect(feedRows(container)).toHaveLength(620) })
    expect(container.querySelector('[data-feed-load-failed]')).toBeNull()
    expect(container.querySelector('[data-feed-truncated]')).toBeNull()
    expect(screen.queryByText('加载更早')).toBeNull()
  })

  it('shows the loud error note for a transport failure folded into the result', async () => {
    const page = vi.fn(async (): Promise<RpcResult<TeamMessagePage>> => ({
      ok: false,
      error: { code: 'internal', message: 'wire down', details: {} },
    }))
    const team = view({ messages: manyMessages(500), messageCount: 620 })
    const { container } = render(<TeamFeed {...makeProps(team, vi.fn(), zh, page)} />)
    fireEvent.click(screen.getByText('加载更早'))
    fireEvent.click(screen.getByText('加载更早'))
    fireEvent.click(screen.getByText('加载更早'))
    await waitFor(() => { expect(container.querySelector('[data-feed-load-failed]')?.textContent).toBe('更早消息加载失败：wire down') })
    expect(container.querySelector('[data-feed-truncated]')?.textContent)
      .toBe('还有 120 条更早的消息暂无法加载')
    expect(feedRows(container)).toHaveLength(500)
  })

  it('resets the fetched pages when a new snapshot frame lands (depth kept, seam protected)', async () => {
    const page = vi.fn(async (): Promise<RpcResult<TeamMessagePage>> => ({
      ok: true,
      value: {
        kind: 'message-page',
        teamId: LEADER,
        leaderSessionId: LEADER,
        messages: olderMessages(120, 880, 500, 'old-s'),
        messageCount: 620,
      },
    }))
    const team = view({ messages: manyMessages(500), messageCount: 620 })
    const result = render(<TeamFeed {...makeProps(team, vi.fn(), zh, page)} />)
    fireEvent.click(screen.getByText('加载更早'))
    fireEvent.click(screen.getByText('加载更早'))
    fireEvent.click(screen.getByText('加载更早'))
    await waitFor(() => { expect(feedRows(result.container)).toHaveLength(620) })
    // A newer frame: five more messages, the same depth count applies to
    // the re-derived window (620 ≥ the new 505-row stream, so the whole
    // stream renders) — the fetched pages are gone with the old seam.
    const newer = Array.from({ length: 5 }, (_, i) => message(1500 + i, 500 + i))
    const frame = view({ messages: [...manyMessages(500), ...newer], messageCount: 625 })
    result.rerender(<TeamFeed {...makeProps(frame, vi.fn(), zh, page)} />)
    expect(feedRows(result.container)).toHaveLength(505)
    // The loaded set is the snapshot alone again: 625 - 505 = 120 unloaded
    // stay reachable through the wire, not through the stale pages.
    expect(feedRows(result.container)[0]?.querySelector('[data-feed-summary]')?.textContent).toBe('message body 0')
    expect(page).toHaveBeenCalledTimes(1)
  })

  it('stays inert (no wire call) when the view reports messages it does not hold', () => {
    // A synthetically inconsistent view: the fold never emits it, but the
    // guard must hold — the button shows (unloaded > 0) and the click is a
    // no-op instead of a crash on a missing anchor.
    const page = unprogrammedPage()
    const team = view({
      approvals: [{ requestId: 'r1', memberId: 'a', toolName: 'write_file', reason: 'x', requestedAt: 100 }],
      messages: [],
      messageCount: 5,
    })
    const { container } = render(<TeamFeed {...makeProps(team, vi.fn(), zh, page)} />)
    expect(container.querySelector('[data-feed-load-earlier]')).toBeTruthy()
    fireEvent.click(container.querySelector('[data-feed-load-earlier]')!)
    expect(page).not.toHaveBeenCalled()
    expect(feedRows(container)).toHaveLength(1)
  })

  it('renders the one-line empty state without rows or controls', () => {
    const { container } = render(<TeamFeed {...makeProps()} />)
    expect(feedRows(container)).toHaveLength(0)
    expect(screen.getByText('暂无审批与消息记录')).toBeTruthy()
    expect(container.querySelector('[data-feed-load-earlier]')).toBeNull()
    expect(container.querySelector('[data-feed-truncated]')).toBeNull()
  })

  it('switches to the message session when a message row is clicked (D9)', () => {
    const openSession = vi.fn()
    const team = view({
      messages: [message(1000, 1, { from: 'a', to: 'lead', sessionId: 'a-s' })],
    })
    const { container } = render(<TeamFeed {...makeProps(team, openSession)} />)
    fireEvent.click(feedRows(container)[0]!)
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith('a-s')
  })

  it('switches to the requesting member session when an approval row is clicked (D9)', () => {
    const openSession = vi.fn()
    const team = view({ approvals: [approval('r1', 1000, { memberId: 'a' })] })
    const { container } = render(<TeamFeed {...makeProps(team, openSession)} />)
    fireEvent.click(feedRows(container)[0]!)
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith('a-s')
  })

  it('keeps the session-less approval row inert (unbound member)', () => {
    const openSession = vi.fn()
    const team = view({
      members: [
        {
          memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: [LEADER],
          status: 'bound', pendingControlCount: 0,
        },
        { memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: [], status: 'unbound', pendingControlCount: 0 },
      ],
      approvals: [approval('r1', 1000, { memberId: 'a' })],
    })
    const { container } = render(<TeamFeed {...makeProps(team, openSession)} />)
    const row = feedRows(container)[0]
    expect(row?.disabled).toBe(true)
    fireEvent.click(row!)
    expect(openSession).not.toHaveBeenCalled()
  })

  it('renders the English dictionary pairing (including the page-failure notes)', async () => {
    const page = unprogrammedPage()
    const team = view({
      // The approval is the newest row: it stays inside the 200-row cap.
      approvals: [approval('r0', 2000, { decision: { value: 'request_revision', reason: 'too broad', decidedAt: 2100 } })],
      messages: manyMessages(250),
      messageCount: 370,
    })
    const { container } = render(<TeamFeed {...makeProps(team, vi.fn(), en, page)} />)
    // 251 mixed rows capped at 200: the 199 newest messages plus the approval.
    expect(feedRows(container).map(row => row.querySelector('[data-feed-marker]')?.textContent)).toEqual([
      ...Array.from({ length: 199 }, () => 'Message'),
      'Approval',
    ])
    expect(screen.getByText('Revision requested')).toBeTruthy()
    expect(screen.getByText('too broad')).toBeTruthy()
    // The depth append loads the snapshot stream; the next click pages the
    // wire and fails: the en error note plus the counted remainder.
    fireEvent.click(screen.getByText('Load earlier'))
    expect(feedRows(container)).toHaveLength(251)
    fireEvent.click(screen.getByText('Load earlier'))
    await waitFor(() => { expect(container.querySelector('[data-feed-load-failed]')).not.toBeNull() })
    expect(container.querySelector('[data-feed-load-failed]')?.textContent)
      .toBe('Loading earlier messages failed: page not programmed')
    expect(container.querySelector('[data-feed-truncated]')?.textContent)
      .toBe("120 earlier message(s) can't be loaded yet")
  })
})
