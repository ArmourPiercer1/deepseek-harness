// @vitest-environment jsdom
/**
 * Team conversation view entry: the frozen team-ness derivation over the
 * leader-keyed mirror, the zero state for a non-team session, the
 * placeholder body for a team session, and the mirror-gap cold pull.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  SessionId, TeamMirror, TeamView as TeamWireView,
} from '@deepseek-ai/dsh-client-runtime/client'
import { resolveTeamView } from '@deepseek-ai/dsh-client-runtime/client'
import { TeamView, type TeamViewProps } from '../src/client/TeamView.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const LEADER = 'team-leader' as SessionId
const MEMBER = 'team-member' as SessionId
const OUTSIDER = 'plain-session' as SessionId

function wireView(leader: string): TeamWireView {
  return {
    teamId: leader,
    leaderSessionId: leader,
    rosterMemberCount: 2,
    members: [
      { memberId: 'leader', name: 'leader', role: 'leader', sessionIds: [leader], status: 'bound', pendingControlCount: 0 },
      { memberId: 'mate', name: 'mate', role: 'teammate', sessionIds: [MEMBER], status: 'running', pendingControlCount: 0 },
    ],
    delegations: [],
    tasks: [],
    approvals: [],
    messages: [],
    messageCount: 0,
  }
}

const LEADER_MIRROR: TeamMirror = { [LEADER]: wireView(LEADER) }

describe('resolveTeamView (frozen team-ness derivation)', () => {
  it('resolves a session by its own leader key or any binding member row, and nothing otherwise', () => {
    expect(resolveTeamView(LEADER_MIRROR, LEADER)).toBe(LEADER_MIRROR[LEADER])
    expect(resolveTeamView(LEADER_MIRROR, MEMBER)).toBe(LEADER_MIRROR[LEADER])
    expect(resolveTeamView(LEADER_MIRROR, OUTSIDER)).toBeUndefined()
    expect(resolveTeamView({}, OUTSIDER)).toBeUndefined()
  })
})

function viewProps(mirror: TeamMirror, sessionId: SessionId = LEADER): TeamViewProps {
  return {
    sessionId,
    useSession: (() => undefined) as TeamViewProps['useSession'],
    useProjection: () => undefined,
    useInput: () => { throw new Error('unused') },
    inputActions: { setDraft: () => {}, submit: () => {} } as unknown as TeamViewProps['inputActions'],
    useSessions: (() => { throw new Error('unused') }) as TeamViewProps['useSessions'],
    useWorkspaces: (() => { throw new Error('unused') }) as TeamViewProps['useWorkspaces'],
    useTeamMirror: selector => selector(mirror),
    ensureTeam: vi.fn(() => Promise.resolve()),
    t: makeTranslate(zh),
  }
}

describe('TeamView', () => {
  it('renders the one-line zero state for a non-team session and cold-pulls once', () => {
    const ensureTeam = vi.fn(() => Promise.resolve())
    const props = { ...viewProps({}, OUTSIDER), ensureTeam }
    render(<TeamView {...props} />)
    expect(screen.getByText('当前会话未加入任何团队')).toBeTruthy()
    expect(props.ensureTeam).toHaveBeenCalledTimes(1)
    expect(props.ensureTeam).toHaveBeenCalledWith(OUTSIDER)
  })

  it('renders the placeholder body for the leader session and the member session alike', () => {
    const leader = render(<TeamView {...viewProps(LEADER_MIRROR, LEADER)} />)
    expect(leader.container.querySelector('[data-team-view]')).toBeTruthy()
    expect(screen.queryByText('当前会话未加入任何团队')).toBeNull()
    leader.unmount()

    const member = render(<TeamView {...viewProps(LEADER_MIRROR, MEMBER)} />)
    expect(member.container.querySelector('[data-team-view]')).toBeTruthy()
  })

  it('stops cold-pulling once the mirror gains the session (landing frame wins)', () => {
    const ensureTeam = vi.fn(() => Promise.resolve())
    const view = render(<TeamView {...{ ...viewProps({}, LEADER), ensureTeam }} />)
    expect(ensureTeam).toHaveBeenCalledTimes(1)
    view.rerender(<TeamView {...{ ...viewProps(LEADER_MIRROR, LEADER), ensureTeam }} />)
    expect(view.container.querySelector('[data-team-view]')).toBeTruthy()
    expect(ensureTeam).toHaveBeenCalledTimes(1)
  })
})
