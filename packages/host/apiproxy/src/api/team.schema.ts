/** Zod schemas for the browser-safe team domain. */

import { z } from 'zod'
import type { RequestPayload } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { TeamProjectionValue } from './team.ts'

/**
 * Messages carried by one team snapshot or message page. A protocol constant
 * restated in this browser-safe layer: the wire bound is this contract's own,
 * and the client bundle must not carry a host-package value import.
 */
export const MESSAGE_CAP = 500

/** Wire projection of one member row. */
const teamMemberViewSchema = z.object({
  memberId: z.string(),
  name: z.string(),
  role: z.union([z.literal('leader'), z.literal('teammate')]),
  sessionIds: z.array(z.string()),
  status: z.union([
    z.literal('unbound'), z.literal('bound'), z.literal('running'), z.literal('settled'),
  ]),
  currentAction: z.string().optional(),
  pendingControlCount: z.number().int().nonnegative(),
})

/** Wire projection of one delegation span. */
const teamDelegationViewSchema = z.object({
  memberId: z.string(),
  childSessionId: z.string(),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  inProgress: z.boolean(),
})

/** Wire projection of one task-board row. */
const teamTaskViewSchema = z.object({
  taskId: z.string(),
  subject: z.string(),
  status: z.union([
    z.literal('pending'), z.literal('in_progress'), z.literal('completed'), z.literal('blocked'),
  ]),
  summary: z.string().optional(),
  memberId: z.string(),
  seq: z.number().int().nonnegative(),
  at: z.number().int().nonnegative(),
})

/** Wire projection of one approval request/decision pair. */
const teamApprovalViewSchema = z.object({
  requestId: z.string(),
  memberId: z.string(),
  toolName: z.string(),
  reason: z.string(),
  kind: z.union([z.literal('tool'), z.literal('plan')]).optional(),
  requestedAt: z.number().int().nonnegative(),
  decision: z.object({
    value: z.union([
      z.literal('allow_once'), z.literal('deny'), z.literal('escalate_to_user'),
      z.literal('approve_plan'), z.literal('request_revision'),
    ]),
    reason: z.string().optional(),
    decidedAt: z.number().int().nonnegative(),
  }).optional(),
})

/** Wire projection of one ordered message. */
const teamMessageViewSchema = z.object({
  from: z.string(),
  to: z.string(),
  message: z.string(),
  at: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  sessionId: z.string(),
})

/** Full leader snapshot as it crosses the wire. */
export const teamViewSchema = z.object({
  teamId: z.string(),
  leaderSessionId: z.string(),
  rosterMemberCount: z.number().int().nonnegative(),
  members: z.array(teamMemberViewSchema),
  delegations: z.array(teamDelegationViewSchema),
  tasks: z.array(teamTaskViewSchema),
  approvals: z.array(teamApprovalViewSchema),
  messages: z.array(teamMessageViewSchema),
  messageCount: z.number().int().nonnegative(),
})

/** Older-messages page as it crosses the wire. */
const teamMessagePageSchema = z.object({
  kind: z.literal('message-page'),
  teamId: z.string(),
  leaderSessionId: z.string(),
  messages: z.array(teamMessageViewSchema),
  messageCount: z.number().int().nonnegative(),
})

/**
 * team.projection request payload: snapshot form or page form. The snapshot
 * branch is strict so a page request can never silently parse as a snapshot.
 */
export const teamProjectionRequestSchema = z.union([
  z.strictObject({ leaderSessionId: sessionIdSchema }),
  z.strictObject({
    leaderSessionId: sessionIdSchema,
    messagesBefore: z.object({
      at: z.number().int().nonnegative(),
      sessionId: sessionIdSchema,
      seq: z.number().int().nonnegative(),
    }),
    // Loud wire boundary: the closed range is the wire contract; a violation
    // is a rejected payload, never a silent clamp to the default window.
    limit: z.number().int().min(1).max(MESSAGE_CAP).optional(),
  }),
]) satisfies z.ZodType<Wire<RequestPayload<'team.projection'>>>

/** team.projection response value: the page first (explicit `kind`), then the kind-less snapshot. */
export const teamProjectionValueSchema = z.union([
  teamMessagePageSchema,
  teamViewSchema,
]) as unknown as z.ZodType<Wire<TeamProjectionValue>>
