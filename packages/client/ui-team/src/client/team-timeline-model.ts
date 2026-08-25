/**
 * Pure projection of the leader-keyed team view into the "团队" tab's
 * timeline section: one lane per teammate in `members` order (the lane's
 * color slot walks the fixed CSS ramp by index), one bar per delegation
 * span, and the linear honest time domain — the earliest team timestamp
 * (a delegation start, or a task event when a task was recorded before its
 * delegation) to the last settlement, extended to the caller's clock while
 * any span runs. Idle gaps stay gaps: nothing here compresses, clamps, or
 * reads a wall clock. React-free; the renderer supplies the snapshot and
 * the clock.
 */
import type { TeamView } from '@deepseek-ai/dsh-client-runtime/client'

/** One delegation bar inside a lane (the effective end folds in "now"). */
export interface TeamTimelineSpan {
  /** Stable React key across mirror frames. */
  readonly key: string
  /** The delegate call's event time (epoch ms). */
  readonly startedAt: number
  /** The settlement time; the caller's clock while the span runs. */
  readonly endedAt: number
  /** True while no settlement has closed the span (drives the running motion). */
  readonly inProgress: boolean
}

/** One teammate lane: the side label plus its bars in start-time order. */
export interface TeamTimelineLane {
  readonly memberId: string
  /** Roster name; a not-rostered fallback lane shows the raw member id. */
  readonly name: string
  /** Row index, top to bottom. */
  readonly lane: number
  /** Palette slot: the lane's position modulo the ramp length below. */
  readonly colorSlot: number
  /** The member's bound session for the click-to-switch; '' when unbound. */
  readonly sessionId: string
  readonly spans: readonly TeamTimelineSpan[]
}

/** The rendered projection; `null` means "no delegations" (one-line empty state). */
export interface TeamTimelineModel {
  readonly start: number
  readonly end: number
  readonly lanes: readonly TeamTimelineLane[]
}

/** Lane-color ramp length; the CSS module defines one slot per index. */
export const TEAM_LANE_COLOR_SLOTS = 8

/** Mutable lane while the fold runs; the returned lanes freeze its spans. */
interface LaneBuild {
  id: string
  name: string
  sessionId: string
  spans: TeamTimelineSpan[]
}

/**
 * Project the view's delegations onto teammate lanes over the linear time
 * domain.
 * @param view - the leader-keyed team view snapshot.
 * @param now - the caller's clock (epoch ms); read by running spans only.
 * @returns the lane model, or `null` when the view carries no delegations
 *   (the renderer then shows the one-line empty state instead of a lane
 *   matrix).
 */
export function deriveTeamTimeline(view: TeamView, now: number): TeamTimelineModel | null {
  const delegations = view.delegations
  if (delegations.length === 0) return null

  let start = Infinity
  let end = -Infinity
  for (const delegation of delegations) {
    if (delegation.startedAt < start) start = delegation.startedAt
    const settled = delegation.endedAt ?? delegation.startedAt
    const closing = delegation.inProgress ? Math.max(settled, now) : settled
    if (closing > end) end = closing
  }
  for (const task of view.tasks) {
    if (task.at < start) start = task.at
    if (task.at > end) end = task.at
  }
  if (end <= start) end = start + 1

  const builds: LaneBuild[] = []
  const buildById = new Map<string, LaneBuild>()
  for (const member of view.members) {
    if (member.role !== 'teammate') continue
    const build: LaneBuild = {
      id: member.memberId,
      name: member.name,
      sessionId: member.sessionIds[0] ?? '',
      spans: [],
    }
    builds.push(build)
    buildById.set(member.memberId, build)
  }
  delegations.forEach((delegation, index) => {
    let build = buildById.get(delegation.memberId)
    // A delegation id that never reached a member row still renders: a
    // fallback lane named by the raw id, appended after the roster lanes in
    // first-seen order, instead of silently dropping the bar.
    if (build === undefined) {
      build = { id: delegation.memberId, name: delegation.memberId, sessionId: '', spans: [] }
      builds.push(build)
      buildById.set(delegation.memberId, build)
    }
    const settled = delegation.endedAt ?? delegation.startedAt
    build.spans.push({
      key: `${delegation.memberId}:${delegation.startedAt}:${index}`,
      startedAt: delegation.startedAt,
      endedAt: delegation.inProgress ? Math.max(settled, now) : settled,
      inProgress: delegation.inProgress,
    })
  })

  const lanes: TeamTimelineLane[] = builds.map((build, lane) => ({
    memberId: build.id,
    name: build.name,
    lane,
    colorSlot: lane % TEAM_LANE_COLOR_SLOTS,
    sessionId: build.sessionId,
    spans: build.spans.sort((left, right) => left.startedAt - right.startedAt),
  }))
  return { start, end, lanes }
}

/**
 * Pick "nice" axis ticks inside one visible domain: the step is the first
 * 1/2/5×10^n multiple at or above the raw span, so label density stays near
 * the target across zoom levels.
 * @param start - visible domain start (epoch ms).
 * @param end - visible domain end (epoch ms, inclusive).
 * @param target - approximate tick count (default 6).
 * @returns ascending tick times, or the single point for a degenerate domain.
 */
export function teamTimelineTicks(start: number, end: number, target = 6): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  if (end === start) return [start]
  const rawStep = (end - start) / Math.max(1, target - 1)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
  const first = Math.ceil(start / step) * step
  const count = Math.floor((end - first) / step) + 1
  return Array.from({ length: Math.max(0, count) }, (_, index) => first + index * step)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Format one epoch-ms mark as a fixed 24-hour `HH:MM:SS` label in the local
 * timezone. Deliberately locale-free (no localized number or weekday
 * formatting): the print format is identical on every host; the wall-clock
 * readout follows the browser's timezone like every other local time on the
 * page.
 * @param timestamp - epoch milliseconds.
 * @returns the clock label.
 */
export function formatTeamClock(timestamp: number): string {
  const date = new Date(timestamp)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/**
 * Format a non-negative duration as a Chinese label: sub-second rounds to
 * `N毫秒`, seconds keep one decimal below 10 s, then `N分NN秒`, then
 * `N小时NN分`.
 * @param milliseconds - duration in milliseconds (negative or non-finite reads as 0).
 * @returns the duration label.
 */
export function formatTeamDuration(milliseconds: number): string {
  const ms = Number.isFinite(milliseconds) && milliseconds > 0 ? Math.floor(milliseconds) : 0
  if (ms < 1_000) return `${ms}毫秒`
  if (ms < 60_000) {
    const seconds = ms / 1_000
    return `${seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds)}秒`
  }
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}分${pad2(Math.floor((ms % 60_000) / 1_000))}秒`
  }
  return `${Math.floor(ms / 3_600_000)}小时${pad2(Math.floor((ms % 3_600_000) / 60_000))}分`
}
