/**
 * Team configuration and status plugin, browser half. Registers a Team
 * settings section in the Settings panel showing teammate configuration
 * and usage instructions, and the durable team panel Chat node (task
 * progress board plus teammate status rows) in the conversation.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings slot declarations and ctx.settingsScope.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the conversation slot declarations and the ChatNodeDataMap merge point.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TeamSettingsSection } from './TeamSettingsSection.tsx'
import { TeamPanel } from './TeamPanel.tsx'
import { teamPanelDefinition } from './team-definition.ts'
import { en, zh, type TeamKey } from './locales.ts'

export type { TeamSettingsSectionProps } from './TeamSettingsSection.tsx'
export type { TeamPanelProps, TeammateUiStatus } from './TeamPanel.tsx'
export type { TeamKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Team settings section and panel copy. */
    team: TeamKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'team'

/** Services required by the team UI plugin. */
export const inject = ['slots', 'locale', 'conversationEvents']

/**
 * Client plugin body: register the Team settings section, the team panel
 * Conversation Node definition, and its keyed Chat renderer.
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
}
