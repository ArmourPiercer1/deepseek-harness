# Agent Note: Team Workspace Discovery Tracks the Live Session

Status: implemented

English | [中文](2026-08-18-team-workspace-session-discovery.zh.md)

Related: [Agent Team Plugin](2026-08-14-agent-team-plugin.md), [Team Plugin Round 2](2026-08-18-team-plugin-round-2.md).

## Problem

`dsh-team-local` resolved the teammate workspace once at mount time from the configured `workspacePath`, then `$DSH_CWD`, then the process cwd. A preset mounts once under a standing scope shared by every session joined to it, so on a multi-session surface (`dsh web`) no session workspace exists at mount time and the fallback resolved to the server process cwd. Project teammates under `<workspace>/.dsh/teammates/` were never discovered: sessions saw only the global `$DSH_HOME/teammates/` definitions regardless of their workspace. Two mount-time merge behaviors compounded the problem: home and workspace definitions merged into one set, leaking unrelated global teams into every project workspace, and `list_teammates` filtered the leader out, hiding the workspace leader definition from the model.

## Decision

- **Session workspace tracking**: team-local listens for `agent/created`, which propagates from each agent scope up to the standing mount. When the created agent's session header carries a non-empty `cwd` different from the tracked workspace, team-local re-points the workspace at that directory and reloads immediately, and adds a watcher for the new `.dsh/teammates/` directory. The mount-time resolution (config, `$DSH_CWD`, process cwd) remains the initial seed for single-process surfaces such as the CLI.
- **Self-contained workspace teams**: a workspace that defines members under `.dsh/teammates/` forms the complete team for that workspace; home definitions are a fallback that applies only to workspaces that define none of their own. Cross-source merging and the workspace-leader-overrides-home-leader fold are gone from the load path.
- **Leader visibility**: `list_teammates` lists the leader together with the teammates. `delegate_to_teammate` rejects the leader id, because the leader is the composed root agent of the calling session, never a delegation target.

## Alternatives considered

- **Passing the session workspace through preset config**: rejected — a standing composition is shared by sessions in different workspaces, and preset config is static per mount.
- **Keeping home+workspace merging with workspace precedence**: rejected — global teams leaked into unrelated project workspaces, so a project team could not be listed as defined.
- **Keying the registry per workspace and filtering tools by caller session**: deferred — the orchestrator and progress store are also process-scoped today; per-workspace registry views belong with that session-scoping work. The registry holds one flat set, and the most recently created agent's workspace determines it (documented in the package README).

## Consequences

- A session under `D:\test\team-e2e-demo` using the `team` preset lists exactly `leader`, `backend-dev`, and `code-reviewer`; the global AIEO definitions in `$DSH_HOME/teammates/` no longer appear.
- `dsh-team-local` depends on `dsh-agent`/`dsh-session` types for the `agent/created` payload.
- Team tests grew to 189 across 25 suites, including `session-workspace.spec.ts` covering workspace switches, the home fallback, watcher lifecycle, and dispose.
