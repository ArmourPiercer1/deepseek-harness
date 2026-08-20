# Agent Note: The tool permission guard resolves `ctx.permission` per tool call

Status: implemented

English | [中文](2026-08-20-tool-permission-guard-resolves-permission-per-call.zh.md)

## Problem

The guard is a `tools/pre-execute` listener that consumes the `permission` service published by the engine row, and the two rows live in the same cordis.yml. The Loader activates rows in parallel, so the guard's `apply()` can run before the engine row registers the service. An apply-time service read races that ordering: strict `ctx.get` only returns a service whose provider fiber is active, and a read that misses the provider leaves the guard registering nothing — its composed deny rules stay silently inactive for the whole session. Separately, rules the engine's parser rejects (malformed) or ignores (a `param:value` on a primary content field) are dropped by `compile`, and the guard had no path to surface that, so a dropped deny was invisible.

## Decision

The guard resolves `ctx.permission` per tool call, inside its `tools/pre-execute` listener, instead of at `apply()` time. Every call reads the service with strict `ctx.get` and compiles the scope's rules lazily once, on the first call after the service is present. When the service is absent — no engine row composed for the scope — the guard delegates through `next()` and the call proceeds unguarded: the guard's loose-in-the-composition semantics hold, and it arms itself the moment the engine row becomes active, under any activation order.

At that first compile, the guard logs every diagnostic the engine's parser reports through its own logger: diagnostics carrying the engine's `error:` prefix at error level, the rest at warn level. The `permission/decision` audit append and the decision-to-pre-execute mapping are unchanged.

## Alternatives considered

**Apply-time resolution with a hard `inject: ['permission']`** — what the team plugin does instead. Injection makes the fiber wait for the service and removes the race, but it also makes the guard incomposable without an engine row: a scope that composes the guard without the engine fails to activate. The permission seam note assigns the team plugin the hard dependency because its approval path requires it; the guard keeps the loose contract so it can be dropped into any composition that already carries an engine.

**Waiting or retrying until the service appears** — a poll or readiness event would add a timer and extra state to a listener that should stay a thin consumer; per-call resolution gets the same order-independence without one, because the call is exactly when the guard needs the service.

**Failing closed when the service is absent** — denying every call is safer in the worst case, but it turns a composition without an engine row from the documented loose state into a configuration bug that locks the agent out of every tool. Absence stays the documented way to keep a scope unguarded.

## Consequences

- Order independence: the guard is correct under any row activation order. A unit test mounts the guard before the engine and asserts the matching call is allowed until the engine appears, then denied after.
- The first evaluated call pays rule compilation and the diagnostic logging; later calls reuse the compiled policy.
- A dropped deny is visible in the scope's log stream at first use. The level mapping couples the guard to the engine's diagnostic prefix — a contract internal to the same package family, with the prefix format owned by the engine's `compile` contract.
- The loose semantics are load-bearing: a composition that carries the guard row but no engine row runs its tools unguarded, and the composition test asserts that state instead of an error.

## Related

- The [permission seam and MCP fusion](../../proposed/architecture/2026-08-15-permission-seam-and-mcp-fusion.md) proposal owns the wider seam — the guard row, the team plugin's leader-rendezvous `ask` route, and the MCP tool-name merge — while this note owns the guard's service-resolution timing.
- The guard's README documents the per-call resolution, the diagnostic logging, and the `pathBases` config field.
