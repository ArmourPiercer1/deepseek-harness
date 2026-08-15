import { describe, expect, it } from 'vitest'
import type { PathMatcher } from '../src/matchers.ts'
import { matchPath, type PathMatchBases } from '../src/match-path.ts'

const HOMEDIR = '/Users/alice'
const SETTINGS = '/Users/alice/.config/dsh'
const CWD = '/Users/alice/proj'

const bases: PathMatchBases = { settingsDir: SETTINGS, homeDir: HOMEDIR, cwd: CWD }

function matcher(pattern: string, tool = 'Read'): PathMatcher {
  return { kind: 'path', tool, pattern }
}

describe('matchPath anchors', () => {
  it('resolves //path from the filesystem root', () => {
    const m = matcher('//Users/alice/proj/x')
    expect(matchPath(m, 'Read', { file_path: '/Users/alice/proj/x' }, bases)).toBe(true)
    expect(matchPath(m, 'Read', { file_path: '/other/x' }, bases)).toBe(false)
  })

  it('resolves ~/path from homeDir', () => {
    const m = matcher('~/proj/x')
    expect(matchPath(m, 'Read', { file_path: '/Users/alice/proj/x' }, bases)).toBe(true)
    expect(matchPath(m, 'Read', { file_path: '/Users/alice/other/x' }, bases)).toBe(false)
  })

  it('resolves /path from settingsDir', () => {
    const m = matcher('/rules.d/x')
    expect(matchPath(m, 'Read', { file_path: '/Users/alice/.config/dsh/rules.d/x' }, bases)).toBe(true)
    expect(matchPath(m, 'Read', { file_path: '/Users/alice/proj/rules.d/x' }, bases)).toBe(false)
  })

  it('resolves relative and ./path from cwd', () => {
    const rel = matcher('src/main.ts')
    expect(matchPath(rel, 'Read', { file_path: '/Users/alice/proj/src/main.ts' }, bases)).toBe(true)
    expect(matchPath(rel, 'Read', { file_path: '/Users/alice/src/main.ts' }, bases)).toBe(false)

    const dot = matcher('./src/main.ts')
    expect(matchPath(dot, 'Read', { file_path: '/Users/alice/proj/src/main.ts' }, bases)).toBe(true)
  })
})

describe('matchPath gitignore globs', () => {
  it('treats Read(**/.env) and Read(.env) equivalently at any depth', () => {
    const glob = matcher('**/.env')
    const bare = matcher('.env')
    for (const m of [glob, bare]) {
      expect(matchPath(m, 'Read', { file_path: '/Users/alice/proj/.env' }, bases)).toBe(true)
      expect(matchPath(m, 'Read', { file_path: '/Users/alice/proj/a/b/.env' }, bases)).toBe(true)
      expect(matchPath(m, 'Read', { file_path: '/Users/alice/proj/a.env' }, bases)).toBe(false)
    }
  })

  it('matches * within a single segment but not across segments', () => {
    const m = matcher('a/*/c')
    expect(matchPath(m, 'Read', { file_path: '/Users/alice/proj/a/b/c' }, bases)).toBe(true)
    expect(matchPath(m, 'Read', { file_path: '/Users/alice/proj/a/b/d/c' }, bases)).toBe(false)
  })

  it('matches ** across segments', () => {
    const m = matcher('a/**/c')
    expect(matchPath(m, 'Read', { file_path: '/Users/alice/proj/a/b/d/c' }, bases)).toBe(true)
  })
})

describe('matchPath Windows normalization', () => {
  it('matches //c/**/.env against C:\\proj\\.env', () => {
    const m = matcher('//c/**/.env')
    expect(matchPath(m, 'Read', { file_path: 'C:\\proj\\.env' }, bases)).toBe(true)
    expect(matchPath(m, 'Read', { file_path: 'D:\\proj\\.env' }, bases)).toBe(false)
  })
})

describe('matchPath field extraction', () => {
  it('prefers file_path, then path, then target_path, then notebook_path', () => {
    const m = matcher('//Users/alice/proj/x')
    expect(matchPath(m, 'Read', { path: '/Users/alice/proj/x' }, bases)).toBe(true)
    expect(matchPath(m, 'Read', { target_path: '/Users/alice/proj/x' }, bases)).toBe(true)
    expect(matchPath(m, 'Read', { notebook_path: '/Users/alice/proj/x' }, bases)).toBe(true)
    expect(
      matchPath(m, 'Read', { file_path: '/Users/alice/proj/x', path: '/elsewhere' }, bases),
    ).toBe(true)
    expect(matchPath(m, 'Read', { path: 5, target_path: '/Users/alice/proj/x' }, bases)).toBe(true)
  })

  it('returns false when no path field is present or string', () => {
    const m = matcher('x')
    expect(matchPath(m, 'Read', {}, bases)).toBe(false)
    expect(matchPath(m, 'Read', { file_path: 123 }, bases)).toBe(false)
    expect(matchPath(m, 'Read', { other: '/Users/alice/proj/x' }, bases)).toBe(false)
  })

  it('returns false on a tool mismatch', () => {
    const m = matcher('x', 'Read')
    expect(matchPath(m, 'Edit', { file_path: '/Users/alice/proj/x' }, bases)).toBe(false)
  })
})
