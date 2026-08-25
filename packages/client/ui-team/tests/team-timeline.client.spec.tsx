// @vitest-environment jsdom
/**
 * Team timeline section: the one-line cold state without delegations, the
 * teammate-only lane matrix with stable colors, multi-span and running-span
 * geometry against the local clock, wheel zoom / drag pan / keyboard
 * gestures, the bar tooltip, the D9 click-to-switch, and the D7 lane
 * highlight.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TeamView } from '@deepseek-ai/dsh-client-runtime/client'
import { TeamTimeline, type TeamTimelineProps } from '../src/client/TeamTimeline.tsx'
import { zh } from '../src/client/locales.ts'

const T = 1_700_000_000_000

const baseView: TeamView = {
  teamId: 'leader-s',
  leaderSessionId: 'leader-s',
  rosterMemberCount: 3,
  members: [
    {
      memberId: 'lead', name: 'Lead', role: 'leader', sessionIds: ['leader-s'],
      status: 'bound', pendingControlCount: 0,
    },
    {
      memberId: 'a', name: 'Alpha', role: 'teammate', sessionIds: ['sa'],
      status: 'bound', pendingControlCount: 0,
    },
    {
      memberId: 'b', name: 'Beta', role: 'teammate', sessionIds: ['sb'],
      status: 'bound', pendingControlCount: 0,
    },
  ],
  delegations: [
    { memberId: 'a', childSessionId: 'sa', startedAt: T, endedAt: T + 90_000, inProgress: false },
    {
      memberId: 'a', childSessionId: 'sa', startedAt: T + 200_000,
      endedAt: T + 290_000, inProgress: false,
    },
    { memberId: 'b', childSessionId: 'sb', startedAt: T + 100_000, inProgress: true },
  ],
  tasks: [],
  approvals: [],
  messages: [],
  messageCount: 0,
}

function makeProps(
  view: TeamView = baseView,
  onSelectSession: (sessionId: string) => void = vi.fn(),
  currentMemberId?: string,
): TeamTimelineProps {
  return { view, currentMemberId, onSelectSession, t: makeTranslate(zh) }
}

function trackOf(container: HTMLElement): HTMLElement {
  const track = container.querySelector<HTMLElement>('[data-team-timeline-track]')
  if (track === null) throw new Error('the track did not render')
  return track
}

function mockTrackRect(container: HTMLElement, width = 600): void {
  vi.spyOn(trackOf(container), 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: 100, width, height: 100,
    toJSON: () => ({}),
  })
}

function domainOf(container: HTMLElement): HTMLElement {
  const domain = container.querySelector<HTMLElement>('[data-team-timeline-domain]')
  if (domain === null) throw new Error('the domain did not render')
  return domain
}

const fraction = (part: number, whole: number): string => `${(part / whole) * 100}%`

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T + 300_000)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete (Element.prototype as { setPointerCapture?: unknown }).setPointerCapture
  delete (Element.prototype as { releasePointerCapture?: unknown }).releasePointerCapture
})

describe('TeamTimeline', () => {
  it('shows the one-line cold state without a lane matrix', () => {
    const { container } = render(<TeamTimeline {...makeProps({ ...baseView, delegations: [] })} />)
    expect(screen.getByText('暂无委派记录')).toBeTruthy()
    expect(container.querySelector('[data-team-lane]')).toBeNull()
    expect(container.querySelector('[data-team-timeline-track]')).toBeNull()
  })

  it('draws one labeled lane per teammate in members order, never the leader', () => {
    const { container } = render(<TeamTimeline {...makeProps()} />)
    const labels = container.querySelectorAll<HTMLElement>('[data-team-lane-label]')
    expect(labels).toHaveLength(2)
    expect(labels[0]?.textContent).toContain('Alpha')
    expect(labels[1]?.textContent).toContain('Beta')
    expect(labels[0]?.dataset.laneColor).toBe('0')
    expect(labels[1]?.dataset.laneColor).toBe('1')
    expect(container.textContent).not.toContain('Lead')
    expect(container.querySelectorAll('[data-team-lane]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-team-timeline-bar]')).toHaveLength(3)
  })

  it('lays a member\u2019s multiple spans along the axis without overlap', () => {
    const { container } = render(<TeamTimeline {...makeProps()} />)
    const bars = container.querySelectorAll<HTMLElement>('[data-team-timeline-bar]')
    const [first, second] = bars
    expect(first?.style.getPropertyValue('--team-bar-left')).toBe(fraction(0, 300_000))
    expect(first?.style.getPropertyValue('--team-bar-width')).toBe(fraction(90_000, 300_000))
    expect(second?.style.getPropertyValue('--team-bar-left')).toBe(fraction(200_000, 300_000))
    expect(second?.style.getPropertyValue('--team-bar-width')).toBe(fraction(90_000, 300_000))
    const starts = parseFloat(second?.style.getPropertyValue('--team-bar-left') ?? '0')
    const used = parseFloat(first?.style.getPropertyValue('--team-bar-left') ?? '0')
      + parseFloat(first?.style.getPropertyValue('--team-bar-width') ?? '0')
    expect(starts).toBeGreaterThanOrEqual(used)
  })

  it('marks the running bar and extends it to the local clock', () => {
    const { container } = render(<TeamTimeline {...makeProps()} />)
    const bars = container.querySelectorAll<HTMLElement>('[data-team-timeline-bar]')
    expect(bars[0]?.dataset.running).toBeUndefined()
    expect(bars[2]?.dataset.running).toBe('true')
    expect(bars[2]?.style.getPropertyValue('--team-bar-width')).toBe(fraction(200_000, 300_000))
  })

  it('advances the running span as the local clock ticks, and stays static when settled', () => {
    const view = render(<TeamTimeline {...makeProps()} />)
    const runningBar = () => view.container.querySelectorAll<HTMLElement>('[data-team-timeline-bar]')[2]
    expect(runningBar()?.style.getPropertyValue('--team-bar-width')).toBe(fraction(200_000, 300_000))
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(runningBar()?.style.getPropertyValue('--team-bar-width')).toBe(fraction(230_000, 330_000))

    const settled = {
      ...baseView,
      delegations: baseView.delegations.filter(delegation => !delegation.inProgress),
    }
    const staticView = render(<TeamTimeline {...makeProps(settled)} />)
    const settledBar = () => staticView.container.querySelectorAll<HTMLElement>('[data-team-timeline-bar]')[1]
    expect(settledBar()?.style.getPropertyValue('--team-bar-width')).toBe(fraction(90_000, 290_000))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(settledBar()?.style.getPropertyValue('--team-bar-width')).toBe(fraction(90_000, 290_000))
  })

  it('zooms with the wheel at the pointer, resets with double click, and caps at the full domain', () => {
    const view = render(<TeamTimeline {...makeProps()} />)
    mockTrackRect(view.container)
    const domain = domainOf(view.container)
    expect(domain.style.getPropertyValue('--team-domain-width')).toBe('100%')
    // deltaY -1000 → factor exp(-1.5) ≈ 0.223 → the visible domain is ≈67 s.
    expect(fireEvent.wheel(view.container.querySelector('[data-team-timeline]')!, {
      clientX: 300,
      deltaY: -1_000,
    })).toBe(false)
    const width = parseFloat(domain.style.getPropertyValue('--team-domain-width'))
    expect(width).toBeGreaterThan(400)
    expect(width).toBeLessThan(500)
    const left = parseFloat(domain.style.getPropertyValue('--team-domain-left'))
    expect(left).toBeLessThan(-25)
    expect(left).toBeGreaterThan(-50)
    // Zooming out past the full domain drops the viewport.
    fireEvent.wheel(view.container.querySelector('[data-team-timeline]')!, {
      clientX: 300,
      deltaY: 1_000,
    })
    expect(domain.style.getPropertyValue('--team-domain-width')).toBe('100%')
    // Double click resets a zoomed viewport.
    fireEvent.wheel(view.container.querySelector('[data-team-timeline]')!, {
      clientX: 300,
      deltaY: -1_000,
    })
    fireEvent.doubleClick(trackOf(view.container))
    expect(domain.style.getPropertyValue('--team-domain-width')).toBe('100%')
  })

  it('pans a zoomed viewport with a left-button drag without selecting', () => {
    const onSelectSession = vi.fn()
    const view = render(<TeamTimeline {...makeProps(baseView, onSelectSession)} />)
    mockTrackRect(view.container)
    const track = trackOf(view.container)
    const domain = domainOf(view.container)
    fireEvent.wheel(view.container.querySelector('[data-team-timeline]')!, {
      clientX: 300,
      deltaY: -1_000,
    })
    const before = parseFloat(domain.style.getPropertyValue('--team-domain-left'))
    fireEvent.pointerDown(track, { button: 0, clientX: 300, pointerId: 1 })
    expect(track.getAttribute('data-panning')).toBe('true')
    fireEvent.pointerMove(track, { clientX: 400, pointerId: 1 })
    const after = parseFloat(domain.style.getPropertyValue('--team-domain-left'))
    // Dragging right reveals earlier time: the domain start drops, so the
    // negative left offset grows back toward zero.
    expect(after).not.toBe(before)
    expect(after).toBeGreaterThan(before)
    fireEvent.pointerUp(track, { clientX: 400, pointerId: 1 })
    expect(track.getAttribute('data-panning')).toBeNull()
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('pans with the right button and suppresses the context menu', () => {
    const onSelectSession = vi.fn()
    const view = render(<TeamTimeline {...makeProps(baseView, onSelectSession)} />)
    mockTrackRect(view.container)
    const track = trackOf(view.container)
    const domain = domainOf(view.container)
    fireEvent.wheel(view.container.querySelector('[data-team-timeline]')!, {
      clientX: 300,
      deltaY: -1_000,
    })
    const before = parseFloat(domain.style.getPropertyValue('--team-domain-left'))
    fireEvent.pointerDown(track, { button: 2, clientX: 300, pointerId: 1 })
    expect(track.getAttribute('data-panning')).toBe('true')
    expect(fireEvent.contextMenu(track)).toBe(false)
    fireEvent.pointerMove(track, { clientX: 350, pointerId: 1 })
    fireEvent.pointerUp(track, { button: 2, clientX: 350, pointerId: 1 })
    expect(parseFloat(domain.style.getPropertyValue('--team-domain-left'))).not.toBe(before)
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('ignores moves from another pointer and a sub-threshold jiggle', () => {
    const onSelectSession = vi.fn()
    const view = render(<TeamTimeline {...makeProps(baseView, onSelectSession)} />)
    mockTrackRect(view.container)
    const track = trackOf(view.container)
    fireEvent.pointerDown(track, { button: 0, clientX: 300, pointerId: 1 })
    expect(track.getAttribute('data-panning')).toBe('true')
    // A move from a different pointer is not this gesture's.
    fireEvent.pointerMove(track, { clientX: 400, pointerId: 2 })
    // A 1 px jiggle from the captured pointer stays under the drag threshold.
    fireEvent.pointerMove(track, { clientX: 301, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: 301, pointerId: 1 })
    expect(track.getAttribute('data-panning')).toBeNull()
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('drops the gesture on pointer cancel', () => {
    const view = render(<TeamTimeline {...makeProps()} />)
    mockTrackRect(view.container)
    const track = trackOf(view.container)
    fireEvent.pointerDown(track, { button: 0, clientX: 300, pointerId: 1 })
    expect(track.getAttribute('data-panning')).toBe('true')
    fireEvent.pointerCancel(track)
    expect(track.getAttribute('data-panning')).toBeNull()
  })

  it('ignores middle-button presses', () => {
    const onSelectSession = vi.fn()
    const view = render(<TeamTimeline {...makeProps(baseView, onSelectSession)} />)
    mockTrackRect(view.container)
    const track = trackOf(view.container)
    fireEvent.pointerDown(track, { button: 1, clientX: 300, pointerId: 1 })
    expect(track.getAttribute('data-panning')).toBeNull()
    fireEvent.pointerUp(track, { button: 1, clientX: 300, pointerId: 1 })
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('switches to the member session on a bar click', () => {
    const onSelectSession = vi.fn()
    const view = render(<TeamTimeline {...makeProps(baseView, onSelectSession)} />)
    const bars = view.container.querySelectorAll<HTMLElement>('[data-team-timeline-bar]')
    const barA = bars[0]
    if (barA === undefined) throw new Error('the first bar did not render')
    fireEvent.pointerDown(barA, { button: 0, clientX: 10, pointerId: 1 })
    fireEvent.pointerUp(barA, { clientX: 10, pointerId: 1 })
    expect(onSelectSession).toHaveBeenCalledTimes(1)
    expect(onSelectSession).toHaveBeenCalledWith('sa')
  })

  it('treats a bar press that moves as a pan, not a click', () => {
    const onSelectSession = vi.fn()
    const view = render(<TeamTimeline {...makeProps(baseView, onSelectSession)} />)
    mockTrackRect(view.container)
    const track = trackOf(view.container)
    const bars = view.container.querySelectorAll<HTMLElement>('[data-team-timeline-bar]')
    const barA = bars[0]
    if (barA === undefined) throw new Error('the first bar did not render')
    fireEvent.pointerDown(barA, { button: 0, clientX: 10, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: 60, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: 60, pointerId: 1 })
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('pans and zooms by keyboard and resets with 0 or Escape', () => {
    const view = render(<TeamTimeline {...makeProps()} />)
    mockTrackRect(view.container)
    const track = trackOf(view.container)
    const domain = domainOf(view.container)
    const left = () => parseFloat(domain.style.getPropertyValue('--team-domain-left'))
    const width = () => domain.style.getPropertyValue('--team-domain-width')
    // Zoom in so the pan has room, then walk the visible domain by key.
    fireEvent.keyDown(track, { key: '+' })
    expect(width()).not.toBe('100%')
    const zoomedLeft = left()
    // ArrowRight advances the start, so the domain's left edge goes more negative.
    fireEvent.keyDown(track, { key: 'ArrowRight' })
    expect(left()).toBeLessThan(zoomedLeft)
    // A shift-stretched step advances five times as far, clamping at the edge.
    const afterSingle = left()
    fireEvent.keyDown(track, { key: 'ArrowRight', shiftKey: true })
    expect(left()).toBeLessThan(afterSingle)
    // A shift step back lands exactly back on the zoom anchor.
    fireEvent.keyDown(track, { key: 'ArrowLeft', shiftKey: true })
    expect(left()).toBe(zoomedLeft)
    fireEvent.keyDown(track, { key: 'ArrowLeft' })
    // '=' zooms in, '-' zooms out, and from the full domain '-' resets.
    fireEvent.keyDown(track, { key: '0' })
    expect(width()).toBe('100%')
    // At the full domain an edge pan clamps and stays put.
    fireEvent.keyDown(track, { key: 'ArrowLeft' })
    expect(width()).toBe('100%')
    expect(left()).toBe(0)
    fireEvent.keyDown(track, { key: '=' })
    expect(width()).not.toBe('100%')
    fireEvent.keyDown(track, { key: '-' })
    expect(width()).toBe('100%')
    // Unhandled keys are a no-op.
    fireEvent.keyDown(track, { key: 'a' })
    expect(width()).toBe('100%')
    // Escape also resets.
    fireEvent.keyDown(track, { key: '+' })
    expect(width()).not.toBe('100%')
    fireEvent.keyDown(track, { key: 'Escape' })
    expect(width()).toBe('100%')
  })

  it('tooltips a bar with the member name, range, duration, and running marker', () => {
    const view = render(<TeamTimeline {...makeProps()} />)
    const bars = view.container.querySelectorAll<HTMLElement>('[data-team-timeline-bar]')
    const runningBar = bars[2]
    if (runningBar === undefined) throw new Error('the running bar did not render')
    fireEvent.mouseOver(runningBar)
    act(() => { vi.advanceTimersByTime(250) })
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toContain('Beta')
    expect(tooltip.textContent).toContain(' → ')
    expect(tooltip.textContent).toContain('3分20秒')
    expect(tooltip.textContent).toContain('（进行中）')
    fireEvent.mouseOut(runningBar, { relatedTarget: view.container })
    expect(screen.queryByRole('tooltip')).toBeNull()

    const settledBar = bars[0]
    if (settledBar === undefined) throw new Error('the settled bar did not render')
    fireEvent.mouseOver(settledBar)
    act(() => { vi.advanceTimersByTime(250) })
    const settledTooltip = screen.getByRole('tooltip')
    expect(settledTooltip.textContent).toContain('Alpha')
    expect(settledTooltip.textContent).toContain('1分30秒')
    expect(settledTooltip.textContent).not.toContain('（进行中）')
  })

  it('highlights the current session\u2019s member lane', () => {
    const view = render(<TeamTimeline {...makeProps(baseView, vi.fn(), 'a')} />)
    const labels = view.container.querySelectorAll<HTMLElement>('[data-team-lane-label]')
    const lanes = view.container.querySelectorAll<HTMLElement>('[data-team-lane]')
    expect(labels[0]?.dataset.current).toBe('true')
    expect(labels[1]?.dataset.current).toBeUndefined()
    expect(lanes[0]?.dataset.current).toBe('true')
    expect(lanes[1]?.dataset.current).toBeUndefined()
  })

  it('keeps an unbound member on the matrix with a non-interactive bar', () => {
    const onSelectSession = vi.fn()
    const view = render(<TeamTimeline {...makeProps({
      ...baseView,
      members: [
        ...baseView.members,
        {
          memberId: 'c', name: 'Gamma', role: 'teammate', sessionIds: [],
          status: 'unbound', pendingControlCount: 0,
        },
      ],
      delegations: [
        ...baseView.delegations,
        {
          memberId: 'c', childSessionId: '', startedAt: T + 100_000,
          endedAt: T + 120_000, inProgress: false,
        },
      ],
    }, onSelectSession)} />)
    // The unbound member still gets a lane and its bar renders.
    const lanes = view.container.querySelectorAll('[data-team-lane]')
    expect(lanes).toHaveLength(3)
    expect(view.container.textContent).toContain('Gamma')
    // Without a bound session the bar carries no session attribute, so a
    // click switches nowhere.
    const inertBar = lanes[lanes.length - 1]?.querySelector('span')
    if (inertBar === null || inertBar === undefined) throw new Error('the unbound bar did not render')
    expect(inertBar.hasAttribute('data-team-timeline-bar')).toBe(false)
    fireEvent.pointerDown(inertBar, { button: 0, clientX: 10, pointerId: 1 })
    fireEvent.pointerUp(inertBar, { clientX: 10, pointerId: 1 })
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('renders axis tick labels inside the visible domain', () => {
    const { container } = render(<TeamTimeline {...makeProps()} />)
    const ticks = Array.from(container.querySelectorAll('span'))
      .filter(element => /^\d{2}:\d{2}:\d{2}$/.test(element.textContent ?? ''))
    expect(ticks.length).toBeGreaterThan(0)
  })
})
