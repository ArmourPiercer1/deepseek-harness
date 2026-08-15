/**
 * Team member definition types. Contains only types — no runtime code.
 *
 * @module @deepseek-ai/dsh-team
 */

import type { TeamMemberId } from './brand.ts'

/** Discriminant for leader vs teammate definitions. */
export type TeamMemberRole = 'leader' | 'teammate'

/** Context window reload strategy for a team member. */
export type TeamContextPolicy = 'persistent' | 'fresh_per_delegation'

/** Tool allow/deny policy for a team member. */
export interface TeamToolPolicy {
  /** Tool names the member is allowed to use. Absence means no allowlist filtering. */
  readonly allow?: readonly string[]
  /** Tool names the member is denied from using. */
  readonly deny?: readonly string[]
}

/** MCP server access policy for a team member. */
export interface TeamMcpPolicy {
  /** MCP server names the member may access. Unlisted servers are denied. */
  readonly servers: readonly string[]
}

/**
 * Unified definition for a team member (leader or teammate).
 * Leader and teammate share the same schema; only `role` differs.
 */
export interface TeamMemberDefinition {
  /** Unique member id (branded). */
  readonly id: TeamMemberId
  /** Whether this member is the leader or a teammate. */
  readonly role: TeamMemberRole
  /** Display name. */
  readonly name: string
  /** One-line description of the member's responsibility. */
  readonly description: string
  /** Markdown body — becomes the member's persona prompt. */
  readonly prompt: string
  /** LLM provider route (e.g. 'deepseek-official'). */
  readonly provider?: string
  /** Model id for this member. */
  readonly model?: string
  /** Max output tokens per request. */
  readonly maxTokens?: number
  /** Tool allow/deny policy. */
  readonly tools?: TeamToolPolicy
  /** Tool names whose execution requires leader approval (teammate only). */
  readonly requiresApproval?: readonly string[]
  /** MCP server access policy. */
  readonly mcpServers?: TeamMcpPolicy
  /** Context window reload strategy. Defaults to 'persistent'. */
  readonly contextPolicy?: TeamContextPolicy
  /** Source file path (diagnostic only, not persisted). */
  readonly sourcePath?: string
}

/** Status of a team progress task item. */
export type TeamProgressStatus = 'pending' | 'in_progress' | 'completed' | 'blocked'

/** Structured task progress entry. */
export interface TeamProgressData {
  /** Unique task identifier. */
  readonly taskId: string
  /** Short task subject. */
  readonly subject: string
  /** Current task status. */
  readonly status: TeamProgressStatus
  /** Optional summary of progress or blockers. */
  readonly summary?: string
  /** The team member assigned to this task. */
  readonly memberId: TeamMemberId
}

/**
 * Durable binding of a child session to a team member definition.
 * Appended once in the child's initial turn. Carries the full effective
 * policy so cold resume reconstructs without the parent's live registry.
 */
export interface TeamMemberBoundData {
  /** The member this session is bound to. */
  readonly memberId: TeamMemberId
  /** Leader or teammate. */
  readonly role: TeamMemberRole
  /** Provider route, if overridden. */
  readonly provider?: string
  /** Model id, if overridden. */
  readonly model?: string
  /** Max output tokens, if overridden. */
  readonly maxTokens?: number
  /** Effective tool policy snapshot. */
  readonly tools?: TeamToolPolicy
  /** Tool names whose execution requires leader approval. */
  readonly requiresApproval?: readonly string[]
  /** Effective MCP policy snapshot. */
  readonly mcpServers?: TeamMcpPolicy
  /** Context policy for this member. */
  readonly contextPolicy?: TeamContextPolicy
}

/** Control request from a teammate to the leader. */
export interface TeamControlRequestData {
  /** Unique request identifier. */
  readonly requestId: string
  /** The requesting teammate. */
  readonly memberId: TeamMemberId
  /** Tool the teammate wants to execute. */
  readonly toolName: string
  /** Reason for the request. */
  readonly reason: string
  /** Tool arguments, if relevant. */
  readonly arguments?: Record<string, unknown>
}

/** Possible leader decisions on a control request. */
export type TeamControlDecision = 'allow_once' | 'deny' | 'escalate_to_user'

/** Leader's decision on a teammate control request. */
export interface TeamControlDecisionData {
  /** The request being decided. */
  readonly requestId: string
  /** The leader's decision. */
  readonly decision: TeamControlDecision
  /** Optional reason for the decision. */
  readonly reason?: string
}

/** Message sent between leader and teammate. */
export interface TeamMessageData {
  /** Sender member id. */
  readonly from: TeamMemberId
  /** Target member id. */
  readonly to: TeamMemberId
  /** Message content. */
  readonly message: string
}
