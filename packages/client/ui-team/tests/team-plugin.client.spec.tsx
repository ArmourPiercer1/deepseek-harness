// @vitest-environment jsdom
/**
 * Plugin lifecycle of the team UI browser half: the settings section, the
 * inline team marker Conversation Node definition and its keyed Chat
 * renderer (inject face: the shared mirror source plus the session-open
 * callback), the team view tab, the resident input dock (order 15 — between
 * the goal bar and the queue strip), and the locale dictionaries all land
 * with the fiber and leave with it; a sessions face without the team
 * capability still gets every registration with the static empty mirror
 * source. The node half stays inert and the invariant companion reserves
 * package ownership.
 */
import { Context } from '@deepseek-ai/cordis'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { TeamSettingsSection } from '../src/client/TeamSettingsSection.tsx'
import { zh } from '../src/client/locales.ts'
import { apply as applyNode } from '../src/index.ts'
import { apply as applyInvariant } from '../src/invariant.ts'
import type {} from '../src/client/index.ts'

afterEach(cleanup)

describe('TeamSettingsSection', () => {
  it('renders the read-only configuration instructions', () => {
    render(<TeamSettingsSection {...({ t: makeTranslate(zh) } as unknown as React.ComponentProps<typeof TeamSettingsSection>)} />)
    expect(screen.getByText('团队成员配置')).toBeTruthy()
    expect(screen.getByText('未配置团队成员')).toBeTruthy()
    expect(screen.getByText('全局：$DSH_HOME/teammates/*.md')).toBeTruthy()
  })
})

describe('plugin lifecycle', () => {
  it('registers and removes the definition, keyed renderer, settings section, view tab, and dock with its fiber', async () => {
    const refreshed: string[] = []
    const opened: string[] = []
    const mirror = { getSnapshot: () => ({}), subscribe: () => () => {} }
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    const sessions = {
      teams: {
        mirror,
        refresh: (sessionId: string) => { refreshed.push(sessionId); return Promise.resolve() },
        pageMessagesBefore: (leaderSessionId: string) => Promise.resolve({
          ok: false,
          error: { code: 'internal', message: 'page not programmed', details: { leaderSessionId } },
        }),
      },
      open: (sessionId: string) => { opened.push(sessionId) },
    } as never
    ctx.provide('sessions', sessions)
    const events = new UiConversation(ctx, sessions).events
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
        'conversation.input.dock': { kind: 'list', scope: 'session' },
        'conversation.view': { kind: 'list', scope: 'session' },
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(events.entries().map(entry => entry.kind)).toEqual(['team-marker'])
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    expect(ctx.slots.entries('conversation.chat.node')[0]?.options.key).toBe('team-marker')
    expect(ctx.slots.entries('settings.section')).toHaveLength(1)
    expect(ctx.slots.entries('settings.section')[0]?.options.id).toBe('team')
    expect(resolveSlotLabel(ctx.slots.entries('settings.section')[0]?.options.label)).toBeTypeOf('string')
    const viewEntry = ctx.slots.entries('conversation.view')[0]
    expect(viewEntry?.options.id).toBe('team')
    expect(viewEntry?.options.order).toBe(20)
    // The tab label follows the active locale (default en; the zh flip is the
    // product-language contract).
    expect(resolveSlotLabel(viewEntry?.options.label)).toBe('Team')
    const locale = ctx.get('locale') as { setLocale(id: string): void }
    locale.setLocale('zh')
    expect(resolveSlotLabel(viewEntry?.options.label)).toBe('团队')
    // The inject face binds the service mirror, delegates the cold pull and
    // the wire page, and threads the existing session-open path for the D9
    // switch.
    const face = viewEntry?.inject?.('leader' as never) as undefined | {
      hooks: { teamMirror: typeof mirror }
      ensureTeam: (sessionId: string) => Promise<void>
      pageTeamMessages: (
        leaderSessionId: string,
        anchor: { at: number; sessionId: string; seq: number },
      ) => Promise<{ ok: boolean; error?: { code: string; message: string; details: unknown } }>
      openSession: (sessionId: string) => void
    }
    expect(face?.hooks.teamMirror).toBe(mirror)
    await face?.ensureTeam('child')
    expect(refreshed).toEqual(['child'])
    // The page callback delegates to the sessions team face and keeps the
    // result's error branch loud.
    await expect(face?.pageTeamMessages?.('leader', { at: 1, sessionId: 'child', seq: 0 }))
      .resolves.toEqual({ ok: false, error: { code: 'internal', message: 'page not programmed', details: { leaderSessionId: 'leader' } } })
    face?.openSession('member-s')
    expect(opened).toEqual(['member-s'])
    // The marker row's face binds the same mirror source and threads the
    // session-open path the D16 switch callback uses.
    const markerFace = ctx.slots.entries('conversation.chat.node')[0]?.inject?.('leader' as never) as {
      hooks: { teamMirror: typeof mirror }
      openSession: (sessionId: string) => void
    }
    expect(markerFace?.hooks.teamMirror).toBe(mirror)
    markerFace?.openSession('m1-s')
    expect(opened).toEqual(['member-s', 'm1-s'])
    // The dock entry lands in the declared input-dock list with its id and
    // order (15: between the goal bar's 10 and the queue strip's 20), and
    // its face binds the same mirror source and cold pull.
    const dockEntry = ctx.slots.entries('conversation.input.dock')[0]
    expect(dockEntry?.options.id).toBe('team')
    expect(dockEntry?.options.order).toBe(15)
    const dockFace = dockEntry?.inject?.('leader' as never) as {
      hooks: { teamMirror: typeof mirror }
      ensureTeam: (sessionId: string) => Promise<void>
      openTeamTab: () => void
    }
    expect(dockFace?.hooks.teamMirror).toBe(mirror)
    await dockFace?.ensureTeam('child')
    expect(refreshed).toEqual(['child', 'child'])
    // The D13 jump degrades to the tab ring's team button, selected by the
    // registration's own locale label (zh after the flip above).
    const tablist = document.createElement('div')
    tablist.setAttribute('role', 'tablist')
    // A non-matching tab first: the scan skips it before reaching the label.
    const other = document.createElement('button')
    other.setAttribute('role', 'tab')
    other.textContent = '对话'
    tablist.appendChild(other)
    const tab = document.createElement('button')
    tab.setAttribute('role', 'tab')
    tab.textContent = ' 团队 '
    tablist.appendChild(tab)
    document.body.appendChild(tablist)
    const clicked = vi.fn()
    tab.addEventListener('click', clicked)
    dockFace?.openTeamTab()
    expect(clicked).toHaveBeenCalledTimes(1)
    // No matching tab: the jump is a quiet no-op, never a throw.
    tablist.remove()
    dockFace?.openTeamTab()
    expect(clicked).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(events.entries()).toEqual([])
    expect(ctx.slots.entries('conversation.chat.node')).toEqual([])
    expect(ctx.slots.entries('settings.section')).toEqual([])
    expect(ctx.slots.entries('conversation.view')).toEqual([])
    expect(ctx.slots.entries('conversation.input.dock')).toEqual([])

    const replacement = ctx.plugin({ inject: [...inject], apply })
    await replacement.await()
    expect(events.entries().map(entry => entry.kind)).toEqual(['team-marker'])
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    expect(ctx.slots.entries('conversation.view')).toHaveLength(1)
    expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(1)
    await replacement.dispose()
  })

  it('keeps the view tab registered against a sessions face with no team wiring', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    // The capability member is absent: the tab still registers, the mirror
    // source is the static empty one, and the cold pull resolves as a no-op.
    const sessions = {} as never
    ctx.provide('sessions', sessions)
    new UiConversation(ctx, sessions)
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
        'conversation.input.dock': { kind: 'list', scope: 'session' },
        'conversation.view': { kind: 'list', scope: 'session' },
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = ctx.slots.entries('conversation.view')[0]
    expect(entry?.options.id).toBe('team')
    const face = entry?.inject?.('leader' as never) as {
      hooks: { teamMirror: { getSnapshot(): unknown; subscribe(fn: () => void): () => void } }
      ensureTeam: (sessionId: never) => Promise<void>
      pageTeamMessages: (
        leaderSessionId: string,
        anchor: { at: number; sessionId: string; seq: number },
      ) => Promise<{ ok: boolean; error?: { code: string; message: string; details: unknown } }>
      openSession: (sessionId: string) => void
    }
    expect(face.hooks.teamMirror.getSnapshot()).toEqual({})
    // The face stays complete: the switch callback is present even though
    // this fixture sessions face carries no open implementation.
    expect(typeof face.openSession).toBe('function')
    // ...and the page callback is the loud no-team-wiring error result.
    await expect(face.pageTeamMessages('leader', { at: 1, sessionId: 'child', seq: 0 }))
      .resolves.toEqual({ ok: false, error: { code: 'internal', message: 'the sessions face carries no team wiring', details: {} } })
    const heard = vi.fn()
    const off = face.hooks.teamMirror.subscribe(heard)
    off()
    await expect(face.ensureTeam('child' as never)).resolves.toBeUndefined()
    // The dock registers against the no-wiring face with the same static
    // mirror source and the complete jump callback.
    const dockEntry = ctx.slots.entries('conversation.input.dock')[0]
    expect(dockEntry?.options.id).toBe('team')
    const dockFace = dockEntry?.inject?.('leader' as never) as {
      hooks: { teamMirror: { getSnapshot(): unknown } }
      ensureTeam: (sessionId: never) => Promise<void>
      openTeamTab: () => void
    }
    expect(dockFace.hooks.teamMirror.getSnapshot()).toEqual({})
    expect(typeof dockFace.openTeamTab).toBe('function')
    await expect(dockFace.ensureTeam('child' as never)).resolves.toBeUndefined()
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.input.dock')).toEqual([])
  })

  it('keeps the node half inert and registers invariant ownership', async () => {
    applyNode()
    const registered: string[] = []
    const ctx = new Context()
    ctx.provide('invariants')
    ctx.set('invariants', {
      register: (pkg: string) => { registered.push(pkg); return () => {} },
    } as never)
    await applyInvariant(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-client-ui-team'])
  })
})
