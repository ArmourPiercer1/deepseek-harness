/**
 * Seeding of a continuable child's durable descriptor event: the model-hidden
 * record of the child's declared composition before its first request, so a
 * later cold resume can reconstruct it from its own log.
 *
 * @module @deepseek-ai/dsh-subagent/descriptor-seed
 */

import { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentDescriptorData } from './descriptor.ts'
import type { DelegationEventAppend } from './types.ts'

/**
 * Build the child's creation seed: any inherited parent-history prefix followed
 * by one model-hidden, between-turn `descriptor` event. Staging through a
 * `Session` assigns the sequence number and enforces the same lossless-JSON
 * rules the durable log does.
 * @param childId - the reserved child session id the staged log belongs to.
 * @param seed - the inherited completed-turn prefix, or `undefined` for a fresh child.
 * @param descriptor - the snapshotted composition record to persist.
 * @param delegationEvents - durable events a plugin seeds into the child's own
 *   suffix, appended after the descriptor; reconstructed verbatim on cold resume.
 * @returns the complete seed events, contiguous from sequence zero.
 */
export function seedDescriptorTurn(
  childId: SessionId,
  seed: readonly SessionEvent[] | undefined,
  descriptor: SubagentDescriptorData,
  delegationEvents?: readonly DelegationEventAppend[],
): SessionEvent[] {
  const staged = Session.create(childId, seed)
  staged.append('subagent/descriptor', descriptor)
  for (const event of delegationEvents ?? []) {
    staged.append(event.type, event.data)
  }
  return [...staged.events]
}
