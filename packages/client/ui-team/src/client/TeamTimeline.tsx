/**
 * The "团队" tab's timeline section (the first of the four sections): one
 * lane per teammate (side labels carry the name and the stable lane color;
 * the leader gets no lane), one bar per delegation span over the linear
 * honest time domain, wheel zoom at the pointer, drag pan, keyboard
 * pan/zoom/reset, hover tooltips (name, range, duration), and
 * bar-click-to-switch into the member's session. The running span's "now"
 * is a component-local clock — no external subscription here.
 */
import {
  useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TeamView } from '@deepseek-ai/dsh-client-runtime/client'
import {
  deriveTeamTimeline, formatTeamClock, formatTeamDuration, teamTimelineTicks,
  type TeamTimelineSpan,
} from './team-timeline-model.ts'
import styles from './TeamTimeline.module.css'

/** The deepest zoom of the visible domain (ms). */
const MINIMUM_ZOOM_MS = 1_000
/** A press under this radius reads as a click, not a drag (px). */
const MINIMUM_DRAG_PX = 3
/** Wheel deltaY → zoom-factor exponent. */
const WHEEL_ZOOM_EXPONENT = 0.0015
/** The tooltip reveal delay (ms). */
const TIMELINE_TOOLTIP_DELAY_MS = 200
/** The local "now" tick while a span runs (ms). */
const RUNNING_TICK_MS = 1_000

/** One in-flight pan or click press on the track. */
interface PanGesture {
  pointerId: number
  button: number
  anchorClientX: number
  anchorStart: number
  /** The session the press started on a bar with, or null off the bars. */
  barSessionId: string | null
  moved: boolean
}

/** The timeline section props: the team view, the D9 navigation callback, and the team dictionary. */
export interface TeamTimelineProps {
  /** The leader-keyed team view snapshot (the mirror's own reference). */
  view: TeamView
  /** The member row the current session binds to; that lane is highlighted. */
  currentMemberId?: string | undefined
  /** Switch the current session to the clicked bar's member session. */
  onSelectSession: (sessionId: string) => void
  /** The team dictionary translate seat. */
  t: PropsLocale<'team'>['t']
}

/**
 * Compose one bar's tooltip label: the member name, the start → end clock
 * range (the effective end while running), the duration, and the running
 * marker.
 * @param name - the lane's member name.
 * @param span - the bar's projection row.
 * @param t - the team dictionary translate seat.
 * @returns the two-line tooltip label.
 */
function barTooltipLabel(name: string, span: TeamTimelineSpan, t: PropsLocale<'team'>['t']): string {
  const running = span.inProgress ? `（${t('view.timeline.running')}）` : ''
  return `${name}\n${formatTeamClock(span.startedAt)} → ${formatTeamClock(span.endedAt)}`
    + ` · ${formatTeamDuration(span.endedAt - span.startedAt)}${running}`
}

/**
 * The team timeline section (D8a–D8d, D9).
 * @param props - the team view, the current member highlight, the session-switch callback, and the dictionary.
 * @returns the timeline section.
 */
export function TeamTimeline({
  view, currentMemberId, onSelectSession, t,
}: TeamTimelineProps): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const model = useMemo(() => deriveTeamTimeline(view, now), [view, now])
  const hasRunning = model !== null
    && model.lanes.some(lane => lane.spans.some(span => span.inProgress))
  useEffect(() => {
    if (!hasRunning) return
    const timer = setInterval(() => { setNow(Date.now()) }, RUNNING_TICK_MS)
    return () => { clearInterval(timer) }
  }, [hasRunning])

  const [viewport, setViewport] = useState<{ start: number; end: number } | null>(null)
  const [panning, setPanning] = useState(false)
  const panRef = useRef<PanGesture | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const fullDuration = model === null ? 1 : Math.max(1, model.end - model.start)
  const viewportDuration = model === null || viewport === null
    ? fullDuration
    : Math.min(fullDuration, Math.max(1, viewport.end - viewport.start))
  const domainDuration = viewportDuration
  const domainStart = model === null || viewport === null
    ? model?.start ?? 0
    : Math.min(Math.max(viewport.start, model.start), model.end - viewportDuration)

  useEffect(() => {
    const root = rootRef.current
    /* v8 ignore next -- the section ref is attached in the same commit as this effect. */
    if (root === null || model === null) return
    const onWheel = (event: globalThis.WheelEvent): void => {
      event.preventDefault()
      const track = trackRef.current
      /* v8 ignore next -- the track renders unconditionally inside the section. */
      if (track === null) return
      const rect = track.getBoundingClientRect()
      const anchorFraction = Math.min(
        1,
        Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)),
      )
      /* jscpd:ignore-start -- D8d: home-grown wheel-zoom math paralleling TrajectoryTimeline (cross-package import forbidden) */
      const nextDuration = Math.min(
        fullDuration,
        Math.max(MINIMUM_ZOOM_MS, domainDuration * Math.exp(event.deltaY * WHEEL_ZOOM_EXPONENT)),
      )
      if (nextDuration >= fullDuration * 0.999) {
        setViewport(null)
        return
      }
      const anchorTime = domainStart + anchorFraction * domainDuration
      const nextStart = Math.min(
        Math.max(anchorTime - anchorFraction * nextDuration, model.start),
        model.end - nextDuration,
      )
      setViewport({ start: nextStart, end: nextStart + nextDuration })
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => { root.removeEventListener('wheel', onWheel) }
  }, [domainDuration, domainStart, fullDuration, model])
  /* jscpd:ignore-end */

  if (model === null) {
    return (
      <section ref={rootRef} className={styles.root} data-team-timeline>
        <p className={styles.empty} data-team-timeline-empty>{t('view.timeline.empty')}</p>
      </section>
    )
  }

  const projectedDomainStyle = {
    '--team-domain-left': `${(-(domainStart - model.start) / fullDuration) * 100}%`,
    '--team-domain-width': `${(fullDuration / domainDuration) * 100}%`,
  } as CSSProperties
  const ticks = teamTimelineTicks(domainStart, domainStart + domainDuration)

  const barSessionIdAt = (event: PointerEvent<HTMLDivElement>): string | null => {
    /* v8 ignore next -- a browser pointer event's target is always an element; the check only narrows the synthetic event type. */
    const target = event.target instanceof HTMLElement ? event.target : null
    return target?.closest<HTMLElement>('[data-team-timeline-bar]')
      ?.dataset.teamTimelineBar ?? null
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 2) return
    setPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = {
      pointerId: event.pointerId,
      button: event.button,
      anchorClientX: event.clientX,
      anchorStart: domainStart,
      barSessionId: barSessionIdAt(event),
      moved: false,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (pan === null || pan.pointerId !== event.pointerId) return
    if (Math.abs(event.clientX - pan.anchorClientX) >= MINIMUM_DRAG_PX) pan.moved = true
    const rect = event.currentTarget.getBoundingClientRect()
    /* jscpd:ignore-start -- D8d: home-grown pan math paralleling TrajectoryTimeline (cross-package import forbidden) */
    const delta = (event.clientX - pan.anchorClientX) / Math.max(1, rect.width)
    const nextStart = Math.min(
      Math.max(pan.anchorStart - delta * domainDuration, model.start),
      model.end - domainDuration,
    )
    setViewport({ start: nextStart, end: nextStart + domainDuration })
  }
  /* jscpd:ignore-end */

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (pan === null || pan.pointerId !== event.pointerId) return
    const moved = pan.moved || Math.abs(event.clientX - pan.anchorClientX) >= MINIMUM_DRAG_PX
    panRef.current = null
    setPanning(false)
    if (!moved && pan.button === 0 && pan.barSessionId !== null) {
      onSelectSession(pan.barSessionId)
    }
  }

  const onPointerCancel = () => {
    panRef.current = null
    setPanning(false)
  }

  const panByFraction = (fraction: number) => {
    const nextStart = Math.min(
      Math.max(domainStart + fraction * domainDuration, model.start),
      model.end - domainDuration,
    )
    if (nextStart === domainStart) return
    setViewport({ start: nextStart, end: nextStart + domainDuration })
  }

  const zoomBy = (factor: number) => {
    const nextDuration = Math.min(
      fullDuration,
      Math.max(MINIMUM_ZOOM_MS, domainDuration * factor),
    )
    if (nextDuration >= fullDuration * 0.999) {
      setViewport(null)
      return
    }
    const center = domainStart + domainDuration / 2
    const nextStart = Math.min(
      Math.max(center - nextDuration / 2, model.start),
      model.end - nextDuration,
    )
    setViewport({ start: nextStart, end: nextStart + nextDuration })
  }

  const reset = () => { setViewport(null) }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        panByFraction(-0.1 * (event.shiftKey ? 5 : 1))
        return
      case 'ArrowRight':
        event.preventDefault()
        panByFraction(0.1 * (event.shiftKey ? 5 : 1))
        return
      case '+':
      case '=':
        event.preventDefault()
        zoomBy(0.5)
        return
      case '-':
      case '_':
        event.preventDefault()
        zoomBy(2)
        return
      case '0':
      case 'Escape':
        event.preventDefault()
        reset()
        return
      default:
        return
    }
  }

  return (
    <section ref={rootRef} className={styles.root} data-team-timeline>
      <div
        className={styles.plot}
        style={{ '--team-lane-count': model.lanes.length } as CSSProperties}
      >
        <div className={styles.corner} aria-hidden="true" />
        <div className={styles.axis} aria-hidden="true">
          <div className={styles.domain} style={projectedDomainStyle}>
            {ticks.map(tick => (
              <span
                key={tick}
                className={styles.tick}
                style={{
                  '--team-tick-left': `${((tick - model.start) / fullDuration) * 100}%`,
                } as CSSProperties}
              >
                {formatTeamClock(tick)}
              </span>
            ))}
          </div>
        </div>
        <div className={styles.gutter}>
          {model.lanes.map(lane => (
            <div
              key={lane.memberId}
              className={styles.gutterRow}
              data-team-lane-label
              data-lane={lane.lane}
              data-lane-color={lane.colorSlot}
              data-current={lane.memberId === currentMemberId || undefined}
            >
              <span className={styles.swatch} aria-hidden="true" />
              <span className={styles.laneName}>{lane.name}</span>
            </div>
          ))}
        </div>
        <div
          ref={trackRef}
          className={styles.track}
          data-panning={panning || undefined}
          data-team-timeline-track
          tabIndex={0}
          aria-label={t('view.timeline.aria')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyDown={onKeyDown}
          onDoubleClick={(event) => {
            event.preventDefault()
            reset()
          }}
          onContextMenu={(event) => { event.preventDefault() }}
        >
          <div
            className={styles.domain}
            data-team-timeline-domain
            style={projectedDomainStyle}
          >
            {model.lanes.map(lane => (
              <div
                key={lane.memberId}
                className={styles.lane}
                data-team-lane
                data-lane-color={lane.colorSlot}
                data-current={lane.memberId === currentMemberId || undefined}
              >
                {lane.spans.map(span => (
                  <Tooltip
                    key={span.key}
                    label={() => barTooltipLabel(lane.name, span, t)}
                    side="top"
                    delayMs={TIMELINE_TOOLTIP_DELAY_MS}
                  >
                    <span
                      className={styles.bar}
                      data-team-timeline-bar={lane.sessionId === '' ? undefined : lane.sessionId}
                      data-running={span.inProgress || undefined}
                      aria-hidden="true"
                      style={{
                        '--team-bar-left': `${((span.startedAt - model.start) / fullDuration) * 100}%`,
                        '--team-bar-width': `${((span.endedAt - span.startedAt) / fullDuration) * 100}%`,
                      } as CSSProperties}
                    />
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
