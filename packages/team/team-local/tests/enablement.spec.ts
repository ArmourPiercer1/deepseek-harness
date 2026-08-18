import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import TeamRegistry, { TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as TeamLocal from '../src/index.ts'
import {
  TEAM_ENABLEMENT_SETTINGS_NAMESPACE,
  TeamEnablementSettingsSchema,
  filterDisabledTeammates,
  isTeammateEnabled,
  type TeamEnablementSettings,
} from '../src/enablement.ts'

/** The smallest real settings provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: Context, initialDoc: Record<string, unknown> = {}) {
    super(ctx)
    this.doc = structuredClone(initialDoc)
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
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
 * @param dir - subdirectory relative to root (e.g. '.dsh/teammates').
 * @param file - file name to write.
 * @param content - file content.
 */
async function writeDefinition(root: string, dir: string, file: string, content: string): Promise<void> {
  await mkdir(join(root, dir), { recursive: true })
  await writeFile(join(root, dir, file), content)
}

/**
 * Render a minimal valid team member definition Markdown file.
 *
 * @param id - member id frontmatter value.
 * @param prompt - Markdown body that becomes the member prompt.
 * @param role - member role frontmatter value.
 * @returns the full Markdown file content.
 */
function memberMarkdown(id: string, prompt: string, role: 'leader' | 'teammate' = 'teammate'): string {
  return `---
schemaVersion: 1
id: ${id}
role: ${role}
name: ${id}
description: Test member ${id}.
---

${prompt}
`
}

/**
 * Build a one-workspace team (leader + two teammates) under the workspace's
 * `.dsh/teammates/` directory.
 *
 * @param workspace - workspace temp root.
 */
async function writeTeam(workspace: string): Promise<void> {
  await writeDefinition(workspace, '.dsh/teammates', 'leader.md', memberMarkdown('team-leader', 'You are the leader.', 'leader'))
  await writeDefinition(workspace, '.dsh/teammates', 'alpha.md', memberMarkdown('alpha-dev', 'Alpha prompt.'))
  await writeDefinition(workspace, '.dsh/teammates', 'beta.md', memberMarkdown('beta-dev', 'Beta prompt.'))
}

/**
 * Mount a memory settings provider and team-local on a bare Context backed by
 * a real TeamRegistry.
 *
 * @param homePath - DSH home path for the plugin config.
 * @param workspacePath - workspace path for the plugin config.
 * @param doc - initial settings document (namespace to section).
 * @returns the contexts, fibers, the registry, and a call-through spy on register.
 */
async function boot(homePath: string, workspacePath: string, doc: Record<string, unknown> = {}) {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings, doc)
  await settingsFiber
  const team = new TeamRegistry(ctx)
  const register = vi.spyOn(team, 'register')
  const fiber = ctx.plugin(TeamLocal, { homePath, workspacePath })
  // Pop order disposes the consumer before the settings provider.
  cleanups.push(() => settingsFiber.dispose())
  cleanups.push(() => fiber.dispose())
  await fiber
  return { ctx, settingsFiber, team, register }
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

/**
 * A disable section for the workspace: alpha-dev off, everything else enabled.
 *
 * @param workspacePath - workspace key for the section.
 * @returns a settings document with one disabled teammate.
 */
function disableAlphaDoc(workspacePath: string): Record<string, unknown> {
  return {
    [TEAM_ENABLEMENT_SETTINGS_NAMESPACE]: { [workspacePath]: { 'alpha-dev': false } },
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  while (cleanups.length > 0) await cleanups.pop()!()
})

describe('team-local teammate enablement', () => {
  it('filters a teammate disabled for the workspace before registration', async () => {
    const home = await tempRoot('dsh-team-enablement-home-')
    const workspace = await tempRoot('dsh-team-enablement-ws-')
    await writeTeam(workspace)

    const { team, register } = await boot(home, workspace, disableAlphaDoc(workspace))

    await vi.waitFor(() => {
      expect(team.list().map(d => d.id)).toEqual(['beta-dev', 'team-leader'])
    }, { timeout: 5000 })
    expect(register.mock.calls.at(-1)![0].map(d => d.id)).toEqual(['beta-dev', 'team-leader'])
  })

  it('registers every teammate when the settings section is empty', async () => {
    const home = await tempRoot('dsh-team-enablement-home-')
    const workspace = await tempRoot('dsh-team-enablement-ws-')
    await writeTeam(workspace)

    const { team } = await boot(home, workspace)

    await vi.waitFor(() => {
      expect(team.list().map(d => d.id)).toEqual(['alpha-dev', 'beta-dev', 'team-leader'])
    }, { timeout: 5000 })
  })

  it('keeps a teammate explicitly enabled', async () => {
    const home = await tempRoot('dsh-team-enablement-home-')
    const workspace = await tempRoot('dsh-team-enablement-ws-')
    await writeTeam(workspace)
    const doc: Record<string, unknown> = {
      [TEAM_ENABLEMENT_SETTINGS_NAMESPACE]: { [workspace]: { 'alpha-dev': true } },
    }

    const { team } = await boot(home, workspace, doc)

    await vi.waitFor(() => {
      expect(team.list().map(d => d.id)).toEqual(['alpha-dev', 'beta-dev', 'team-leader'])
    }, { timeout: 5000 })
  })

  it('reloads when the enablement section updates, in both directions', async () => {
    const home = await tempRoot('dsh-team-enablement-home-')
    const workspace = await tempRoot('dsh-team-enablement-ws-')
    await writeTeam(workspace)

    const { ctx, team, register } = await boot(home, workspace)
    await vi.waitFor(() => {
      expect(team.list()).toHaveLength(3)
    }, { timeout: 5000 })
    // Let the settings-mount reload (debounced) settle before baselining.
    await sleep(700)

    const callsBefore = register.mock.calls.length
    await ctx.settings.update(TEAM_ENABLEMENT_SETTINGS_NAMESPACE, { [workspace]: { 'alpha-dev': false } })

    // The committed change triggers a reload beyond the initial one.
    await vi.waitFor(() => {
      expect(register.mock.calls.length).toBeGreaterThan(callsBefore)
    }, { timeout: 5000 })
    await vi.waitFor(() => {
      expect(team.list().map(d => d.id)).toEqual(['beta-dev', 'team-leader'])
    }, { timeout: 5000 })

    await ctx.settings.update(TEAM_ENABLEMENT_SETTINGS_NAMESPACE, { [workspace]: { 'alpha-dev': true } })
    await vi.waitFor(() => {
      expect(team.list()).toHaveLength(3)
    }, { timeout: 5000 })
  })

  it('does not reload when an unrelated namespace updates', async () => {
    const home = await tempRoot('dsh-team-enablement-home-')
    const workspace = await tempRoot('dsh-team-enablement-ws-')
    await writeTeam(workspace)

    const { ctx, team, register } = await boot(home, workspace)
    await vi.waitFor(() => {
      expect(team.list()).toHaveLength(3)
    }, { timeout: 5000 })
    // Let the settings-mount reload (debounced) settle before baselining.
    await sleep(700)

    const unrelated = settingsNamespace('unrelated')
    ctx.settings.register(unrelated, z.object({ value: z.string().default('x') }))
    const callsBefore = register.mock.calls.length
    await ctx.settings.update(unrelated, { value: 'y' })

    // Longer than the reload debounce: a spurious reload would have landed.
    await sleep(700)
    expect(register.mock.calls.length).toBe(callsBefore)
    expect(team.list()).toHaveLength(3)
  })

  it('re-enables disabled teammates when the settings provider detaches', async () => {
    const home = await tempRoot('dsh-team-enablement-home-')
    const workspace = await tempRoot('dsh-team-enablement-ws-')
    await writeTeam(workspace)

    const { settingsFiber, team } = await boot(home, workspace, disableAlphaDoc(workspace))
    await vi.waitFor(() => {
      expect(team.list().map(d => d.id)).toEqual(['beta-dev', 'team-leader'])
    }, { timeout: 5000 })

    await settingsFiber.dispose()
    await vi.waitFor(() => {
      expect(team.list()).toHaveLength(3)
    }, { timeout: 5000 })
  })

  it('registers nothing when no definitions exist', async () => {
    const home = await tempRoot('dsh-team-enablement-home-')
    const workspace = await tempRoot('dsh-team-enablement-ws-')

    const { register } = await boot(home, workspace)

    await sleep(700)
    expect(register).not.toHaveBeenCalled()
  })
})

describe('TeamEnablementSettingsSchema', () => {
  it('resolves an absent section to an empty record', () => {
    expect(TeamEnablementSettingsSchema(undefined)).toEqual({})
  })

  it('validates a nested workspace/teammate record', () => {
    const section: TeamEnablementSettings = { 'C:/demo': { 'alpha-dev': false, 'beta-dev': true } }
    expect(TeamEnablementSettingsSchema(section)).toEqual(section)
  })

  it('rejects a non-boolean flag', () => {
    expect(() => TeamEnablementSettingsSchema({ 'C:/demo': { 'alpha-dev': 'nope' } } as unknown as TeamEnablementSettings)).toThrow()
  })
})

describe('isTeammateEnabled', () => {
  it('enables every teammate for an empty workspace path', () => {
    const settings: TeamEnablementSettings = { 'C:/demo': { 'alpha-dev': false } }
    expect(isTeammateEnabled(settings, '', 'alpha-dev')).toBe(true)
  })

  it('enables teammates of an unlisted workspace', () => {
    const settings: TeamEnablementSettings = { 'C:/demo': { 'alpha-dev': false } }
    expect(isTeammateEnabled(settings, 'C:/other', 'alpha-dev')).toBe(true)
  })

  it('enables an unlisted teammate', () => {
    const settings: TeamEnablementSettings = { 'C:/demo': { 'alpha-dev': false } }
    expect(isTeammateEnabled(settings, 'C:/demo', 'beta-dev')).toBe(true)
  })

  it('keeps an explicitly enabled teammate', () => {
    const settings: TeamEnablementSettings = { 'C:/demo': { 'alpha-dev': true } }
    expect(isTeammateEnabled(settings, 'C:/demo', 'alpha-dev')).toBe(true)
  })

  it('honours an explicit disable', () => {
    const settings: TeamEnablementSettings = { 'C:/demo': { 'alpha-dev': false } }
    expect(isTeammateEnabled(settings, 'C:/demo', 'alpha-dev')).toBe(false)
  })
})

describe('filterDisabledTeammates', () => {
  function definition(id: string, role: 'leader' | 'teammate'): TeamMemberDefinition {
    return {
      id: TeamMemberId(id),
      role,
      name: id,
      description: `Test member ${id}.`,
      prompt: `${id} prompt.`,
    }
  }

  it('never filters a leader, even when its id is disabled', () => {
    const definitions = [
      definition('team-leader', 'leader'),
      definition('alpha-dev', 'teammate'),
    ]
    const settings: TeamEnablementSettings = { 'C:/demo': { 'team-leader': false, 'alpha-dev': false } }

    expect(filterDisabledTeammates(definitions, settings, 'C:/demo').map(d => d.id)).toEqual(['team-leader'])
  })

  it('drops only the disabled teammates, keeping input order', () => {
    const definitions = [
      definition('team-leader', 'leader'),
      definition('alpha-dev', 'teammate'),
      definition('beta-dev', 'teammate'),
    ]
    const settings: TeamEnablementSettings = { 'C:/demo': { 'alpha-dev': false } }

    expect(filterDisabledTeammates(definitions, settings, 'C:/demo').map(d => d.id)).toEqual(['team-leader', 'beta-dev'])
  })

  it('filters nothing for an empty workspace path', () => {
    const definitions = [
      definition('team-leader', 'leader'),
      definition('alpha-dev', 'teammate'),
    ]
    const settings: TeamEnablementSettings = { 'C:/demo': { 'alpha-dev': false } }

    expect(filterDisabledTeammates(definitions, settings, '')).toHaveLength(2)
  })
})
