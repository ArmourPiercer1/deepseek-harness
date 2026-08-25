import { describe, expect, it } from 'vitest'
import type {
  SessionId, SessionListState, SessionSummary, SubagentCatalogSnapshot, TeamMirror,
  TeamView, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  deriveFlat, deriveGroups, deriveSearchResults, teamChildSessionIds, teamLeaderCounts,
  workspaceLabel, relativeTime, UNGROUPED_KEY, UNGROUPED_LABEL,
} from '../src/client/tree.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const summary = (id: string, updatedAt: number, cwd?: string): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false,
  updatedAt, ...(cwd === undefined ? {} : { cwd }),
})
const list = (...items: SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
})
const workspace = (id: string, sessionIds: string[], title = id): WorkspaceView => ({
  workspaceId: wid(id), path: `/projects/${id}`, title,
  sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const view = (expandedGroups: readonly string[] = [], ungroupedOrder?: readonly string[]) => ({
  expandedGroups,
  ...(ungroupedOrder === undefined ? {} : { ungroupedOrder }),
})
const noArchive: readonly SessionId[] = []
const archived = (...ids: string[]): readonly SessionId[] => ids.map(sid)
const teamCatalog = (entries: SubagentCatalogSnapshot['entries']): SubagentCatalogSnapshot => ({
  entries, parentAvailable: true, state: 'ready', error: null,
})
const teamWireView = (leader: string, rosterMemberCount: number, memberIds: readonly string[] = []): TeamView => ({
  teamId: leader,
  leaderSessionId: leader,
  rosterMemberCount,
  members: [
    { memberId: 'leader', name: 'leader', role: 'leader', sessionIds: [leader], status: 'bound', pendingControlCount: 0 },
    ...memberIds.map(id => ({
      memberId: id, name: id, role: 'teammate' as const, sessionIds: [id], status: 'bound' as const, pendingControlCount: 0,
    })),
  ],
  delegations: [],
  tasks: [],
  approvals: [],
  messages: [],
  messageCount: 0,
})

describe('deriveGroups', () => {
  it('keeps Host Workspace and sessionIds order without Client recency sorting', () => {
    const sessions = list(summary('newer', 20), summary('older', 10))
    const workspaces = [workspace('first', ['older', 'newer']), workspace('empty', [])]
    const groups = deriveGroups(sessions, workspaces, noArchive, view(['first']))
    expect(groups.map(group => group.key)).toEqual(['first', 'empty'])
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([sid('older'), sid('newer')])
  })

  it('projects pending-interaction state into grouped and flat rows', () => {
    const awaiting = { ...summary('awaiting', 10), pendingInteraction: 'plan-review' as const, running: true }
    const sessions = list(awaiting)
    const grouped = deriveGroups(sessions, [workspace('project', ['awaiting'])], noArchive, view(['project']))
    expect(grouped[0]!.sessions[0]).toMatchObject({ pendingInteraction: 'plan-review', running: true })
    expect(deriveFlat(sessions, noArchive)[0]).toMatchObject({ pendingInteraction: 'plan-review', running: true })
  })

  it('puts only real unaccounted Sessions in the trailing Ungrouped group', () => {
    const sessions = list(summary('owned', 1, '/projects/first'), summary('loose', 9, '/other'))
    const groups = deriveGroups(sessions, [workspace('first', ['owned'])], noArchive, view([UNGROUPED_KEY]))
    expect(groups.map(group => group.key)).toEqual(['first', UNGROUPED_KEY])
    expect(groups[1]!.sessions.map(session => session.id)).toEqual([sid('loose')])
  })

  it('applies stored Ungrouped order and appends new loose Sessions by recency', () => {
    const sessions = list(summary('one', 3), summary('two', 2), summary('new', 4))
    const groups = deriveGroups(
      sessions,
      [],
      noArchive,
      view([UNGROUPED_KEY], ['two', 'stale', 'two']),
    )
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([
      sid('two'), sid('new'), sid('one'),
    ])
  })

  it('shows only the current blank session in its Workspace count and tree', () => {
    const currentBlank = { ...summary('current-blank', 5), blank: true }
    const staleBlank = { ...summary('stale-blank', 4), blank: true }
    const real = summary('shown', 3)
    const sessions = {
      ...list(real, currentBlank, staleBlank),
      current: currentBlank.id,
    }
    const groups = deriveGroups(
      sessions, [workspace('first', ['shown', 'current-blank', 'stale-blank'])], noArchive, view(['first']),
    )
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([real.id, currentBlank.id])
    const blankNode = groups[0]!.sessions.find(session => session.id === currentBlank.id)!
    // The stored placeholder title stays canonical; the renderer swaps in
    // the localized New Session label via the blank flag.
    expect(blankNode.title).toBe('New Session')
    expect(blankNode.blank).toBe(true)
    expect(groups[0]!.sessions.find(session => session.id === real.id)!.blank).toBe(false)
    expect(groups[0]!.sessionCount).toBe(2)
    // A non-current blank stray never surfaces an Ungrouped bucket either.
    const strayGroups = deriveGroups(list({ ...summary('stray', 2), blank: true }), [workspace('first', [])], noArchive, view())
    expect(strayGroups.map(group => group.key)).toEqual(['first'])
  })

  it('projects the completion reminder into session and search rows (absent = false)', () => {
    const done = { ...summary('done', 3), completed: true }
    const plain = summary('plain', 2)
    const sessions = list(done, plain)
    const groups = deriveGroups(
      sessions, [workspace('first', ['done', 'plain'])], noArchive, view(['first']),
    )
    const doneNode = groups[0]!.sessions.find(session => session.id === done.id)!
    const plainNode = groups[0]!.sessions.find(session => session.id === plain.id)!
    expect(doneNode.completed).toBe(true)
    expect(plainNode.completed).toBe(false)
    expect(deriveFlat(sessions, noArchive).find(node => node.id === done.id)!.completed).toBe(true)
    const search = deriveSearchResults(sessions, [workspace('first', ['done', 'plain'])], 'done', noArchive, { items: [], hasMore: false }, 10)
    expect(search.items[0]?.completed).toBe(true)
  })

  it('hides subagent-origin sessions without hiding ordinary forks', () => {
    const parent = summary('parent', 1)
    const subagent = {
      ...summary('subagent', 3), parentId: parent.id, origin: 'subagent' as const, running: true,
    }
    const grandchild = {
      ...summary('grandchild', 4), parentId: subagent.id, origin: 'subagent' as const, running: true,
    }
    const fork = { ...summary('fork', 2), parentId: subagent.id }
    const forkChild = {
      ...summary('fork-child', 5), parentId: fork.id, origin: 'subagent' as const, running: true,
    }
    const sessions = { ...list(parent, fork, subagent, grandchild, forkChild), current: subagent.id }
    const groups = deriveGroups(
      sessions,
      [workspace('first', ['parent', 'fork', 'subagent', 'grandchild', 'fork-child'])],
      noArchive,
      view(['first']),
    )

    expect(groups[0]!.sessions.map(node => node.id)).toEqual([parent.id, fork.id])
    expect(groups[0]!.sessionCount).toBe(2)
    expect(groups[0]!.sessions[0]).toMatchObject({ running: false, runningSubagentCount: 2 })
    expect(groups[0]!.sessions[1]).toMatchObject({ running: false, runningSubagentCount: 1 })
    expect(deriveFlat(sessions, noArchive).map(node => [node.id, node.runningSubagentCount])).toEqual([
      [fork.id, 1], [parent.id, 2],
    ])
    expect(deriveSearchResults(
      sessions, [workspace('first', ['parent', 'fork'])], 'parent', noArchive,
      { items: [], hasMore: false }, 10,
    ).items[0]).toMatchObject({ id: parent.id, runningSubagentCount: 2 })
  })

  it('ignores fork lineage and sorts every ungrouped session as a top-level row', () => {
    const parent = summary('parent', 1)
    const oldChild = { ...summary('old-child', 10), parentId: parent.id }
    const newChild = { ...summary('new-child', 20), parentId: parent.id }
    const tieB = { ...summary('tie-b', 20), parentId: parent.id }
    const tieA = { ...summary('tie-a', 20), parentId: parent.id }
    const self = { ...summary('self', 2), parentId: sid('self') }
    const orphan = { ...summary('orphan', 3), parentId: sid('missing') }
    const cycleA = { ...summary('cycle-a', 4), parentId: sid('cycle-b') }
    const cycleB = { ...summary('cycle-b', 5), parentId: sid('cycle-a') }
    const groups = deriveGroups(
      list(parent, oldChild, newChild, tieB, tieA, self, orphan, cycleA, cycleB),
      [],
      noArchive,
      { expandedGroups: [UNGROUPED_KEY] },
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([
      newChild.id, tieA.id, tieB.id, oldChild.id,
      cycleB.id, cycleA.id, orphan.id, self.id, parent.id,
    ])

    // Equal timestamps use ids as a deterministic tiebreak in either input order.
    expect(deriveGroups(list(summary('tie-a', 1), summary('tie-b', 1)), [], noArchive, view([UNGROUPED_KEY]))[0]!
      .sessions.map(node => node.id)).toEqual([sid('tie-a'), sid('tie-b')])
  })

  it('tolerates Workspace membership arriving before its Session summary', () => {
    const partial: SessionListState = {
      ...list(),
      ids: [sid('present')],
      byId: { [sid('present')]: summary('present', 1) },
    }
    const groups = deriveGroups(partial, [workspace('project', ['missing', 'present'])], noArchive, view(['project']))
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([sid('present')])
  })

  it('hides archived sessions from workspace groups and Ungrouped', () => {
    const kept = summary('kept', 1, '/projects/first')
    const gone = summary('gone', 2, '/projects/first')
    const looseGone = summary('loose-gone', 3, '/other')
    const sessions = list(kept, gone, looseGone)
    const groups = deriveGroups(
      sessions, [workspace('first', ['kept', 'gone'])], archived('gone', 'loose-gone'), view(['first', UNGROUPED_KEY]),
    )
    // The archived member drops from its group AND the archived stray never
    // surfaces an Ungrouped bucket; counts follow the visible rows.
    expect(groups.map(group => group.key)).toEqual(['first'])
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([kept.id])
    expect(groups[0]!.sessionCount).toBe(1)
  })

  it('marks selected Workspace and Ungrouped sessions without relying on an Intent', () => {
    const owned = summary('owned', 1)
    const loose = summary('loose', 2)
    const ws = workspace('project', ['owned'])
    const ownedGroups = deriveGroups({ ...list(owned, loose), current: owned.id }, [ws], noArchive, view())
    expect(ownedGroups.find(group => group.key === 'project')!.containsCurrent).toBe(true)
    const looseGroups = deriveGroups({ ...list(owned, loose), current: loose.id }, [ws], noArchive, view())
    expect(looseGroups.find(group => group.key === UNGROUPED_KEY)!.containsCurrent).toBe(true)
  })
})

describe('deriveFlat', () => {
  it('flattens every session — fork children included — newest-first with id tiebreak', () => {
    const parent = summary('parent', 10)
    const child = { ...summary('child', 30), parentId: parent.id }
    const tieB = summary('tie-b', 20)
    const tieA = summary('tie-a', 20)
    const rows = deriveFlat(list(parent, child, tieB, tieA), noArchive)
    expect(rows.map(row => row.id)).toEqual([sid('child'), sid('tie-a'), sid('tie-b'), sid('parent')])
  })

  it('hides subagent-origin rows but keeps ordinary forks', () => {
    const parent = summary('parent', 1)
    const fork = { ...summary('fork', 2), parentId: parent.id }
    const subagent = { ...summary('subagent', 3), parentId: parent.id, origin: 'subagent' as const }
    const rows = deriveFlat(
      { ...list(parent, fork, subagent), current: subagent.id },
      noArchive,
    )
    expect(rows.map(row => row.id)).toEqual([fork.id, parent.id])
  })

  it('tolerates ids whose summary has not landed yet', () => {
    const partial: SessionListState = { ...list(summary('present', 1)), ids: [sid('ghost'), sid('present')] }
    expect(deriveFlat(partial, noArchive).map(row => row.id)).toEqual([sid('present')])
  })

  it('shows only the current blank session and excludes blanks from search', () => {
    const currentBlank = { ...summary('current-blank', 9), blank: true }
    const staleBlank = { ...summary('stale-blank', 8), blank: true }
    const sessions = {
      ...list(summary('real', 1), currentBlank, staleBlank),
      current: currentBlank.id,
    }
    const rows = deriveFlat(sessions, noArchive)
    expect(rows.map(row => row.id)).toEqual([currentBlank.id, sid('real')])
    expect(rows.map(row => row.title)).toEqual(['New Session', 'real'])
    expect(rows.map(row => row.blank)).toEqual([true, false])
  })

  it('hides archived sessions in flat mode', () => {
    const kept = summary('kept', 1)
    const gone = summary('gone', 2)
    expect(deriveFlat(list(kept, gone), archived('gone')).map(row => row.id)).toEqual([kept.id])
  })
})

describe('deriveSearchResults archive filtering', () => {
  it('archived sessions never match — not by title and not via a backend content hit', () => {
    const hit = summary('hit', 2)
    hit.displayTitle = 'Needle row'
    const gone = summary('gone', 1)
    gone.displayTitle = 'Needle archived'
    const result = deriveSearchResults(
      list(hit, gone),
      [],
      'needle',
      archived('gone'),
      { items: [{ sessionId: gone.id, snippet: 'needle body' }], hasMore: false },
      10,
    )
    expect(result.items.map(item => item.id)).toEqual([hit.id])
  })
})

describe('deriveSearchResults', () => {
  it('merges local title/Workspace matches before ranked content hits and enriches duplicates', () => {
    const titleHit = summary('title-hit', 30, '/projects/a')
    titleHit.displayTitle = 'Needle title'
    titleHit.pendingInteraction = 'plan-review'
    const workspaceHit = summary('workspace-hit', 20, '/projects/b')
    workspaceHit.displayTitle = 'Ordinary title'
    const contentHit = summary('content-hit', 10, '/projects/c')
    const sessions = list(titleHit, workspaceHit, contentHit)
    const result = deriveSearchResults(
      sessions,
      [
        workspace('a', ['title-hit'], 'Alpha'),
        workspace('b', ['workspace-hit'], 'Needle Workspace'),
        workspace('duplicate-owner', ['title-hit'], 'Ignored duplicate owner'),
      ],
      ' NEEDLE ',
      noArchive,
      {
        items: [
          { sessionId: contentHit.id, snippet: 'body needle excerpt' },
          { sessionId: contentHit.id, snippet: 'ignored duplicate excerpt' },
          { sessionId: titleHit.id, snippet: 'title session body excerpt' },
          { sessionId: sid('unknown'), snippet: 'not in session.list' },
        ],
        hasMore: false,
      },
      10,
    )

    expect(result).toEqual({
      items: [
        {
          id: titleHit.id,
          title: 'Needle title',
          workspace: 'Alpha',
          running: false,
          runningSubagentCount: 0,
          pendingInteraction: 'plan-review',
          completed: false,
          snippet: 'title session body excerpt',
        },
        {
          id: workspaceHit.id,
          title: 'Ordinary title',
          workspace: 'Needle Workspace',
          running: false,
          runningSubagentCount: 0,
          completed: false,
        },
        {
          id: contentHit.id,
          title: 'content-hit',
          workspace: 'c',
          running: false,
          runningSubagentCount: 0,
          completed: false,
          snippet: 'body needle excerpt',
        },
      ],
      hasMore: false,
    })
  })

  it('excludes blank sessions from search regardless of query or content hits', () => {
    const currentBlank = { ...summary('opaque-current', 5), blank: true }
    const staleBlank = { ...summary('new session stale', 4), blank: true }
    const sessions = {
      ...list(currentBlank, staleBlank),
      current: currentBlank.id,
    }
    // Blank placeholders never match — not their localized-display title, not
    // their id, and not even a backend content hit naming them.
    const result = deriveSearchResults(
      sessions,
      [workspace('first', ['opaque-current', 'new session stale'])],
      'new session',
      noArchive,
      {
        items: [
          { sessionId: staleBlank.id, snippet: 'stale body' },
          { sessionId: currentBlank.id, snippet: 'current body' },
        ],
        hasMore: false,
      },
      10,
    )
    expect(result.items).toEqual([])
  })

  it('uses the supplied cap and preserves either local overflow or backend hasMore', () => {
    const rows = Array.from({ length: 5 }, (_, index) => {
      const item = summary(`s-${String(index).padStart(2, '0')}`, index)
      item.displayTitle = `Needle ${String(index)}`
      return item
    })
    const overflow = deriveSearchResults(
      list(...rows),
      [],
      'needle',
      noArchive,
      { items: [], hasMore: false },
      3,
    )
    expect(overflow.items).toHaveLength(3)
    expect(overflow.hasMore).toBe(true)

    const backendMore = deriveSearchResults(
      list(summary('body', 1)),
      [],
      'needle',
      noArchive,
      { items: [{ sessionId: sid('body'), snippet: 'needle' }], hasMore: true },
      3,
    )
    expect(backendMore.items).toHaveLength(1)
    expect(backendMore.hasMore).toBe(true)
    expect(deriveSearchResults(list(), [], '  ', noArchive, { items: [], hasMore: true }, 3))
      .toEqual({ items: [], hasMore: false })
  })
})

describe('teamChildSessionIds (D4 catalog criterion)', () => {
  it('collects only team:-labeled child entries across every parent catalog', () => {
    const team = sid('team-child')
    const plain = sid('plain-child')
    const unlabeled = sid('unlabeled')
    const diagnosed = sid('diagnosed')
    const hidden = teamChildSessionIds({
      [sid('p1')]: teamCatalog([
        { kind: 'child', id: team, activity: 'running', hasChildren: false, mode: 'continuable', label: 'team:alpha' },
        { kind: 'child', id: plain, activity: 'inactive', hasChildren: false, mode: 'continuable', label: 'alpha' },
        { kind: 'child', id: unlabeled, activity: 'inactive', hasChildren: false, mode: 'one-shot' },
        { kind: 'diagnostic', id: diagnosed, reason: 'corrupt' },
      ]),
      [sid('p2')]: teamCatalog([]),
    })
    expect(hidden.has(team)).toBe(true)
    expect(hidden.has(plain)).toBe(false)
    expect(hidden.has(unlabeled)).toBe(false)
    expect(hidden.has(diagnosed)).toBe(false)
    expect(teamChildSessionIds({}).size).toBe(0)
  })
})

describe('D4 teammate hiding', () => {
  const leader = summary('leader', 1)

  it('hides a teammate child from every list surface through its parent catalog label', () => {
    const mate = { ...summary('mate', 3), parentId: leader.id, origin: 'subagent' as const }
    const sessions = {
      ...list(leader, mate),
      current: leader.id,
      subagentsByParent: {
        [leader.id]: teamCatalog([
          { kind: 'child', id: mate.id, activity: 'running', hasChildren: false, mode: 'continuable', label: 'team:mate' },
        ]),
      },
    }
    const groups = deriveGroups(sessions, [workspace('first', ['leader', 'mate'])], noArchive, view(['first']))
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([leader.id])
    expect(groups[0]!.sessionCount).toBe(1)
    expect(deriveFlat(sessions, noArchive).map(node => node.id)).toEqual([leader.id])
    // Neither a title match nor a backend content hit surfaces the teammate.
    const search = deriveSearchResults(
      sessions, [workspace('first', ['leader', 'mate'])], 'mate', noArchive,
      { items: [{ sessionId: mate.id, snippet: 'needle body' }], hasMore: false }, 10,
    )
    expect(search.items).toEqual([])
  })

  it('hides a catalog-labeled teammate even without the subagent origin flag', () => {
    const catalogMate = summary('catalog-mate', 4)
    const sessions = {
      ...list(leader, catalogMate),
      subagentsByParent: {
        [leader.id]: teamCatalog([
          { kind: 'child', id: catalogMate.id, activity: 'inactive', hasChildren: false, mode: 'continuable', label: 'team:scout' },
        ]),
      },
    }
    expect(deriveFlat(sessions, noArchive).map(node => node.id)).toEqual([leader.id])
    const strayGroups = deriveGroups(sessions, [], noArchive, view([UNGROUPED_KEY]))
    expect(strayGroups[0]!.sessions.map(node => node.id)).toEqual([leader.id])
  })

  it('keeps ordinary subagent, unlabeled one-shot, and diagnostic children on their existing treatment', () => {
    const regular = { ...summary('regular', 5), parentId: leader.id, origin: 'subagent' as const }
    const oneShot = summary('one-shot', 6)
    const broken = summary('broken', 7)
    const sessions = {
      ...list(leader, regular, oneShot, broken),
      subagentsByParent: {
        [leader.id]: teamCatalog([
          { kind: 'child', id: regular.id, activity: 'running', hasChildren: false, mode: 'continuable', label: 'analysis' },
          { kind: 'child', id: oneShot.id, activity: 'inactive', hasChildren: false, mode: 'one-shot' },
          { kind: 'diagnostic', id: broken.id, reason: 'corrupt' },
        ]),
      },
    }
    // Origin-based hiding is unchanged; unlabeled children and diagnostics show.
    const groups = deriveGroups(
      sessions, [workspace('first', ['leader', 'regular', 'one-shot', 'broken'])], noArchive, view(['first']),
    )
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([leader.id, oneShot.id, broken.id])
    expect(deriveFlat(sessions, noArchive).map(node => node.id)).toEqual([broken.id, oneShot.id, leader.id])
    expect(deriveSearchResults(
      sessions, [workspace('first', ['leader', 'regular', 'one-shot', 'broken'])], 'one-shot', noArchive,
      { items: [], hasMore: false }, 10,
    ).items.map(item => item.id)).toEqual([oneShot.id])
  })
})

describe('teamLeaderCounts (D5/D23 badge counts)', () => {
  it('maps every mirror key to its verbatim rosterMemberCount', () => {
    const mirror: TeamMirror = { [sid('leader')]: teamWireView('leader', 3) }
    const counts = teamLeaderCounts(mirror)
    expect(counts.size).toBe(1)
    expect(counts.get(sid('leader'))).toBe(3)
  })

  it('returns an empty map for an empty mirror', () => {
    expect(teamLeaderCounts({}).size).toBe(0)
  })

  it('gives no entry to a session that appears only as a bound member', () => {
    const counts = teamLeaderCounts({ [sid('leader')]: teamWireView('leader', 2, ['mate']) })
    expect(counts.has(sid('leader'))).toBe(true)
    expect(counts.has(sid('mate'))).toBe(false)
  })
})

describe('createWorkspaceViewStore', () => {
  it('stores grouping, ordering, Workspace expansion, and recent-session view order', () => {
    const store = createWorkspaceViewStore().create()
    expect(store.getSnapshot().groupBy).toBe('workspace')
    expect(store.getSnapshot().orderBy).toBe('updated')
    store.actions.setGroupBy('flat')
    store.actions.setOrderBy('updated')
    store.actions.setGroupExpanded('alpha', true)
    store.actions.syncSessionOrderAccount('alpha', ['two', 'one'], { one: 1, two: 2 })
    store.actions.setSessionOrder('alpha', ['one', 'two'])
    expect(store.getSnapshot().groupBy).toBe('flat')
    expect(store.getSnapshot()).toMatchObject({
      orderBy: 'updated',
      groupExpansion: { alpha: true },
      sessionOrderByAccount: { alpha: ['one', 'two'] },
      sessionUpdatedAtByAccount: { alpha: { one: 1, two: 2 } },
    })
  })

  it('removes view state outside the retained Workspace key set', () => {
    const store = createWorkspaceViewStore().create()
    store.actions.setGroupExpanded('', true)
    store.actions.setGroupExpanded('alpha', true)
    store.actions.setGroupExpanded('deleted', true)
    store.actions.syncSessionOrderAccount('alpha', ['alpha-session'], { 'alpha-session': 2 })
    store.actions.syncSessionOrderAccount('deleted', ['deleted-session'], { 'deleted-session': 1 })

    store.actions.retainAccountKeys(['', 'alpha'])

    const snapshot = store.getSnapshot()
    expect(snapshot.groupExpansion).toEqual({ '': true, alpha: true })
    expect(snapshot.sessionOrderByAccount).toEqual({ alpha: ['alpha-session'] })
    expect(snapshot.sessionUpdatedAtByAccount).toEqual({ alpha: { 'alpha-session': 2 } })
  })
})

describe('workspaceLabel', () => {
  it('uses the Ungrouped fallback and extracts POSIX and Windows basenames', () => {
    expect(workspaceLabel(undefined)).toBe(UNGROUPED_LABEL)
    expect(workspaceLabel('')).toBe(UNGROUPED_LABEL)
    expect(workspaceLabel('/projects/demo/')).toBe('demo')
    expect(workspaceLabel('C:\\projects\\demo\\')).toBe('demo')
    expect(workspaceLabel('/')).toBe('/')
  })
})

describe('relativeTime', () => {
  it('buckets current, minute, hour, day, month, and year distances', () => {
    const now = 400 * 24 * 60 * 60 * 1_000
    expect(relativeTime(now, now)).toEqual({ unit: 'now', n: 0 })
    expect(relativeTime(now - 5 * 60_000, now)).toEqual({ unit: 'minutes', n: 5 })
    expect(relativeTime(now - 3 * 3_600_000, now)).toEqual({ unit: 'hours', n: 3 })
    expect(relativeTime(now - 2 * 86_400_000, now)).toEqual({ unit: 'days', n: 2 })
    expect(relativeTime(now - 60 * 86_400_000, now)).toEqual({ unit: 'months', n: 2 })
    expect(relativeTime(0, now)).toEqual({ unit: 'years', n: 1 })
  })
})
