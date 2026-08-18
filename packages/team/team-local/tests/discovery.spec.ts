import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deduplicateDefinitions, discoverTeamMembers } from '../src/discovery.ts'
import { parseTeamMemberMarkdown } from '../src/parser.ts'

/** Hooks observed by the mocked node:fs/promises readFile. */
const readHarness = vi.hoisted(() => ({
  onReadFile: undefined as ((path: string) => void) | undefined,
}))

// The readFile hook drives the mid-scan abort test; every other fs/promises
// operation passes through to the real implementation.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (async (path: unknown, ...rest: never[]) => {
      readHarness.onReadFile?.(String(path))
      return (actual.readFile as (path: unknown, ...args: never[]) => Promise<unknown>)(path, ...rest)
    }) as typeof actual.readFile,
  }
})

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

const cleanups: Array<() => Promise<void>> = []

/**
 * Create a temp root directory for a discovery layout.
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

afterEach(async () => {
  readHarness.onReadFile = undefined
  while (cleanups.length > 0) await cleanups.pop()!()
})

describe('discoverTeamMembers', () => {
  it('discovers .md definitions from both homePath and workspacePath', async () => {
    const home = await tempRoot('dsh-team-discovery-home-')
    const workspace = await tempRoot('dsh-team-discovery-workspace-')
    await writeDefinition(home, 'teammates', 'leader.md', memberMarkdown('team-leader', 'You are the leader.', 'leader'))
    await writeDefinition(home, 'teammates', 'notes.txt', 'not a definition')
    await writeDefinition(workspace, '.dsh/teammates', 'alpha.md', memberMarkdown('alpha-dev', 'Alpha prompt.'))
    await writeDefinition(workspace, '.dsh/teammates', 'backend.md', memberMarkdown('backend-dev', 'Backend prompt.'))

    const results = await discoverTeamMembers({ homePath: home, workspacePath: workspace })

    // Home scans first, then the workspace; files sort within each directory
    // and non-.md entries are ignored.
    expect(results.map(r => r.definition?.id)).toEqual(['team-leader', 'alpha-dev', 'backend-dev'])
    expect(results[0]!.definition?.sourcePath).toBe(join(home, 'teammates', 'leader.md'))
    expect(results[1]!.definition?.sourcePath).toBe(join(workspace, '.dsh', 'teammates', 'alpha.md'))
    expect(results[2]!.definition?.sourcePath).toBe(join(workspace, '.dsh', 'teammates', 'backend.md'))
  })

  it('returns an empty list when neither directory exists', async () => {
    const base = await tempRoot('dsh-team-discovery-missing-')

    const results = await discoverTeamMembers({
      homePath: join(base, 'home'),
      workspacePath: join(base, 'workspace'),
    })

    expect(results).toEqual([])
  })

  it('skips a missing home directory and keeps workspace results', async () => {
    const base = await tempRoot('dsh-team-discovery-nohome-')
    const workspace = join(base, 'workspace')
    await writeDefinition(workspace, '.dsh/teammates', 'backend.md', memberMarkdown('backend-dev', 'Backend prompt.'))

    const results = await discoverTeamMembers({ homePath: join(base, 'home'), workspacePath: workspace })

    expect(results).toHaveLength(1)
    expect(results[0]!.definition?.id).toBe('backend-dev')
  })

  it('skips a missing workspace directory and keeps home results', async () => {
    const base = await tempRoot('dsh-team-discovery-noworkspace-')
    const home = join(base, 'home')
    await writeDefinition(home, 'teammates', 'leader.md', memberMarkdown('team-leader', 'You are the leader.', 'leader'))

    const results = await discoverTeamMembers({ homePath: home, workspacePath: join(base, 'workspace') })

    expect(results).toHaveLength(1)
    expect(results[0]!.definition?.id).toBe('team-leader')
  })

  it('skips an empty homePath entirely', async () => {
    const workspace = await tempRoot('dsh-team-discovery-nohome-')
    await writeDefinition(workspace, '.dsh/teammates', 'backend.md', memberMarkdown('backend-dev', 'Backend prompt.'))

    const results = await discoverTeamMembers({ homePath: '', workspacePath: workspace })

    expect(results.map(r => r.definition?.id)).toEqual(['backend-dev'])
  })

  it('rejects when the signal is already aborted', async () => {
    const home = await tempRoot('dsh-team-discovery-abort-')
    await writeDefinition(home, 'teammates', 'leader.md', memberMarkdown('team-leader', 'You are the leader.', 'leader'))
    const controller = new AbortController()
    controller.abort()

    await expect(discoverTeamMembers({ homePath: home, signal: controller.signal }))
      .rejects.toThrow('aborted')
  })

  it('rejects mid-scan when the signal aborts between files', async () => {
    const home = await tempRoot('dsh-team-discovery-abort-')
    await writeDefinition(home, 'teammates', 'a.md', memberMarkdown('a-dev', 'A prompt.'))
    await writeDefinition(home, 'teammates', 'b.md', memberMarkdown('b-dev', 'B prompt.'))
    const controller = new AbortController()
    readHarness.onReadFile = (path) => {
      if (path.endsWith('a.md')) controller.abort()
    }

    await expect(discoverTeamMembers({ homePath: home, signal: controller.signal }))
      .rejects.toThrow('aborted')
  })
})

describe('deduplicateDefinitions', () => {
  it('keeps only successful parses and lets the last definition win per id', () => {
    const failed = parseTeamMemberMarkdown('no frontmatter', '/home/teammates/broken.md')
    const home = parseTeamMemberMarkdown(memberMarkdown('dup-dev', 'Home prompt.'), '/home/teammates/dup.md')
    const workspace = parseTeamMemberMarkdown(memberMarkdown('dup-dev', 'Workspace prompt.'), '/workspace/.dsh/teammates/dup.md')

    const definitions = deduplicateDefinitions([failed, home, workspace])

    expect(definitions).toHaveLength(1)
    expect(definitions[0]!.prompt).toBe('Workspace prompt.')
    expect(definitions[0]!.sourcePath).toBe('/workspace/.dsh/teammates/dup.md')
  })

  it('prefers the workspace definition when the same id exists in both roots', async () => {
    const home = await tempRoot('dsh-team-discovery-precedence-')
    const workspace = await tempRoot('dsh-team-discovery-precedence-')
    await writeDefinition(home, 'teammates', 'leader.md', memberMarkdown('team-leader', 'You are the leader.', 'leader'))
    await writeDefinition(home, 'teammates', 'shared.md', memberMarkdown('shared-dev', 'Home prompt.'))
    await writeDefinition(workspace, '.dsh/teammates', 'shared.md', memberMarkdown('shared-dev', 'Workspace prompt.'))

    const results = await discoverTeamMembers({ homePath: home, workspacePath: workspace })
    const definitions = deduplicateDefinitions(results)

    expect(results.map(r => r.definition?.id)).toEqual(['team-leader', 'shared-dev', 'shared-dev'])
    expect(definitions).toHaveLength(2)
    const shared = definitions.find(d => d.id === 'shared-dev')
    expect(shared?.prompt).toBe('Workspace prompt.')
    expect(shared?.sourcePath).toBe(join(workspace, '.dsh', 'teammates', 'shared.md'))
  })
})
