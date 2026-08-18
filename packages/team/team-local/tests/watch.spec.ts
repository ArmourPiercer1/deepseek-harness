import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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
 * Count reload-debounce timers among spied setTimeout calls.
 *
 * @param calls - setTimeout spy call log.
 * @returns the number of calls scheduled with the reload debounce delay.
 */
function debounceTimers(calls: ReadonlyArray<readonly unknown[]>): number {
  return calls.filter(call => call[1] === RELOAD_DEBOUNCE_MS).length
}

/**
 * Render a valid leader definition Markdown file.
 *
 * @param prompt - Markdown body that becomes the leader prompt.
 * @returns the full Markdown file content.
 */
function memberMarkdown(prompt: string): string {
  return `---
schemaVersion: 1
id: team-leader
role: leader
name: Team Leader
description: Coordinates all teammates.
---

${prompt}
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
 * @param workspacePath - workspace path for the plugin config.
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

beforeEach(async () => {
  (await watchRecords()).length = 0
})

afterEach(async () => {
  vi.restoreAllMocks()
  while (cleanups.length > 0) await cleanups.pop()!()
})

describe('team-local definition watch', () => {
  it('watches both configured teammate directories', async () => {
    const home = await tempRoot('dsh-team-local-watch-home-')
    const workspace = await tempRoot('dsh-team-local-watch-workspace-')
    await writeDefinition(home, 'teammates', 'leader.md', memberMarkdown('Initial prompt.'))
    await mkdir(join(workspace, '.dsh', 'teammates'), { recursive: true })

    await boot(home, workspace)
    const records = await watchRecords()

    expect(records.map(r => r.dir)).toEqual([
      join(home, 'teammates'),
      join(workspace, '.dsh', 'teammates'),
    ])
    expect(records[0]!.options).toEqual({ persistent: false })
  })

  it('reloads definitions once after RELOAD_DEBOUNCE_MS following a .md change', async () => {
    const home = await tempRoot('dsh-team-local-watch-home-')
    const workspace = await tempRoot('dsh-team-local-watch-workspace-')
    await writeDefinition(home, 'teammates', 'leader.md', memberMarkdown('Initial prompt.'))
    await mkdir(join(workspace, '.dsh', 'teammates'), { recursive: true })

    const { team, register } = await boot(home, workspace)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(1) }, { timeout: 5000 })

    // Update the on-disk definition, then report the change as a watcher would.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const scheduledBefore = debounceTimers(setTimeoutSpy.mock.calls)
    await writeFile(join(home, 'teammates', 'leader.md'), memberMarkdown('Updated prompt.'))
    const records = await watchRecords()
    records[0]!.watcher.emit('change', 'change', 'leader.md')

    // The change is debounced, not applied immediately.
    expect(debounceTimers(setTimeoutSpy.mock.calls) - scheduledBefore).toBe(1)
    await sleep(150)
    expect(register).toHaveBeenCalledTimes(1)

    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(2) }, { timeout: 5000 })
    expect(team.list().at(-1)?.prompt).toBe('Updated prompt.')
  })

  it('collapses changes inside the debounce window into one reload', async () => {
    const home = await tempRoot('dsh-team-local-watch-home-')
    const workspace = await tempRoot('dsh-team-local-watch-workspace-')
    await writeDefinition(home, 'teammates', 'leader.md', memberMarkdown('Initial prompt.'))
    await mkdir(join(workspace, '.dsh', 'teammates'), { recursive: true })

    const { register } = await boot(home, workspace)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(1) }, { timeout: 5000 })

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const records = await watchRecords()
    records[0]!.watcher.emit('change', 'change', 'leader.md')
    await sleep(100)
    const clearsBeforeSecond = clearTimeoutSpy.mock.calls.length
    records[0]!.watcher.emit('change', 'change', 'leader.md')

    // Each change reschedules the debounce timer; the pending one is cancelled.
    expect(debounceTimers(setTimeoutSpy.mock.calls)).toBe(2)
    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(clearsBeforeSecond)

    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(2) }, { timeout: 5000 })
    // No second reload: the window collapsed both changes into one.
    await sleep(700)
    expect(register).toHaveBeenCalledTimes(2)
  })

  it('ignores changes to non-.md files', async () => {
    const home = await tempRoot('dsh-team-local-watch-home-')
    const workspace = await tempRoot('dsh-team-local-watch-workspace-')
    await writeDefinition(home, 'teammates', 'leader.md', memberMarkdown('Initial prompt.'))
    await mkdir(join(workspace, '.dsh', 'teammates'), { recursive: true })

    const { register } = await boot(home, workspace)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(1) }, { timeout: 5000 })

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const scheduledBefore = debounceTimers(setTimeoutSpy.mock.calls)
    const records = await watchRecords()
    records[0]!.watcher.emit('change', 'change', 'notes.txt')

    expect(debounceTimers(setTimeoutSpy.mock.calls) - scheduledBefore).toBe(0)
    await sleep(700)
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('closes watchers and clears the pending debounce timer on dispose', async () => {
    const home = await tempRoot('dsh-team-local-watch-home-')
    const workspace = await tempRoot('dsh-team-local-watch-workspace-')
    await writeDefinition(home, 'teammates', 'leader.md', memberMarkdown('Initial prompt.'))
    await mkdir(join(workspace, '.dsh', 'teammates'), { recursive: true })

    const { fiber, register } = await boot(home, workspace)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(1) }, { timeout: 5000 })

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const records = await watchRecords()
    records[0]!.watcher.emit('change', 'change', 'leader.md')
    await sleep(150)
    expect(register).toHaveBeenCalledTimes(1) // the debounce timer is still pending

    await fiber.dispose()

    for (const record of records) {
      expect(record.watcher.close).toHaveBeenCalledTimes(1)
    }
    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(0)

    // No reload lands after dispose, and later changes are inert.
    await sleep(800)
    expect(register).toHaveBeenCalledTimes(1)
    records[0]!.watcher.emit('change', 'change', 'leader.md')
    await sleep(700)
    expect(register).toHaveBeenCalledTimes(1)
  })
})
