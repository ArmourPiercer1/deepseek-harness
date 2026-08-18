import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import TeamRegistry from '@deepseek-ai/dsh-team'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as TeamLocal from '../src/index.ts'

// node:fs watch is the nondeterministic OS boundary: faking it lets these
// tests drive change events deterministically, while discovery still reads
// real temp directories through node:fs/promises.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const { EventEmitter } = await import('node:events')

  class FakeFSWatcher extends EventEmitter {
    close = vi.fn()
  }

  const instances: WatchRecord[] = []

  const watch = vi.fn((path: string, options: unknown, listener?: (eventType: string, filename: string | null) => void) => {
    const watcher = new FakeFSWatcher()
    if (listener !== undefined) watcher.on('change', listener)
    instances.push({ dir: path, options, watcher })
    return watcher
  })

  return { ...actual, watch, __watchInstances: instances }
})

/** Debounce window for file-change reloads, mirroring RELOAD_DEBOUNCE_MS in src/index.ts (ms). */
const RELOAD_DEBOUNCE_MS = 500

/** One fake watch() call recorded by the mocked node:fs module. */
interface WatchRecord {
  /** Directory passed to watch(). */
  readonly dir: string
  /** Options passed to watch(). */
  readonly options: unknown
  /** The fake watcher instance returned by watch(). */
  readonly watcher: EventEmitter & { close: ReturnType<typeof vi.fn> }
}

/**
 * Read the fake watch() call log from the mocked node:fs module.
 *
 * @returns the recorded watch instances, in call order.
 */
async function watchRecords(): Promise<WatchRecord[]> {
  const fs = await import('node:fs') as unknown as { __watchInstances: WatchRecord[] }
  return fs.__watchInstances
}

/**
 * Render a valid team member definition Markdown file.
 *
 * @param id - member id.
 * @param role - `leader` or `teammate`.
 * @param name - display name.
 * @returns the full Markdown file content.
 */
function memberMarkdown(id: string, role: 'leader' | 'teammate', name: string): string {
  return `---
schemaVersion: 1
id: ${id}
role: ${role}
name: ${name}
description: Test member ${id}.
---

Prompt for ${id}.
`
}

/**
 * Sleep for a real wall-clock interval.
 *
 * @param ms - delay in milliseconds.
 * @returns a promise settling after the delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const cleanups: Array<() => Promise<void>> = []

/**
 * Create a temp root directory for a team-local layout.
 *
 * @param prefix - mkdtemp prefix identifying the test.
 * @returns the new directory path.
 */
async function tempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/**
 * Write one definition file under a subdirectory of the root.
 *
 * @param root - temp root directory.
 * @param dir - subdirectory relative to root (e.g. 'teammates').
 * @param file - file name to write.
 * @param content - file content.
 */
async function writeDefinition(root: string, dir: string, file: string, content: string): Promise<void> {
  await mkdir(join(root, dir), { recursive: true })
  await writeFile(join(root, dir, file), content)
}

/**
 * Mount team-local on a bare Context backed by a real TeamRegistry.
 *
 * @param homePath - DSH home path for the plugin config.
 * @param workspacePath - initial workspace path for the plugin config.
 * @returns the plugin fiber, the registry, and a call-through spy on register.
 */
async function boot(homePath: string, workspacePath: string) {
  const ctx = new Context()
  const team = new TeamRegistry(ctx)
  const register = vi.spyOn(team, 'register')
  const fiber = ctx.plugin(TeamLocal, { homePath, workspacePath })
  cleanups.push(() => fiber.dispose())
  await fiber
  return { ctx, fiber, team, register }
}

/**
 * Emit `agent/created` carrying a stub agent whose session header cwd is given.
 *
 * @param ctx - context the plugin listens on.
 * @param cwd - session workspace cwd for the stub agent, or undefined for none.
 */
function emitAgentCreated(ctx: Context, cwd: string | undefined): void {
  const agent = { session: { header: { ...(cwd === undefined ? {} : { cwd }) } } }
  ctx.emit('agent/created', { agent } as never)
}

beforeEach(async () => {
  (await watchRecords()).length = 0
})

afterEach(async () => {
  vi.restoreAllMocks()
  while (cleanups.length > 0) await cleanups.pop()!()
})

describe('team-local session workspace tracking', () => {
  it('reloads with the new session workspace when an agent is created under a different cwd', async () => {
    const home = await tempRoot('dsh-team-local-sws-home-')
    const first = await tempRoot('dsh-team-local-sws-first-')
    const second = await tempRoot('dsh-team-local-sws-second-')
    await writeDefinition(home, 'teammates', 'home-leader.md', memberMarkdown('home-leader', 'leader', 'Home Leader'))
    await writeDefinition(home, 'teammates', 'home-mate.md', memberMarkdown('home-mate', 'teammate', 'Home Mate'))
    await writeDefinition(first, join('.dsh', 'teammates'), 'leader.md', memberMarkdown('first-leader', 'leader', 'First Leader'))
    await writeDefinition(first, join('.dsh', 'teammates'), 'alpha.md', memberMarkdown('alpha', 'teammate', 'Alpha'))
    await writeDefinition(second, join('.dsh', 'teammates'), 'leader.md', memberMarkdown('second-leader', 'leader', 'Second Leader'))
    await writeDefinition(second, join('.dsh', 'teammates'), 'beta.md', memberMarkdown('beta', 'teammate', 'Beta'))

    const { ctx, team, register } = await boot(home, first)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(1) }, { timeout: 5000 })
    // The workspace team is self-contained: home definitions stay out.
    expect(team.list().map(d => d.id).sort()).toEqual(['alpha', 'first-leader'])

    emitAgentCreated(ctx, second)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(2) }, { timeout: 5000 })

    // The registered set is exactly the new workspace's team.
    expect(team.list().map(d => d.id).sort()).toEqual(['beta', 'second-leader'])
  })

  it('keeps the current workspace for agents without a cwd or under the same cwd', async () => {
    const home = await tempRoot('dsh-team-local-sws-home-')
    const workspace = await tempRoot('dsh-team-local-sws-workspace-')
    await writeDefinition(workspace, join('.dsh', 'teammates'), 'leader.md', memberMarkdown('ws-leader', 'leader', 'Workspace Leader'))
    await writeDefinition(workspace, join('.dsh', 'teammates'), 'alpha.md', memberMarkdown('alpha', 'teammate', 'Alpha'))

    const { ctx, team, register } = await boot(home, workspace)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(1) }, { timeout: 5000 })

    emitAgentCreated(ctx, undefined)
    emitAgentCreated(ctx, workspace)
    await sleep(RELOAD_DEBOUNCE_MS + 200)

    expect(register).toHaveBeenCalledTimes(1)
    expect(team.list().map(d => d.id).sort()).toEqual(['alpha', 'ws-leader'])
  })

  it('watches the new session workspace directory and reloads on its .md changes', async () => {
    const home = await tempRoot('dsh-team-local-sws-home-')
    const first = await tempRoot('dsh-team-local-sws-first-')
    const second = await tempRoot('dsh-team-local-sws-second-')
    await writeDefinition(first, join('.dsh', 'teammates'), 'leader.md', memberMarkdown('first-leader', 'leader', 'First Leader'))
    await writeDefinition(first, join('.dsh', 'teammates'), 'alpha.md', memberMarkdown('alpha', 'teammate', 'Alpha'))
    await writeDefinition(second, join('.dsh', 'teammates'), 'leader.md', memberMarkdown('second-leader', 'leader', 'Second Leader'))
    await writeDefinition(second, join('.dsh', 'teammates'), 'beta.md', memberMarkdown('beta', 'teammate', 'Beta'))

    const { ctx, team, register } = await boot(home, first)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(1) }, { timeout: 5000 })

    emitAgentCreated(ctx, second)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(2) }, { timeout: 5000 })

    const records = await watchRecords()
    const secondRecord = records.find(r => r.dir === join(second, '.dsh', 'teammates'))
    expect(secondRecord).toBeDefined()

    // A change in the new workspace directory debounces into one reload.
    await writeDefinition(second, join('.dsh', 'teammates'), 'gamma.md', memberMarkdown('gamma', 'teammate', 'Gamma'))
    secondRecord!.watcher.emit('change', 'change', 'gamma.md')
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(3) }, { timeout: 5000 })
    expect(team.list().map(d => d.id).sort()).toEqual(['beta', 'gamma', 'second-leader'])
  })

  it('falls back to home definitions when the session workspace defines none', async () => {
    const home = await tempRoot('dsh-team-local-sws-home-')
    const first = await tempRoot('dsh-team-local-sws-first-')
    const second = await tempRoot('dsh-team-local-sws-second-')
    await writeDefinition(home, 'teammates', 'home-leader.md', memberMarkdown('home-leader', 'leader', 'Home Leader'))
    await writeDefinition(home, 'teammates', 'home-mate.md', memberMarkdown('home-mate', 'teammate', 'Home Mate'))
    await writeDefinition(second, join('.dsh', 'teammates'), 'leader.md', memberMarkdown('second-leader', 'leader', 'Second Leader'))

    // first has no .dsh/teammates definitions at all.
    const { ctx, team, register } = await boot(home, first)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(1) }, { timeout: 5000 })
    expect(team.list().map(d => d.id).sort()).toEqual(['home-leader', 'home-mate'])

    // A session workspace with definitions replaces the home fallback…
    emitAgentCreated(ctx, second)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(2) }, { timeout: 5000 })
    expect(team.list().map(d => d.id)).toEqual(['second-leader'])

    // …and switching back to an empty workspace restores it.
    emitAgentCreated(ctx, first)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(3) }, { timeout: 5000 })
    expect(team.list().map(d => d.id).sort()).toEqual(['home-leader', 'home-mate'])
  })

  it('closes watchers added by workspace switches on dispose', async () => {
    const home = await tempRoot('dsh-team-local-sws-home-')
    const first = await tempRoot('dsh-team-local-sws-first-')
    const second = await tempRoot('dsh-team-local-sws-second-')
    await writeDefinition(first, join('.dsh', 'teammates'), 'leader.md', memberMarkdown('first-leader', 'leader', 'First Leader'))
    await writeDefinition(first, join('.dsh', 'teammates'), 'alpha.md', memberMarkdown('alpha', 'teammate', 'Alpha'))
    await writeDefinition(second, join('.dsh', 'teammates'), 'leader.md', memberMarkdown('second-leader', 'leader', 'Second Leader'))
    await writeDefinition(second, join('.dsh', 'teammates'), 'beta.md', memberMarkdown('beta', 'teammate', 'Beta'))

    const { ctx, fiber, register } = await boot(home, first)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(1) }, { timeout: 5000 })

    emitAgentCreated(ctx, second)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(2) }, { timeout: 5000 })

    await fiber.dispose()
    const records = await watchRecords()
    for (const record of records) {
      expect(record.watcher.close).toHaveBeenCalledTimes(1)
    }
  })
})
