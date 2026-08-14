/**
 * Session event declarations for the team plugin.
 * Uses declaration merging into {@link SessionEventMap}.
 *
 * @module @deepseek-ai/dsh-team
 */

import type {} from '@deepseek-ai/dsh-session/types'
import type {
  TeamMemberBoundData,
  TeamProgressData,
  TeamControlRequestData,
  TeamControlDecisionData,
  TeamMessageData,
} from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Durable binding of a child session to a team member definition.
     * Appended once in the child's initial turn. Carries the full effective
     * policy so cold resume reconstructs without the parent's live registry.
     * @mode append
     * @param data - the member id, role, and resolved policy snapshot.
     */
    'team/member-bound': TeamMemberBoundData
    /**
     * Team progress item created or updated.
     * @mode append
     * @param data - the progress entry.
     */
    'team/progress': TeamProgressData
    /**
     * Control request from a teammate to the leader.
     * @mode append
     * @param data - request id, teammate, tool name, and reason.
     */
    'team/control-request': TeamControlRequestData
    /**
     * Leader's decision on a control request.
     * @mode append
     * @param data - request id and decision.
     */
    'team/control-decision': TeamControlDecisionData
    /**
     * Message sent between leader and teammate.
     * @mode append
     * @param data - sender, target, and message content.
     */
    'team/message': TeamMessageData
  }
}
