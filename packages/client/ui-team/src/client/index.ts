/**
 * Team configuration and status plugin, browser half. Registers a Team
 * settings section in the Settings panel showing teammate configuration
 * and usage instructions, the durable team panel Chat node (task
 * progress board plus teammate status rows) in the conversation, and the
 * globally visible "团队" conversation view tab backed by the read-only
 * leader-keyed team mirror.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ObservableSnapshot, TeamMirror } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings slot declarations and ctx.settingsScope.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the conversation slot declarations and the ChatNodeDataMap merge point.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TeamSettingsSection } from './TeamSettingsSection.tsx'
import { TeamPanel } from './TeamPanel.tsx'
import { TeamView, type TeamViewInjected } from './TeamView.tsx'
import { teamPanelDefinition } from './team-definition.ts'
import { en, zh, type TeamKey } from './locales.ts'

export type { TeamSettingsSectionProps } from './TeamSettingsSection.tsx'
export type { TeamPanelProps, TeammateUiStatus } from './TeamPanel.tsx'
export type { TeamViewProps, TeamViewInjected } from './TeamView.tsx'
export type { TeamKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Team settings section, panel, and view-tab copy. */
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

  ctx.conversationEvents.register(teamPanelDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'team-panel',
    locale: NS,
  }, TeamPanel))

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
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'team',
    order: 20,
    locale: NS,
    label: () => t('view.team'),
    inject: (): TeamViewInjected => ({ hooks: { teamMirror }, ensureTeam }),
  }, TeamView))
}
