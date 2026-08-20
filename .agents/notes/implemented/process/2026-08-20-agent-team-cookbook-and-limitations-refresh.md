# Agent Note: The agent team operations cookbook and the round-3 limitations refresh

Status: implemented

English | [中文](2026-08-20-agent-team-cookbook-and-limitations-refresh.zh.md)

## Problem

The agent team plugin gained its productized surfaces in the round 3 plan — the shipped team preset, the `dsh teammate` command family, the Web team panel, and permission-engine approval — but no document told an operator how to define a team, choose a mount, delegate work, and decide approval requests. The package READMEs own per-package contracts, the [Team subsystem page](../../../../docs/subsystems/team.md) owns the mechanism, and neither is a procedure. Meanwhile `packages/team/team/README.md` and `packages/team/team-runtime/README.md` still carried "conditional tool constraints deferred to Phase 4" limitation bullets, which the [confirmed round 3 plan](../../../../AGENT_TEAM_PLUGIN_ROUND3_PLAN.md) replaced with the permission seam Stage 1.

## Decision

- [`docs/cookbook/adding-agent-team.md`](../../../../docs/cookbook/adding-agent-team.md) (bilingual pair) is the procedural home for team operations: teammate definition authoring, mount selection (shipped preset by default per decision D6, bundle opt-in otherwise), delegation through the five leader tools, the permission rule layers (`deny > ask > allow`, `enforce`/`default` modes, absolute managed deny), and the approval flow over `team/control-request` / `team/control-decision`.
- The guide states the round 3 target state per the confirmed plan; mechanism detail stays linked, not restated — the subsystem page, the package READMEs, and the [permission seam proposal](../../proposed/architecture/2026-08-15-permission-seam-and-mcp-fusion.md) own their facts.
- The two "deferred to Phase 4" limitation bullets leave [dsh-team](../../../../packages/team/team/README.md) and [dsh-team-runtime](../../../../packages/team/team-runtime/README.md); both keep a remaining limitation (`maxContextTokens`, the `maxTokens` cold-resume fallback), so the `NO_LIMITATIONS` allowlist in `scripts/verify-package-readme-limitations.ts` is untouched. The M2/M3 code changes document their own behavior in the package READMEs as they land.

## Alternatives considered

**A section in the `packages/team/README.md` group README.** The group README owns the package table, the bundle pointer, and the composition quick start; a six-step operations tutorial would push it past its tier and duplicate the cookbook. Rejected.

**A `docs/user/` product guide.** The user tier is published by the documentation website and targets end users of the product as a whole; team operations is a developer/operator how-to, and the cookbook tier already hosts the parallel "adding a X" guides. Rejected.

**Keeping the limitation bullets until the M2/M3 code lands.** The round 3 plan was confirmed on 2026-08-19 with all decisions adopted; a bullet claiming the constraints stay deferred past Phase 4 is false once the plan replaced Phase 4 with the permission seam Stage 1. Rejected.

## Consequences

The cookbook states the round 3 target state before the batch B/C code lands; if the permission wiring diverges from the plan, the affected guide sections are corrected in the same change that diverges. The permission seam note stays `proposed` until the M4 acceptance advances it, and the cookbook links to it as the rule-language home. The guide is intentionally not added to `website/docs.ts`: it joins the cookbook siblings that remain repository documentation rather than site pages.
