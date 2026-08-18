import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Message } from '@deepseek-ai/cordis'
import { DEFAULT_LEADER_TOOLS, TeamMemberId } from '@deepseek-ai/dsh-team'
import type { TeamMemberDefinition } from '@deepseek-ai/dsh-team'
import TeamRegistry from '@deepseek-ai/dsh-team'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as TeamLocal from '../src/index.ts'
import { diagnoseLeaderTools } from '../src/diagnostic.ts'

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
 * Write the leader definition under the home teammates directory.
 *
 * @param home - DSH home temp root.
 */
async function writeLeader(home: string): Promise<void> {
  await mkdir(join(home, 'teammates'), { recursive: true })
  await writeFile(join(home, 'teammates', 'leader.md'), memberMarkdown('Coordinates all teammates.'))
}

/**
 * Mount team-local on a bare Context backed by a real TeamRegistry, capture
 * every log message through a test exporter, and optionally provide a
 * minimal fake `tools` service exposing the given tool names.
 *
 * @param options - home path, workspace path, and fake tool names.
 * @returns the plugin fiber, the registry, a call-through spy on register,
 *   and the captured log messages.
 */
async function boot(options: {
  homePath: string
  workspacePath: string
  toolNames?: string[]
}) {
  const ctx = new Context()
  const team = new TeamRegistry(ctx)
  const register = vi.spyOn(team, 'register')
  const messages: Message[] = []
  // 3 = LoggerLevel.DEBUG: let every severity reach the exporter.
  ctx.logger.exporter({
    levels: { default: 3 },
    export: (message) => { messages.push(message) },
  })
  if (options.toolNames !== undefined) {
    const toolNames = options.toolNames
    ctx.provide('tools', {
      schemas: () => toolNames.map(name => ({ name })),
    })
  }
  const fiber = ctx.plugin(TeamLocal, {
    homePath: options.homePath,
    workspacePath: options.workspacePath,
  })
  cleanups.push(() => fiber.dispose())
  await fiber
  return { ctx, fiber, team, register, messages }
}

afterEach(async () => {
  vi.restoreAllMocks()
  while (cleanups.length > 0) await cleanups.pop()!()
})

describe('team-local leader tool diagnostic', () => {
  it('warns listing the default leader tools missing from ctx.tools', async () => {
    const home = await tempRoot('dsh-team-local-diag-missing-')
    const workspace = await tempRoot('dsh-team-local-diag-missing-ws-')
    await writeLeader(home)

    const { register, messages } = await boot({
      homePath: home,
      workspacePath: workspace,
      // Only the five team-specific tools are registered; the five
      // general-purpose defaults are absent.
      toolNames: [
        'delegate_to_teammate',
        'send_team_message',
        'team_progress',
        'team_control',
        'list_teammates',
      ],
    })
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(1) }, { timeout: 5000 })

    const warns = messages.filter(m => m.type === 'warn')
    expect(warns).toHaveLength(1)
    expect(warns[0]?.args[0]).toBe(
      'leader "team-leader": 5 default leader tools not registered: read, grep, glob, todo_write, web_search',
    )
  })

  it('logs no warning when every default leader tool is registered', async () => {
    const home = await tempRoot('dsh-team-local-diag-full-')
    const workspace = await tempRoot('dsh-team-local-diag-full-ws-')
    await writeLeader(home)

    const { register, messages } = await boot({
      homePath: home,
      workspacePath: workspace,
      // All defaults plus an unrelated tool the diagnostic must ignore.
      toolNames: [...DEFAULT_LEADER_TOOLS, 'pwsh'],
    })
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(1) }, { timeout: 5000 })

    expect(messages.filter(m => m.type === 'warn')).toEqual([])
  })

  it('logs no warning when no leader definition is registered', () => {
    const ctx = new Context()
    const team = new TeamRegistry(ctx)
    team.register([{
      id: TeamMemberId('worker'),
      role: 'teammate',
      name: 'Worker',
      description: 'Background task execution.',
      prompt: 'You are a worker.',
    } satisfies TeamMemberDefinition])
    const messages: Message[] = []
    ctx.logger.exporter({
      levels: { default: 3 },
      export: (message) => { messages.push(message) },
    })

    const missing = diagnoseLeaderTools(ctx)

    expect(missing).toEqual([])
    expect(messages.filter(m => m.type === 'warn')).toEqual([])
  })

  it('warns about every default leader tool when no tools service is mounted', async () => {
    const home = await tempRoot('dsh-team-local-diag-notools-')
    const workspace = await tempRoot('dsh-team-local-diag-notools-ws-')
    await writeLeader(home)

    const { register, messages } = await boot({
      homePath: home,
      workspacePath: workspace,
    })
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(1) }, { timeout: 5000 })

    const warns = messages.filter(m => m.type === 'warn')
    expect(warns).toHaveLength(1)
    expect(warns[0]?.args[0]).toBe(
      `leader "team-leader": ${DEFAULT_LEADER_TOOLS.length} default leader tools not registered: ${DEFAULT_LEADER_TOOLS.join(', ')}`,
    )
  })
})
