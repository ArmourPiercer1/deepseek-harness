import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Keyless smoke for SOURCE `dsh teammate` execution: run `apps/cli/src/bin.ts`
 * with the exact production runtime vector (`node --import tsx/esm`, the
 * vector the root `dsh` script invokes) against a temporary `DSH_HOME`, and
 * assert the command family end to end — dispatch, frontmatter validation,
 * and the `team-enablement` settings face. The teammate subcommands boot no
 * profile and need no API key; the real user home is never touched.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dshSourceBin = 'apps/cli/src/bin.ts'

const cleanups: string[] = []

afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

/**
 * Create a temp root for one test's home or workspace.
 * @param prefix - mkdtemp prefix identifying the test.
 * @returns the new directory path.
 */
function tempRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(dir)
  return dir
}

/**
 * Run the source CLI as the production launcher does.
 * @param args - the dsh arguments after the bin.
 * @param env - the DSH_HOME and DSH_CWD the child sees.
 * @returns the child's output and exit code.
 */
async function runDsh(
  args: string[],
  env: { DSH_HOME: string; DSH_CWD: string },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const result = await execa(process.execPath, ['--import', 'tsx/esm', dshSourceBin, ...args], {
    cwd: repoRoot,
    input: '',
    timeout: 25_000,
    killSignal: 'SIGKILL',
    reject: false,
    env: { DSH_HOME: env.DSH_HOME, DSH_CWD: env.DSH_CWD },
  })
  if (result.timedOut) {
    throw new Error(`dsh source launch did not exit within 25s. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return { stdout: result.stdout, stderr: result.stderr, code: result.exitCode ?? -1 }
}

/**
 * Write a teammate definition file.
 * @param dir - the directory to create and write into.
 * @param file - the file name.
 * @param content - the Markdown definition content.
 * @returns the absolute file path.
 */
function writeFileIn(dir: string, file: string, content: string): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), content)
  return join(dir, file)
}

function memberMarkdown(id: string, role: 'leader' | 'teammate'): string {
  return `---
schemaVersion: 1
id: ${id}
role: ${role}
name: ${id}
description: Smoke member ${id}.
---

Prompt for ${id}.
`
}

describe('dsh SOURCE teammate commands (node --import tsx/esm)', () => {
  it('dispatches help and usage errors without booting a profile', async () => {
    const home = tempRoot('dsh-teammate-e2e-help-home-')
    const workspace = tempRoot('dsh-teammate-e2e-help-ws-')
    const env = { DSH_HOME: home, DSH_CWD: workspace }

    const help = await runDsh(['teammate', '--help'], env)
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('Usage: dsh teammate')
    for (const sub of ['list', 'add', 'enable', 'disable']) expect(help.stdout).toContain(sub)

    const addHelp = await runDsh(['teammate', 'add', '--help'], env)
    expect(addHelp.code).toBe(0)
    expect(addHelp.stdout).toContain('--workspace')

    const bare = await runDsh(['teammate'], env)
    expect(bare.code).toBe(1)
    expect(bare.stderr).toContain('Usage: dsh teammate')

    const missingArg = await runDsh(['teammate', 'disable'], env)
    expect(missingArg.code).toBe(1)
    expect(missingArg.stderr).toContain('missing required argument')

    const extraArg = await runDsh(['teammate', 'list', 'surplus'], env)
    expect(extraArg.code).toBe(1)
    expect(extraArg.stderr).toContain('too many arguments')
  }, 90_000)

  it('lists workspace definitions, falling back to the home definitions', async () => {
    const home = tempRoot('dsh-teammate-e2e-home-')
    const workspace = tempRoot('dsh-teammate-e2e-ws-')
    const env = { DSH_HOME: home, DSH_CWD: workspace }
    writeFileIn(join(home, 'teammates'), 'alpha.md', memberMarkdown('alpha-dev', 'teammate'))
    writeFileIn(join(workspace, '.dsh', 'teammates'), 'leader.md', memberMarkdown('team-leader', 'leader'))
    writeFileIn(join(workspace, '.dsh', 'teammates'), 'beta.md', memberMarkdown('beta-dev', 'teammate'))

    const withWorkspace = await runDsh(['teammate', 'list'], env)
    expect(withWorkspace.code).toBe(0)
    expect(withWorkspace.stdout).toContain('team-leader')
    expect(withWorkspace.stdout).toContain('beta-dev')
    expect(withWorkspace.stdout).toContain('workspace')
    // The workspace defines its own members, so the home definition is hidden.
    expect(withWorkspace.stdout).not.toContain('alpha-dev')

    const otherWorkspace = tempRoot('dsh-teammate-e2e-ws2-')
    const fallback = await runDsh(['teammate', 'list'], { ...env, DSH_CWD: otherWorkspace })
    expect(fallback.code).toBe(0)
    expect(fallback.stdout).toContain('alpha-dev')
    expect(fallback.stdout).toContain('home')
    expect(fallback.stdout).not.toContain('beta-dev')
  }, 60_000)

  it('add installs a valid definition and rejects duplicates, missing files, and bad frontmatter', async () => {
    const home = tempRoot('dsh-teammate-e2e-add-home-')
    const workspace = tempRoot('dsh-teammate-e2e-add-ws-')
    const env = { DSH_HOME: home, DSH_CWD: workspace }
    const scratch = tempRoot('dsh-teammate-e2e-add-src-')
    const good = writeFileIn(scratch, 'draft.md', memberMarkdown('delta-dev', 'teammate'))
    const bad = writeFileIn(scratch, 'bad.md', 'no frontmatter here')

    const added = await runDsh(['teammate', 'add', good], env)
    expect(added.code).toBe(0)
    expect(added.stdout).toContain('installed teammate "delta-dev"')
    const installed = join(home, 'teammates', 'draft.md')
    expect(readFileSync(installed, 'utf8')).toBe(memberMarkdown('delta-dev', 'teammate'))

    const duplicate = await runDsh(['teammate', 'add', good], env)
    expect(duplicate.code).toBe(1)
    expect(duplicate.stderr).toContain('already exists')
    // The original content survived the refused overwrite.
    expect(readFileSync(installed, 'utf8')).toBe(memberMarkdown('delta-dev', 'teammate'))

    const missing = await runDsh(['teammate', 'add', join(scratch, 'nope.md')], env)
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('file not found')

    const invalid = await runDsh(['teammate', 'add', bad], env)
    expect(invalid.code).toBe(1)
    expect(invalid.stderr).toContain('Missing YAML frontmatter delimiter (---)')
    expect(invalid.stderr).toContain('invalid definition frontmatter')
  }, 90_000)

  it('disable writes the team-enablement section, list reports it, enable clears it', async () => {
    const home = tempRoot('dsh-teammate-e2e-enable-home-')
    const workspace = tempRoot('dsh-teammate-e2e-enable-ws-')
    const env = { DSH_HOME: home, DSH_CWD: workspace }
    writeFileIn(join(workspace, '.dsh', 'teammates'), 'leader.md', memberMarkdown('team-leader', 'leader'))
    writeFileIn(join(workspace, '.dsh', 'teammates'), 'beta.md', memberMarkdown('beta-dev', 'teammate'))
    const settings = join(home, 'settings.yaml')

    const disabled = await runDsh(['teammate', 'disable', 'beta-dev'], env)
    expect(disabled.code).toBe(0)
    expect(disabled.stdout).toContain('disabled teammate "beta-dev"')
    const doc = load(readFileSync(settings, 'utf8')) as Record<string, unknown>
    expect((doc['team-enablement'] as Record<string, Record<string, boolean>>)[workspace]).toEqual({ 'beta-dev': false })

    const listed = await runDsh(['teammate', 'list'], env)
    expect(listed.code).toBe(0)
    const betaLine = listed.stdout.split('\n').find(line => line.startsWith('beta-dev'))
    expect(betaLine).toContain('disabled')

    const enabled = await runDsh(['teammate', 'enable', 'beta-dev'], env)
    expect(enabled.code).toBe(0)
    expect(enabled.stdout).toContain('enabled teammate "beta-dev"')
    // Nothing else in the document: the emptied settings file is removed.
    expect(() => readFileSync(settings, 'utf8')).toThrow()

    const unknown = await runDsh(['teammate', 'disable', 'ghost-dev'], env)
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toContain('no teammate "ghost-dev" visible from workspace')

    const leader = await runDsh(['teammate', 'disable', 'team-leader'], env)
    expect(leader.code).toBe(1)
    expect(leader.stderr).toContain('cannot be disabled')
  }, 90_000)
})
