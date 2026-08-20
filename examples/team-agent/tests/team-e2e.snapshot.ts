/**
 * Assembled-app regression for the shipped `team` agent preset: one leader
 * delegates to two approval-gated teammates across a hard process crash and
 * cold recovery, through the real base + web-app profile composition. The
 * only model is the deterministic team-mock adapter, so the persisted
 * transcripts below are the keyless goldens.
 *
 * The driver runs as two phases over one temporary home: the `crash` phase
 * runs delegation and approval and exits hard with sentry suspended at its
 * gate; the `recover` phase re-boots from the same home and cold-recovers,
 * repairing the suspended call. A single process cannot express the crash —
 * a clean fiber dispose would settle the suspended call and skip the repair
 * under test — so the phases share their home instead of `runLoaderSmoke`'s
 * per-launch cwd.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSessionLog, scrubRequestHeaders, type NormalizeContext } from '@deepseek-ai/dsh-acp-snapshot'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const exampleDir = dirname(testDir)
const repoRoot = join(exampleDir, '..', '..')
const fixtureDir = join(testDir, 'snapshots', 'team-e2e')
const binScript = join(testDir, 'fixtures', 'team-driver.ts')
const tsconfigPath = join(repoRoot, 'tsconfig.json')
const LEADER_ID = 'team-agent-leader'

/** Per-phase budget: one profile boot plus the scripted scenario turns. */
const PHASE_TIMEOUT_MS = 90_000
const TEST_TIMEOUT_MS = PHASE_TIMEOUT_MS * 2 + 30_000

/** The child session ids the driver records across the crash. */
interface ChildSessions {
  readonly leader: string
  readonly writer: string
  readonly sentry: string
}

interface SessionLogs {
  readonly leader: string
  readonly writer: string
  readonly sentry: string
}

/** Spawn one driver phase in the shared home cwd; resolve with its stdout. */
function launchPhase(cwd: string, phaseEnv: Record<string, string>): Promise<string> {
  const launch = resolveExampleLaunch({
    srcBin: binScript,
    libBin: binScript,
    tsconfigPath,
    env: {
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_HOME: join(cwd, '.dsh'),
      ...phaseEnv,
    },
  })
  return new Promise<string>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd,
      env: { ...process.env, ...launch.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(
      () => {
        child.kill()
        reject(new Error(`team snapshot phase timed out after ${PHASE_TIMEOUT_MS / 1000}s. stdout:\n${stdout}\nstderr:\n${stderr}`))
      },
      PHASE_TIMEOUT_MS,
    )
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`team snapshot phase exited ${String(code)}. stdout:\n${stdout}\nstderr:\n${stderr}`))
      } else {
        resolve(stdout)
      }
    })
  })
}

/** The driver's JSONL result record from one phase's stdout. */
function resultRecord(stdout: string, phase: 'crash' | 'recover'): ChildSessions {
  const line = stdout.split('\n').find(entry => entry.includes(`"phase":"${phase}"`))
  if (line === undefined) throw new Error(`team snapshot: no ${phase} result record on stdout`)
  return (JSON.parse(line) as { type: string; sessions: ChildSessions }).sessions
}

/** Every `session.jsonl` under the persistence root, keyed by session id. */
async function findSessionLogs(root: string): Promise<Map<string, string>> {
  const byId = new Map<string, string>()
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (entry.name !== 'session.jsonl') continue
      const raw = await readFile(path, 'utf8')
      const header = JSON.parse(raw.split('\n').find(line => line.trim().length > 0) ?? '{}') as { id?: string }
      if (typeof header.id === 'string') byId.set(header.id, raw)
    }
  }
  await walk(root)
  return byId
}

/** Identify the two child logs by their durable member-bound events. */
function splitChildren(logs: Map<string, string>): Pick<SessionLogs, 'writer' | 'sentry'> {
  let writer = ''
  let sentry = ''
  for (const [id, raw] of logs) {
    if (id === LEADER_ID) continue
    const bound = raw.match(/"type":"team\/member-bound"[^\n]*"memberId":"(writer|sentry)"/)
    if (bound === null || bound[1] === undefined) continue
    if (bound[1] === 'writer') writer = raw
    else sentry = raw
  }
  return { writer, sentry }
}

describe('team-agent keyless snapshot', () => {
  it('delegates, approves, hard-crashes, and cold-recovers the team through the shipped profile', async () => {
    const refreshing = process.env.DSH_SNAPSHOT === 'refresh'
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-team-snapshot-'))
    let logs: SessionLogs | undefined
    try {
      const crashSessions = resultRecord(await launchPhase(cwd, { DSH_TEAM_DRIVER_PHASE: 'crash' }), 'crash')
      const recoverSessions = resultRecord(
        await launchPhase(cwd, {
          DSH_TEAM_DRIVER_PHASE: 'recover',
          DSH_TEAM_CHILD_SESSIONS: JSON.stringify(crashSessions),
        }),
        'recover',
      )
      expect(recoverSessions).toEqual(crashSessions)
      expect(recoverSessions.leader).toBe(LEADER_ID)
      expect(recoverSessions.writer).toBeTruthy()
      expect(recoverSessions.sentry).toBeTruthy()

      const rawLogs = await findSessionLogs(join(cwd, '.dsh', 'sessions'))
      expect(rawLogs.size).toBe(3)
      const leaderRaw = rawLogs.get(LEADER_ID)
      if (leaderRaw === undefined) throw new Error(`team snapshot: no leader log for ${LEADER_ID}`)
      const { writer, sentry } = splitChildren(rawLogs)
      if (writer === '' || sentry === '') throw new Error('team snapshot: writer or sentry log missing')
      const normalization: NormalizeContext = { sessionIds: [...rawLogs.keys()], cwd }
      logs = {
        leader: scrubRequestHeaders(normalizeSessionLog(leaderRaw, normalization)),
        writer: scrubRequestHeaders(normalizeSessionLog(writer, normalization)),
        sentry: scrubRequestHeaders(normalizeSessionLog(sentry, normalization)),
      }
      // World state: the approved write landed in the workspace.
      expect(await readFile(join(cwd, 'workspace-a', 'notes', 'hello.txt'), 'utf8')).toBe('hello from writer\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }

    const scenario = logs
    if (scenario === undefined) throw new Error('team snapshot: inspect did not run')

    const expected = {
      leader: join(fixtureDir, 'leader.expected.jsonl'),
      writer: join(fixtureDir, 'writer.expected.jsonl'),
      sentry: join(fixtureDir, 'sentry.expected.jsonl'),
    }
    if (refreshing) {
      await mkdir(fixtureDir, { recursive: true })
      await Promise.all([
        writeFile(expected.leader, scenario.leader),
        writeFile(expected.writer, scenario.writer),
        writeFile(expected.sentry, scenario.sentry),
      ])
    }
    expect(scenario.leader).toBe(await readFile(expected.leader, 'utf8'))
    expect(scenario.writer).toBe(await readFile(expected.writer, 'utf8'))
    expect(scenario.sentry).toBe(await readFile(expected.sentry, 'utf8'))

    // Model-visible invariants the goldens pin, asserted directly for a
    // readable failure when one regresses:
    // delegation dispatched both teammates
    expect(scenario.leader).toContain('"name":"delegate_to_teammate"')
    expect(scenario.leader).toContain('Both teammates dispatched.')
    // approval: writer's request was decided; the write then executed
    expect(scenario.writer).toContain('"type":"team/control-request"')
    expect(scenario.leader).toContain('"type":"team/control-decision"')
    expect(scenario.writer).toContain('hello from writer')
    // crash: sentry's pre-restart request never received a decision
    expect(scenario.sentry.split('SENTRY_FOLLOWUP').at(0)).not.toContain('team/control-decision')
    // cold recovery: the interrupted call is repaired, the skill guard holds
    // on the resumed child, and the fresh request decides and executes
    // The crash leaves sentry's `todo_write` call recorded but undelivered, so
    // repair closes it as unknown rather than not started.
    expect(scenario.sentry).toContain('TOOL_OUTCOME_UNKNOWN')
    // (the skill name is JSON-escaped inside the log line)
    expect(scenario.sentry).toContain('Skill \\"beta\\" is not authorized for this team member')
    expect(scenario.sentry).toContain('"type":"team/control-request"')
    // discovery: the leader lists the workspace self-defined members only
    expect(scenario.leader).toContain('- Writer (writer) [teammate] — idle')
    expect(scenario.leader).toContain('- Sentry (sentry) [teammate] — idle')
    expect(scenario.leader).not.toContain('Home Member')
    // the stale decision fails model-visibly after the restart
    expect(scenario.leader).toContain('Error: Unknown control request:')
    // settlement closes the scenario
    expect(scenario.leader).toContain('Team task complete.')
  }, TEST_TIMEOUT_MS)
})
