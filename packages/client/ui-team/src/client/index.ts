/**
 * Team configuration and status plugin, browser half. Registers a Team
 * settings section in the Settings panel showing teammate configuration
 * and usage instructions, the inline team marker Chat nodes (one compact
 * single-line row per durable team event — progress, control
 * request/decision, and member message — with the D16 click-to-jump), the
 * globally visible "团队" conversation view tab backed by the read-only
 * leader-keyed team mirror, whose four-section body is complete: the
 * delegation timeline (teammate lanes over the honest time domain), the
 * member groups (leading leader row plus per-member instance rows), the
 * task board (the projection's task list), and the event stream (the
 * mixed approval/message feed over the most recent 200 rows with the
 * "load earlier" append — a depth step over the snapshot stream, then wire
 * pages of `messagesBefore` once it is loaded), and the resident team dock
 * bar above the input (the thin collapsed readout plus the expandable
 * compact member/task lists, team sessions only, with the team-tab jump).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ObservableSnapshot, SessionId, TeamMirror,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings slot declarations and ctx.settingsScope.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the conversation slot declarations and the ChatNodeDataMap merge point.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TeamSettingsSection } from './TeamSettingsSection.tsx'
import { TeamMarker, type TeamMarkerInjected } from './TeamMarker.tsx'
import { TeamView, type TeamViewInjected } from './TeamView.tsx'
import { TeamDock, type TeamDockInjected } from './TeamDock.tsx'
import { teamMarkerDefinition } from './team-marker-definition.ts'
import { en, zh, type TeamKey } from './locales.ts'

export type { TeamSettingsSectionProps } from './TeamSettingsSection.tsx'
export type { TeamMarkerProps, TeamMarkerInjected } from './TeamMarker.tsx'
export type { TeamTimelineProps } from './TeamTimeline.tsx'
export type { TeamMembersProps } from './TeamMembers.tsx'
export type { TeamTasksProps } from './TeamTasks.tsx'
export type { TeamFeedProps } from './TeamFeed.tsx'
export type { TeamViewProps, TeamViewInjected } from './TeamView.tsx'
export type { TeamDockProps, TeamDockInjected, TeamDockPanelProps } from './TeamDock.tsx'
export type { TeamKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Team settings section, inline markers, and view-tab copy. */
    team: TeamKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'team'

/** The empty mirror record: the static snapshot of the capability-off source below. */
const EMPTY_TEAM_MIRROR: TeamMirror = {}
/** Static absent source (never notifies): keeps the hook surface alive when the sessions face carries no team wiring. */
const EMPTY_TEAM_MIRROR_SOURCE: ObservableSnapshot<TeamMirror> = {
  getSnapshot: () => EMPTY_TEAM_MIRROR,
  subscribe: () => () => {},
}

/** Services required by the team UI plugin. */
export const inject = ['slots', 'locale', 'conversationEvents', 'sessions']

/**
 * Client plugin body: register the Team settings section, the team panel
 * Conversation Node definition with its keyed Chat renderer, and the team
 * conversation view tab.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-team: dictionaries')

  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'team',
    order: 50,
    label: () => t('nav'),
    locale: NS,
  }, TeamSettingsSection))

  ctx.conversationEvents.register(teamMarkerDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'team-marker',
    locale: NS,
    inject: (): TeamMarkerInjected => ({
      hooks: { teamMirror },
      // D9/D16: the existing session-open path, threaded as a plain
      // callback so the row never touches the sessions service. The wire
      // view carries unbranded ids, so the cast stays at this consumption
      // face.
      openSession: (sessionId) => { ctx.sessions.open(sessionId as SessionId) },
    }),
  }, TeamMarker))

  // The team view tab (globally visible; a non-team session renders the
  // zero state). The mirror read rides the sessions service's team face —
  // one publication point in the object layer — and binds through the
  // registration's hooks compartment as the read-only `useTeamMirror`. A
  // sessions face without the team capability still gets the tab: the
  // static empty source keeps the hook surface alive and the cold pull
  // no-ops.
  const teams = ctx.sessions.teams
  const teamMirror = teams?.mirror ?? EMPTY_TEAM_MIRROR_SOURCE
  const ensureTeam: TeamViewInjected['ensureTeam'] =
    teams === undefined ? () => Promise.resolve() : sessionId => teams.refresh(sessionId)
  // The pagination entry rides the same team face. A sessions face without
  // the capability still gets a callback — a loud error result (unreachable
  // in practice: the empty mirror renders the zero state, never the feed).
  const pageTeamMessages: TeamViewInjected['pageTeamMessages'] =
    teams === undefined
      ? () => Promise.resolve({
        ok: false,
        error: { code: 'internal', message: 'the sessions face carries no team wiring', details: {} },
      })
      : (leaderSessionId, anchor, limit) => teams.pageMessagesBefore(leaderSessionId as SessionId, anchor, limit)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'team',
    order: 20,
    locale: NS,
    label: () => t('view.team'),
    inject: (): TeamViewInjected => ({
      hooks: { teamMirror },
      ensureTeam,
      pageTeamMessages,
      // D9: the existing session-open path, threaded as a plain callback so
      // the component never touches the sessions service. The wire view
      // carries unbranded ids, so the cast stays at this consumption face.
      openSession: (sessionId) => { ctx.sessions.open(sessionId as SessionId) },
    }),
  }, TeamView))

  // D13: jump the current session to the team tab. The view write (the
  // conversation chat store's setView action) is ui-conversation-private —
  // no cross-plugin verb exists for it yet (awaiting orchestration
  // arbitration), so the registered entry degrades to activating the tab
  // ring's team button, which carries this registration's own locale label.
  const openTeamTab = (): void => {
    const label = t('view.team')
    for (const tab of document.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')) {
      // String(): a text-less tab reads as "null" and can never match the label.
      if (String(tab.textContent).trim() === label) {
        tab.click()
        return
      }
    }
  }

  // The resident team dock above the input (D11–D13): the same mirror source
  // and single-flight cold pull as the tab, so the dock appears exactly for
  // the tab's team sessions; it sits between the goal strip (order 10) and
  // the queue strip (order 20).
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'team',
    order: 15,
    locale: NS,
    inject: (): TeamDockInjected => ({
      hooks: { teamMirror },
      ensureTeam,
      openTeamTab,
    }),
  }, TeamDock))
}
