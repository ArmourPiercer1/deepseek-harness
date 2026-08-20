import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
// The parity battery checks the CLI's frontmatter mirror against the loader's
// real parser. The subpath import goes by relative path (not by package name)
// because the published CLI intentionally does not depend on dsh-team-local;
// the tests resolve it from the workspace source tree.
import { parseTeamMemberMarkdown } from '../../../packages/team/team-local/src/parser.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TEAM_ENABLEMENT_SECTION,
  deduplicateTeammates,
  discoverVisibleTeammates,
  parseTeammateMarkdown,
  readEnablementSection,
  runTeammate,
  settingsDocumentPath,
} from '../src/teammate.ts'

/**
 * Command-level tests for the `dsh teammate` subcommands against a real
 * temporary harness home and workspace: no mocks for the storage surfaces,
 * which is the point of exercising the file layout, the settings document,
 * and the loader-mirrored parsing rules end to end.
 */

const cleanups: Array<() => Promise<void>> = []

/**
 * Create a temp root for one test's home or workspace.
 * @param prefix - mkdtemp prefix identifying the test.
 * @returns the new directory path.
 */
async function tempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  while (cleanups.length > 0) await cleanups.pop()!()
})

/**
 * Capture the CLI's stdout/stderr writes as string lists.
 * @returns the captured buffers, one entry per write.
 */
function captureOutput(): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = []
  const stderr: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  return { stdout, stderr }
}

/**
 * Render a minimal valid teammate definition Markdown file.
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
 * Write one definition file under a subdirectory of a root.
 * @param root - temp root directory.
 * @param dir - subdirectory relative to root (e.g. 'teammates').
 * @param file - file name to write.
 * @param content - file content.
 * @returns the absolute file path.
 */
async function writeDefinition(root: string, dir: string, file: string, content: string): Promise<string> {
  const dirPath = join(root, dir)
  const path = join(dirPath, file)
  if (dir !== '') await mkdir(dirPath, { recursive: true })
  await writeFile(path, content)
  return path
}

describe('dsh teammate list', () => {
  it('lists nothing from a fresh home with an explanatory message', async () => {
    const home = await tempRoot('dsh-teammate-list-fresh-home-')
    const workspace = await tempRoot('dsh-teammate-list-fresh-ws-')
    const { stdout } = captureOutput()

    const code = await runTeammate('list', [], { home, workspace })

    expect(code).toBe(0)
    expect(stdout.join('')).toContain('no teammate definitions found')
    expect(stdout.join('')).toContain(join(home, 'teammates'))
  })

  it('shows home definitions with roles, capabilities, and status when the workspace defines none', async () => {
    const home = await tempRoot('dsh-teammate-list-home-')
    const workspace = await tempRoot('dsh-teammate-list-ws-')
    await writeDefinition(home, 'teammates', 'leader.md', memberMarkdown('team-leader', 'Lead prompt.', 'leader'))
    await writeDefinition(home, 'teammates', 'alpha.md', [
      '---',
      'schemaVersion: 1',
      'id: alpha-dev',
      'role: teammate',
      'name: Alpha',
      'description: Frontend work.',
      'model: deepseek-v4-flash-0731',
      'tools:',
      '  allow: [read, edit]',
      '---',
      '',
      'Alpha prompt.',
      '',
    ].join('\n'))
    const { stdout } = captureOutput()

    const code = await runTeammate('list', [], { home, workspace })

    expect(code).toBe(0)
    const text = stdout.join('')
    for (const column of ['ID', 'ROLE', 'STATUS', 'CAPABILITIES', 'SOURCE']) expect(text).toContain(column)
    expect(text).toContain('team-leader')
    expect(text).toContain('leader')
    expect(text).toContain('alpha-dev')
    expect(text).toContain('teammate')
    expect(text).toContain('enabled')
    expect(text).toContain('model=deepseek-v4-flash-0731')
    expect(text).toContain('tools.allow=[read, edit]')
    expect(text).toContain('home')
  })

  it('a workspace with its own definitions is self-contained: home definitions are hidden', async () => {
    const home = await tempRoot('dsh-teammate-list-selfcont-home-')
    const workspace = await tempRoot('dsh-teammate-list-selfcont-ws-')
    await writeDefinition(home, 'teammates', 'alpha.md', memberMarkdown('alpha-dev', 'Home alpha.'))
    await writeDefinition(workspace, '.dsh/teammates', 'beta.md', memberMarkdown('beta-dev', 'Workspace beta.'))
    const { stdout } = captureOutput()

    const code = await runTeammate('list', [], { home, workspace })

    expect(code).toBe(0)
    const text = stdout.join('')
    expect(text).toContain('beta-dev')
    expect(text).toContain('workspace')
    expect(text).not.toContain('alpha-dev')
  })

  it('an unparsable workspace file keeps the workspace self-contained and warns on stderr', async () => {
    const home = await tempRoot('dsh-teammate-list-badfile-home-')
    const workspace = await tempRoot('dsh-teammate-list-badfile-ws-')
    await writeDefinition(home, 'teammates', 'alpha.md', memberMarkdown('alpha-dev', 'Home alpha.'))
    await writeDefinition(workspace, '.dsh/teammates', 'bad.md', 'no frontmatter at all')
    await writeDefinition(workspace, '.dsh/teammates', 'good.md', memberMarkdown('good-dev', 'Workspace good.'))
    const { stdout, stderr } = captureOutput()

    const code = await runTeammate('list', [], { home, workspace })

    expect(code).toBe(0)
    const text = stdout.join('')
    expect(text).toContain('good-dev')
    expect(text).not.toContain('alpha-dev')
    const warnings = stderr.join('')
    expect(warnings).toContain('bad.md')
    expect(warnings).toContain('Missing YAML frontmatter delimiter (---)')
  })

  it('shows disabled teammates from the team-enablement section for the current workspace', async () => {
    const home = await tempRoot('dsh-teammate-list-disabled-home-')
    const workspace = await tempRoot('dsh-teammate-list-disabled-ws-')
    await writeDefinition(workspace, '.dsh/teammates', 'leader.md', memberMarkdown('team-leader', 'Lead.', 'leader'))
    await writeDefinition(workspace, '.dsh/teammates', 'beta.md', memberMarkdown('beta-dev', 'Beta.'))
    await writeDefinition(workspace, '.dsh/teammates', 'gamma.md', memberMarkdown('gamma-dev', 'Gamma.'))
    // Hand-written in the settings-file provider's block form (the team-local
    // README's own example shape), not this CLI's writer output: the reader
    // must accept what the provider writes, not only what the CLI writes.
    await writeFile(settingsDocumentPath(home), `team-enablement:\n  ${JSON.stringify(workspace)}:\n    beta-dev: false\n`, 'utf8')
    const { stdout } = captureOutput()

    const code = await runTeammate('list', [], { home, workspace })

    expect(code).toBe(0)
    const lines = stdout.join('').trim().split('\n').map(line => line.trimEnd())
    const betaLine = lines.find(line => line.startsWith('beta-dev'))
    const gammaLine = lines.find(line => line.startsWith('gamma-dev'))
    const leaderLine = lines.find(line => line.startsWith('team-leader'))
    expect(betaLine).toBeDefined()
    expect(gammaLine).toBeDefined()
    expect(leaderLine).toBeDefined()
    expect(betaLine).toContain('disabled')
    expect(gammaLine).toContain('enabled')
    // The leader is never subject to enablement.
    expect(leaderLine).toContain('enabled')
  })

  it('fails loud on an invalid team-enablement section', async () => {
    const home = await tempRoot('dsh-teammate-list-badsection-home-')
    const workspace = await tempRoot('dsh-teammate-list-badsection-ws-')
    await writeDefinition(workspace, '.dsh/teammates', 'beta.md', memberMarkdown('beta-dev', 'Beta.'))
    await writeFile(settingsDocumentPath(home), 'team-enablement:\n  "C:/demo":\n    beta-dev: not-a-boolean\n', 'utf8')
    const { stderr } = captureOutput()

    const code = await runTeammate('list', [], { home, workspace })

    expect(code).toBe(1)
    expect(stderr.join('')).toContain(`invalid ${TEAM_ENABLEMENT_SECTION} section`)
  })

  it('fails loud on an unparseable settings document', async () => {
    const home = await tempRoot('dsh-teammate-list-baddoc-home-')
    const workspace = await tempRoot('dsh-teammate-list-baddoc-ws-')
    await writeFile(settingsDocumentPath(home), 'team-enablement: [broken', 'utf8')
    const { stderr } = captureOutput()

    const code = await runTeammate('list', [], { home, workspace })

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('invalid settings document')
  })
})

describe('dsh teammate add', () => {
  it('installs a valid definition under the harness home', async () => {
    const home = await tempRoot('dsh-teammate-add-home-')
    const workspace = await tempRoot('dsh-teammate-add-ws-')
    const source = await writeDefinition(await tempRoot('dsh-teammate-add-src-'), '', 'draft.md', memberMarkdown('delta-dev', 'Delta.'))
    const { stdout } = captureOutput()

    const code = await runTeammate('add', [source], { home, workspace })

    expect(code).toBe(0)
    const target = join(home, 'teammates', 'draft.md')
    expect(await readFile(target, 'utf8')).toBe(memberMarkdown('delta-dev', 'Delta.'))
    expect(stdout.join('')).toContain('installed teammate "delta-dev" (teammate)')
    expect(stdout.join('')).toContain(target)
  })

  it('installs into the workspace .dsh/teammates with the workspace option', async () => {
    const home = await tempRoot('dsh-teammate-add-wsinstall-home-')
    const workspace = await tempRoot('dsh-teammate-add-wsinstall-ws-')
    const source = await writeDefinition(await tempRoot('dsh-teammate-add-wsinstall-src-'), '', 'draft.md', memberMarkdown('delta-dev', 'Delta.'))
    const { stdout } = captureOutput()

    const code = await runTeammate('add', [source], { home, workspace, workspaceInstall: true })

    expect(code).toBe(0)
    const target = join(workspace, '.dsh', 'teammates', 'draft.md')
    expect(await readFile(target, 'utf8')).toBe(memberMarkdown('delta-dev', 'Delta.'))
    expect(stdout.join('')).toContain(target)
  })

  it('rejects a missing file and installs nothing', async () => {
    const home = await tempRoot('dsh-teammate-add-missing-home-')
    const workspace = await tempRoot('dsh-teammate-add-missing-ws-')
    const missing = join(home, 'does-not-exist.md')
    const { stderr } = captureOutput()

    const code = await runTeammate('add', [missing], { home, workspace })

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('file not found')
    await expect(stat(join(home, 'teammates', 'does-not-exist.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['unsupported schema version', [
      '---',
      'schemaVersion: 2',
      'id: x',
      'role: teammate',
      'name: X',
      'description: Y.',
      '---',
      '',
      'Body.',
      '',
    ]],
    ['missing schema version', [
      '---',
      'id: x',
      'role: teammate',
      'name: X',
      'description: Y.',
      '---',
      '',
      'Body.',
      '',
    ]],
    ['invalid role', [
      '---',
      'schemaVersion: 1',
      'id: x',
      'role: sidekick',
      'name: X',
      'description: Y.',
      '---',
      '',
      'Body.',
      '',
    ]],
    ['missing id', [
      '---',
      'schemaVersion: 1',
      'role: teammate',
      'name: X',
      'description: Y.',
      '---',
      '',
      'Body.',
      '',
    ]],
    ['missing name', [
      '---',
      'schemaVersion: 1',
      'id: x',
      'role: teammate',
      'description: Y.',
      '---',
      '',
      'Body.',
      '',
    ]],
    ['missing description', [
      '---',
      'schemaVersion: 1',
      'id: x',
      'role: teammate',
      'name: X',
      '---',
      '',
      'Body.',
      '',
    ]],
    ['skills that is not an array', [
      '---',
      'schemaVersion: 1',
      'id: x',
      'role: teammate',
      'name: X',
      'description: Y.',
      'skills: tdd',
      '---',
      '',
      'Body.',
      '',
    ]],
  ])('rejects invalid frontmatter (%s) without installing', async (_name, lines) => {
    const home = await tempRoot('dsh-teammate-add-bad-home-')
    const workspace = await tempRoot('dsh-teammate-add-bad-ws-')
    const source = await writeDefinition(await tempRoot('dsh-teammate-add-bad-src-'), '', 'bad.md', lines.join('\n'))
    const { stderr } = captureOutput()

    const code = await runTeammate('add', [source], { home, workspace })

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('invalid definition frontmatter')
    await expect(stat(join(home, 'teammates', 'bad.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a non-.md file', async () => {
    const home = await tempRoot('dsh-teammate-add-ext-home-')
    const workspace = await tempRoot('dsh-teammate-add-ext-ws-')
    const source = await writeDefinition(await tempRoot('dsh-teammate-add-ext-src-'), '', 'draft.txt', memberMarkdown('delta-dev', 'Delta.'))
    const { stderr } = captureOutput()

    const code = await runTeammate('add', [source], { home, workspace })

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('not a .md definition file')
  })

  it('refuses to overwrite an existing target (duplicate add)', async () => {
    const home = await tempRoot('dsh-teammate-add-dup-home-')
    const workspace = await tempRoot('dsh-teammate-add-dup-ws-')
    const original = memberMarkdown('delta-dev', 'Original.')
    const source = await writeDefinition(await tempRoot('dsh-teammate-add-dup-src-'), '', 'draft.md', original)
    captureOutput()
    expect(await runTeammate('add', [source], { home, workspace })).toBe(0)
    await writeFile(source, memberMarkdown('delta-dev', 'Replacement.'))
    const { stderr } = captureOutput()

    const code = await runTeammate('add', [source], { home, workspace })

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('already exists')
    expect(await readFile(join(home, 'teammates', 'draft.md'), 'utf8')).toBe(original)
  })

  it('installs under the file name, not the definition id', async () => {
    const home = await tempRoot('dsh-teammate-add-filename-home-')
    const workspace = await tempRoot('dsh-teammate-add-filename-ws-')
    const source = await writeDefinition(await tempRoot('dsh-teammate-add-filename-src-'), '', 'other-name.md', memberMarkdown('id-in-frontmatter', 'Delta.'))
    captureOutput()

    const code = await runTeammate('add', [source], { home, workspace })

    expect(code).toBe(0)
    await expect(stat(join(home, 'teammates', 'other-name.md'))).resolves.toBeDefined()
    await expect(stat(join(home, 'teammates', 'id-in-frontmatter.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('dsh teammate enable / disable', () => {
  async function teamFixture(prefix: string): Promise<{ home: string; workspace: string }> {
    const home = await tempRoot(`dsh-teammate-${prefix}-home-`)
    const workspace = await tempRoot(`dsh-teammate-${prefix}-ws-`)
    await writeDefinition(workspace, '.dsh/teammates', 'leader.md', memberMarkdown('team-leader', 'Lead.', 'leader'))
    await writeDefinition(workspace, '.dsh/teammates', 'beta.md', memberMarkdown('beta-dev', 'Beta.'))
    return { home, workspace }
  }

  it('disable stores an explicit false in the team-enablement section', async () => {
    const { home, workspace } = await teamFixture('disable-write')
    const { stdout } = captureOutput()

    const code = await runTeammate('disable', ['beta-dev'], { home, workspace })

    expect(code).toBe(0)
    expect(stdout.join('')).toContain('disabled teammate "beta-dev"')
    const section = await readEnablementSection(home)
    expect(section[workspace]).toEqual({ 'beta-dev': false })
    const raw = await readFile(settingsDocumentPath(home), 'utf8')
    expect(raw).toContain(TEAM_ENABLEMENT_SECTION)
    expect(raw).toContain('false')
  })

  it('enable clears an explicit disable and removes the emptied document', async () => {
    const { home, workspace } = await teamFixture('enable-clear')
    captureOutput()
    expect(await runTeammate('disable', ['beta-dev'], { home, workspace })).toBe(0)
    const { stdout, stderr } = captureOutput()

    const code = await runTeammate('enable', ['beta-dev'], { home, workspace })

    expect(code).toBe(0)
    expect(stdout.join('')).toContain('enabled teammate "beta-dev"')
    expect(stderr.join('')).toBe('')
    await expect(stat(settingsDocumentPath(home))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enable is a no-op that leaves no settings document behind', async () => {
    const { home, workspace } = await teamFixture('enable-noop')
    const { stdout } = captureOutput()

    const code = await runTeammate('enable', ['beta-dev'], { home, workspace })

    expect(code).toBe(0)
    expect(stdout.join('')).toContain('already enabled')
    await expect(stat(settingsDocumentPath(home))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('disable is idempotent: the second run rewrites nothing', async () => {
    const { home, workspace } = await teamFixture('disable-idempotent')
    captureOutput()
    expect(await runTeammate('disable', ['beta-dev'], { home, workspace })).toBe(0)
    const first = await readFile(settingsDocumentPath(home), 'utf8')
    const { stdout } = captureOutput()

    const code = await runTeammate('disable', ['beta-dev'], { home, workspace })

    expect(code).toBe(0)
    expect(stdout.join('')).toContain('already disabled')
    expect(await readFile(settingsDocumentPath(home), 'utf8')).toBe(first)
  })

  it('refuses to disable the leader', async () => {
    const { home, workspace } = await teamFixture('disable-leader')
    const { stderr } = captureOutput()

    const code = await runTeammate('disable', ['team-leader'], { home, workspace })

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('team leader')
    expect(stderr.join('')).toContain('cannot be disabled')
    await expect(stat(settingsDocumentPath(home))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enabling the leader is a no-op (it is never disabled)', async () => {
    const { home, workspace } = await teamFixture('enable-leader')
    const { stdout } = captureOutput()

    const code = await runTeammate('enable', ['team-leader'], { home, workspace })

    expect(code).toBe(0)
    expect(stdout.join('')).toContain('already enabled')
    await expect(stat(settingsDocumentPath(home))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports an id that is not visible from the workspace', async () => {
    const { home, workspace } = await teamFixture('disable-unknown')
    const { stderr } = captureOutput()

    const code = await runTeammate('disable', ['ghost-dev'], { home, workspace })

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('no teammate "ghost-dev" visible from workspace')
    await expect(stat(settingsDocumentPath(home))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('hides home definitions from enable/disable once the workspace defines its own', async () => {
    const home = await tempRoot('dsh-teammate-disable-hidden-home-')
    const workspace = await tempRoot('dsh-teammate-disable-hidden-ws-')
    await writeDefinition(home, 'teammates', 'alpha.md', memberMarkdown('alpha-dev', 'Home alpha.'))
    await writeDefinition(workspace, '.dsh/teammates', 'beta.md', memberMarkdown('beta-dev', 'Ws beta.'))
    const { stderr } = captureOutput()

    const code = await runTeammate('disable', ['alpha-dev'], { home, workspace })

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('no teammate "alpha-dev" visible from workspace')
  })

  it('works for home-visible definitions (keyed by the workspace path)', async () => {
    const home = await tempRoot('dsh-teammate-disable-homevis-home-')
    const workspace = await tempRoot('dsh-teammate-disable-homevis-ws-')
    await writeDefinition(home, 'teammates', 'alpha.md', memberMarkdown('alpha-dev', 'Home alpha.'))
    captureOutput()

    const code = await runTeammate('disable', ['alpha-dev'], { home, workspace })

    expect(code).toBe(0)
    const section = await readEnablementSection(home)
    expect(section[workspace]).toEqual({ 'alpha-dev': false })
  })

  it('preserves other settings namespaces and other workspaces', async () => {
    const { home, workspace } = await teamFixture('disable-preserve')
    const otherWorkspace = join(workspace, 'other-workspace')
    const file = settingsDocumentPath(home)
    await writeFile(file, [
      'permissions:',
      '  preset: workspace-write',
      `${TEAM_ENABLEMENT_SECTION}:`,
      `  ${JSON.stringify(otherWorkspace)}:`,
      '    beta-dev: false',
      '',
    ].join('\n'), 'utf8')
    const { stdout } = captureOutput()

    const code = await runTeammate('disable', ['beta-dev'], { home, workspace })

    expect(code).toBe(0)
    expect(stdout.join('')).toContain('disabled teammate "beta-dev"')
    const doc = load(await readFile(file, 'utf8')) as Record<string, unknown>
    expect((doc['permissions'] as Record<string, unknown>)['preset']).toBe('workspace-write')
    const section = doc[TEAM_ENABLEMENT_SECTION] as Record<string, Record<string, boolean>>
    expect(section[otherWorkspace]).toEqual({ 'beta-dev': false })
    expect(section[workspace]).toEqual({ 'beta-dev': false })
  })

  it('enable keeps other workspaces disabled while clearing this one', async () => {
    const { home, workspace } = await teamFixture('enable-preserve')
    const otherWorkspace = join(workspace, 'other-workspace')
    const file = settingsDocumentPath(home)
    await writeFile(file, [
      `${TEAM_ENABLEMENT_SECTION}:`,
      `  ${JSON.stringify(workspace)}:`,
      '    beta-dev: false',
      `  ${JSON.stringify(otherWorkspace)}:`,
      '    beta-dev: false',
      '',
    ].join('\n'), 'utf8')
    captureOutput()

    const code = await runTeammate('enable', ['beta-dev'], { home, workspace })

    expect(code).toBe(0)
    const doc = load(await readFile(file, 'utf8')) as Record<string, unknown>
    const section = doc[TEAM_ENABLEMENT_SECTION] as Record<string, Record<string, boolean>>
    expect(section[workspace]).toBeUndefined()
    expect(section[otherWorkspace]).toEqual({ 'beta-dev': false })
  })
})

describe('home and workspace resolution', () => {
  it('honors DSH_HOME and DSH_CWD from the environment when no options are given', async () => {
    const home = await tempRoot('dsh-teammate-env-home-')
    const workspace = await tempRoot('dsh-teammate-env-ws-')
    await writeDefinition(workspace, '.dsh/teammates', 'beta.md', memberMarkdown('beta-dev', 'Beta.'))
    const savedHome = process.env['DSH_HOME']
    const savedCwd = process.env['DSH_CWD']
    process.env['DSH_HOME'] = home
    process.env['DSH_CWD'] = workspace
    const { stdout } = captureOutput()
    try {
      const code = await runTeammate('list', [])
      expect(code).toBe(0)
      expect(stdout.join('')).toContain('beta-dev')
    } finally {
      if (savedHome === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = savedHome
      if (savedCwd === undefined) delete process.env['DSH_CWD']
      else process.env['DSH_CWD'] = savedCwd
    }
  })
})

describe('deduplicateTeammates', () => {
  it('keeps the last file per id and only the last leader', async () => {
    const home = await tempRoot('dsh-teammate-dedupe-home-')
    const workspace = await tempRoot('dsh-teammate-dedupe-ws-')
    await writeDefinition(home, 'teammates', 'a-alpha.md', memberMarkdown('alpha-dev', 'First alpha.'))
    await writeDefinition(home, 'teammates', 'b-alpha.md', memberMarkdown('alpha-dev', 'Second alpha.'))
    await writeDefinition(home, 'teammates', 'c-lead1.md', memberMarkdown('lead-one', 'Leader one.', 'leader'))
    await writeDefinition(home, 'teammates', 'd-lead2.md', memberMarkdown('lead-two', 'Leader two.', 'leader'))
    const discovery = await discoverVisibleTeammates(home, workspace)

    const definitions = deduplicateTeammates(discovery.results)

    const ids = definitions.map(d => d.id)
    expect(ids).toEqual(['alpha-dev', 'lead-two'])
    expect(definitions.find(d => d.id === 'alpha-dev')?.prompt).toBe('Second alpha.')
  })
})

/**
 * Loader-parity battery: the CLI's frontmatter mirror must accept and
 * extract exactly what `dsh-team-local`'s `parseTeamMemberMarkdown` accepts
 * and extracts — same verdict, same fields, same diagnostics — so `add`
 * never installs a file the loader would parse differently. The fixtures
 * include the parser's known quirks (block lists under nested keys, quoted
 * numerics), which the mirror must reproduce, not "fix".
 */
const PARITY_FIXTURES: ReadonlyArray<{ name: string; content: string }> = [
  {
    name: 'minimal teammate',
    content: `---
schemaVersion: 1
id: alpha-dev
role: teammate
name: Alpha
description: Frontend work.
---

Alpha prompt.
`,
  },
  {
    name: 'leader with every optional field',
    content: `---
schemaVersion: 1
id: lead
role: leader
name: Lead
description: Runs the team.
provider: deepseek-official
model: deepseek-v4-flash-0731
maxTokens: 16384
tools:
  allow: [read, edit, grep]
  deny: [pwsh]
requiresApproval: [write]
skills: [tdd, code-review]
mcpServers:
  servers: [postgres-mcp]
contextPolicy: fresh_per_delegation
---

Leader prompt body.
`,
  },
  {
    name: 'block list under tools (nested block array)',
    content: `---
schemaVersion: 1
id: quirk-dev
role: teammate
name: Quirk
description: Block list quirk.
tools:
  allow:
    - read
    - grep
---

Body.
`,
  },
  {
    name: 'skills as an indented block list',
    content: `---
schemaVersion: 1
id: skills-dev
role: teammate
name: Skills
description: Block skills.
skills:
  - tdd
  - code-review
---

Body.
`,
  },
  {
    name: 'unknown context policy (warning)',
    content: `---
schemaVersion: 1
id: ctx-dev
role: teammate
name: Ctx
description: Unknown policy.
contextPolicy: rolling
---

Body.
`,
  },
  {
    name: 'empty body (warning)',
    content: `---
schemaVersion: 1
id: empty-dev
role: teammate
name: Empty
description: No body.
---
`,
  },
  { name: 'missing opening delimiter', content: 'id: x\nrole: teammate\n' },
  { name: 'missing closing delimiter', content: '---\n' },
  {
    name: 'unsupported schema version',
    content: `---
schemaVersion: 2
id: x
role: teammate
name: X
description: Y.
---

Body.
`,
  },
  {
    name: 'missing schema version',
    content: `---
id: x
role: teammate
name: X
description: Y.
---

Body.
`,
  },
  {
    name: 'missing id',
    content: `---
schemaVersion: 1
role: teammate
name: X
description: Y.
---

Body.
`,
  },
  {
    name: 'numeric id',
    content: `---
schemaVersion: 1
id: 123
role: teammate
name: X
description: Y.
---

Body.
`,
  },
  {
    name: 'boolean id',
    content: `---
schemaVersion: 1
id: true
role: teammate
name: X
description: Y.
---

Body.
`,
  },
  {
    name: 'missing role',
    content: `---
schemaVersion: 1
id: x
name: X
description: Y.
---

Body.
`,
  },
  {
    name: 'invalid role',
    content: `---
schemaVersion: 1
id: x
role: sidekick
name: X
description: Y.
---

Body.
`,
  },
  {
    name: 'missing name',
    content: `---
schemaVersion: 1
id: x
role: teammate
description: Y.
---

Body.
`,
  },
  {
    name: 'missing description',
    content: `---
schemaVersion: 1
id: x
role: teammate
name: X
---

Body.
`,
  },
  {
    name: 'null description',
    content: `---
schemaVersion: 1
id: x
role: teammate
name: X
description: null
---

Body.
`,
  },
  {
    name: 'skills as a plain string (error)',
    content: `---
schemaVersion: 1
id: x
role: teammate
name: X
description: Y.
skills: tdd
---

Body.
`,
  },
  {
    name: 'skills with an empty entry (error)',
    content: `---
schemaVersion: 1
id: x
role: teammate
name: X
description: Y.
skills: [tdd, ""]
---

Body.
`,
  },
  {
    name: 'quoted name and id',
    content: `---
schemaVersion: 1
id: "quoted-id"
role: teammate
name: 'Quoted Name'
description: Y.
---

Body.
`,
  },
  {
    name: 'quoted maxTokens stays a string and is dropped',
    content: `---
schemaVersion: 1
id: x
role: teammate
name: X
description: Y.
maxTokens: "16384"
---

Body.
`,
  },
  {
    name: 'indented key with no current key (skipped, schemaVersion missing)',
    content: `---
  id: x
---

Body.
`,
  },
  {
    name: 'duplicate keys: last wins',
    content: `---
schemaVersion: 1
id: first
id: second
role: teammate
name: X
description: Y.
---

Body.
`,
  },
]

/** The comparison shape both parser results project onto. */
interface ParitySnapshot {
  readonly hasDefinition: boolean
  readonly definition?: Record<string, unknown>
  readonly diagnostics: Array<readonly [string, string]>
}

/**
 * Project one parser result onto the shared comparison shape: verdict, the
 * full definition field set (plain values), and the diagnostic list.
 * @param result - a CLI or team-local parse result.
 * @returns the projected snapshot.
 */
function paritySnapshot(result: {
  readonly definition?: {
    readonly id: string
    readonly role: 'leader' | 'teammate'
    readonly name: string
    readonly description: string
    readonly prompt: string
    readonly provider?: string
    readonly model?: string
    readonly maxTokens?: number
    readonly tools?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] }
    readonly requiresApproval?: readonly string[]
    readonly skills?: readonly string[]
    readonly mcpServers?: { readonly servers: readonly string[] }
    readonly contextPolicy?: 'persistent' | 'fresh_per_delegation'
  }
  readonly diagnostics: readonly { readonly severity: 'error' | 'warning'; readonly message: string }[]
}): ParitySnapshot {
  const definition = result.definition
  return {
    hasDefinition: definition !== undefined,
    ...(definition === undefined ? {} : { definition: { ...definition } }),
    diagnostics: result.diagnostics.map(diagnostic => [diagnostic.severity, diagnostic.message] as const),
  }
}

describe('frontmatter parity with dsh-team-local', () => {
  for (const fixture of PARITY_FIXTURES) {
    it(`matches the loader on: ${fixture.name}`, () => {
      expect(paritySnapshot(parseTeammateMarkdown(fixture.content, 'fixture.md')))
        .toEqual(paritySnapshot(parseTeamMemberMarkdown(fixture.content, 'fixture.md')))
    })
  }
})
