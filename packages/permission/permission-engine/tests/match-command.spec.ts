import { describe, expect, it } from 'vitest'
import type { CommandMatcher } from '../src/matchers.ts'
import { matchCommand } from '../src/match-command.ts'

function bash(pattern: string): CommandMatcher {
  return { kind: 'command', tool: 'Bash', pattern }
}

function pwsh(pattern: string): CommandMatcher {
  return { kind: 'command', tool: 'pwsh', pattern }
}

function cmd(pattern: string, command: string): boolean {
  return matchCommand(bash(pattern), 'Bash', { command })
}

describe('matchCommand', () => {
  it('exact pattern requires full-string equality', () => {
    expect(matchCommand(bash('ls'), 'Bash', { command: 'ls' })).toBe(true)
    expect(matchCommand(bash('ls'), 'Bash', { command: 'ls -la' })).toBe(false)
    expect(matchCommand(bash('ls -la'), 'Bash', { command: 'ls -la' })).toBe(true)
    expect(matchCommand(bash('ls'), 'Bash', { command: 'lsof' })).toBe(false)
  })

  it('trailing ` *` enforces a word boundary, `ls*` does not', () => {
    expect(matchCommand(bash('ls *'), 'Bash', { command: 'ls -la' })).toBe(true)
    expect(matchCommand(bash('ls *'), 'Bash', { command: 'lsof' })).toBe(false)
    expect(matchCommand(bash('ls*'), 'Bash', { command: 'ls -la' })).toBe(true)
    expect(matchCommand(bash('ls*'), 'Bash', { command: 'lsof' })).toBe(true)
    expect(matchCommand(bash('ls*'), 'Bash', { command: 'ls' })).toBe(true)
  })

  it('`:*` suffix is equivalent to a trailing ` *`', () => {
    expect(matchCommand(bash('ls:*'), 'Bash', { command: 'ls -la' })).toBe(true)
    expect(matchCommand(bash('ls:*'), 'Bash', { command: 'lsof' })).toBe(false)
    expect(matchCommand(bash('git push:*'), 'Bash', { command: 'git push origin main' })).toBe(true)
    expect(matchCommand(bash('git push:*'), 'Bash', { command: 'git pull origin main' })).toBe(false)
  })

  it('a `:` mid-pattern stays literal', () => {
    // `ls:foo*` must not be treated as `ls foo*`; the colon is literal.
    expect(matchCommand(bash('node:run *'), 'Bash', { command: 'node:run x' })).toBe(true)
    expect(matchCommand(bash('node:run *'), 'Bash', { command: 'node run x' })).toBe(false)
    expect(matchCommand(bash('ls:a*'), 'Bash', { command: 'ls:abc' })).toBe(true)
    expect(matchCommand(bash('ls:a*'), 'Bash', { command: 'ls abc' })).toBe(false)
  })

  it('matches any subcommand of a compound command', () => {
    expect(cmd('rm *', 'git status && rm -rf x')).toBe(true)
    expect(cmd('rm *', 'rm -rf x && git status')).toBe(true)
    expect(cmd('git status', 'git status && rm -rf x')).toBe(true)
    expect(cmd('true', 'false; true')).toBe(true)
    expect(cmd('ls *', 'cd /tmp | ls -la')).toBe(true)
  })

  it('strips wrappers before matching', () => {
    expect(cmd('npm test *', 'timeout 30 npm test x')).toBe(true)
    expect(cmd('npm test *', 'time npm test x')).toBe(true)
    expect(cmd('npm test *', 'nohup npm test x &')).toBe(true)
    expect(cmd('npm test *', 'nice npm test x')).toBe(true)
    expect(cmd('npm test *', 'builtin npm test x')).toBe(true)
    expect(cmd('npm test *', 'stdbuf -oL npm test x')).toBe(true)
  })

  it('strips leading env-var assignments', () => {
    expect(cmd('npm test *', 'NODE_ENV=test npm test x')).toBe(true)
    expect(cmd('npm test *', 'A=1 B=2 npm test x')).toBe(true)
  })

  it('does not strip `command -v`', () => {
    expect(matchCommand(bash('command -v *'), 'Bash', { command: 'command -v ls' })).toBe(true)
    // If `command -v` were stripped to `-v ...`, `ls *` would still fail; keep intact.
    expect(matchCommand(bash('ls *'), 'Bash', { command: 'command -v ls' })).toBe(false)
  })

  it('strips a bare xargs but keeps one with flags', () => {
    expect(cmd('ls *', 'xargs ls -la')).toBe(true)
    expect(cmd('xargs -0 *', 'xargs -0 rm')).toBe(true)
    // A flag-carrying xargs is not stripped, so a bare-command pattern misses.
    expect(cmd('ls *', 'xargs -0 rm')).toBe(false)
  })

  it('canonicalizes pwsh aliases case-insensitively', () => {
    expect(matchCommand(pwsh('Remove-Item *'), 'pwsh', { command: 'rm foo' })).toBe(true)
    expect(matchCommand(pwsh('Remove-Item *'), 'pwsh', { command: 'Remove-Item foo' })).toBe(true)
    expect(matchCommand(pwsh('Get-ChildItem *'), 'pwsh', { command: 'gci -r' })).toBe(true)
    // Alias-authored pattern also canonicalizes.
    expect(matchCommand(pwsh('del *'), 'pwsh', { command: 'Remove-Item foo' })).toBe(true)
    // Non-pwsh does not canonicalize aliases.
    expect(matchCommand(bash('Get-ChildItem *'), 'Bash', { command: 'gci foo' })).toBe(false)
  })

  it('is case-insensitive on the tool name and pwsh command', () => {
    expect(matchCommand(bash('ls'), 'bash', { command: 'ls' })).toBe(true)
    expect(matchCommand(pwsh('Remove-Item *'), 'PWSH', { command: 'RM FOO' })).toBe(true)
  })

  it('returns false for non-object args or missing command', () => {
    expect(matchCommand(bash('ls'), 'Bash', 42)).toBe(false)
    expect(matchCommand(bash('ls'), 'Bash', null)).toBe(false)
    expect(matchCommand(bash('ls'), 'Bash', 'ls')).toBe(false)
    expect(matchCommand(bash('ls'), 'Bash', [])).toBe(false)
    expect(matchCommand(bash('ls'), 'Bash', {})).toBe(false)
    expect(matchCommand(bash('ls'), 'Bash', { command: 42 })).toBe(false)
    expect(matchCommand(bash('ls'), 'Bash', { foo: 'ls' })).toBe(false)
  })

  it('returns false on tool mismatch', () => {
    expect(matchCommand(bash('ls'), 'Bash', { command: 'ls' })).toBe(true)
    expect(matchCommand(bash('ls'), 'pwsh', { command: 'ls' })).toBe(false)
    expect(matchCommand(bash('ls'), 'Read', { command: 'ls' })).toBe(false)
  })
})
