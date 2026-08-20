# Agent Note: Shipped `team` Preset and the Two Team Mount Surfaces

Status: implemented

English | [中文](2026-08-19-shipped-team-preset.zh.md)

## Problem

The agent-team packages shipped only as the opt-in `dsh-bundle-team` host patch. No shipped mount point existed: the web and headless profile templates compose without the team rows, the shipped agent-preset roster (`apps/cli/config/agent-presets/`) had no team entry, and the 2026-08-18 audit recorded the gap (S11). A user of a standard deployment could reach team mode only by hand-authoring a preset under `$DSH_HOME/.agent-presets/`.

## Decision

Round 3 decision D6 settled the plane: team mode ships as a **preset**, not a profile template, and the bundle stays the opt-in host-plane entry.

- New shipped preset `apps/cli/config/agent-presets/team/`: a near-copy of `standard` whose persona names the root agent the team leader, plus an `agent team` group at the end. The group carries an `isolate` realm (`team`, `teamControl`) holding the provider rows and every consumer, so the standing mount owns one registry and coordinator that all sessions on the preset share by scope parentage. The `subagents` registry the teammates run on stays host-side and is resolved with `ctx.get`, exactly as the preset's delegation group does.
- Roster order: `team` declares `order: 2` in the shipped set (standard, team, code, minimal, cordis), so the full agents read first and the later slots shift by one.
- The Web picker's built-in copy table (`dsh-client-ui-agent-preset` locales) gained `presetTeamName`/`presetTeamDescription`; the Chinese copy mirrors the preset's `preset.yml`.
- `dsh-bundle-team` is behaviorally unchanged; its README now names both surfaces and why a deployment picks one.

The development instance's user-authored preset under `C:\Users\user\.dsh-dev\.agent-presets\team\` is the verified composition this file is based on.

## Alternatives considered

- **Team rows in `PROFILE_TEMPLATES` (host-plane profile bundles)**: rejected. The template surface publishes into the root realm: an un-realm-ed preset mount would register the same service name a second time there and throw, and a realm-ed one would run two divergent registries — host readers resolving the profile's while the preset's agent resolves its own. The team services have no consumer outside the agent plane, so the preset realm is the right owner, and `PROFILE_TEMPLATES` is untouched.
- **Ordering `team` after `cordis`**: rejected in favor of reading the shipped set by capability; `team` is a full agent like `standard`, so it sorts beside it.

## Consequences

- Team mode is one preset pick away in every standard deployment. The roster, plane-separation, and mount tests pin it: `web-agent-presets.e2e.ts` asserts the exact team tool catalog and that `team`/`teamControl` stay invisible to the host, and `verify-cordis-config` checks the preset rows against the host composition.
- The web and headless profile compositions are unchanged; the bundle remains the host-plane entry for custom profiles that compose no preset roster.
- A deployment that installs both surfaces runs two independent registries (host root realm and preset realm); the preset's agent resolves its own and the host rows stay inert.
