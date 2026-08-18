# Agent Note: Plugin development guide in the workspace

Status: implemented

English | [中文](2026-08-14-plugin-development-guide-reference.zh.md)

## Problem

This workspace is dedicated to developing a family of DeepSeek Harness plugins. Onboarding plugin authors repeatedly re-derive the same facts from scattered sources: the plugin runtime-stability requirements, the standard plugin interface, and how to install, uninstall, activate, and disable plugins. There was no single place that collected these for a plugin author, and no persistent record of where such a guide lives.

## Decision

[`PLUGIN_DEV_GUIDE.md`](../../../../PLUGIN_DEV_GUIDE.md) is the workspace-root reference for plugin development. It records four sections in current-state prose: the stability/performance requirements dsh places on plugins, the standard plugin interface (function-plugin export shape and `cordis.yml` entry contract), and install/uninstall/activate/disable through `dsh plugin --profile` plus layered `cordis.patch.yml` composition, then a documentation index and a short development-workflow section. Every fact carries a relative markdown link to its authoritative home (`docs/architecture.md`, `docs/cordis-primer.md`, `docs/cordis-tutorial/`, `packages/boot/app-boot/README.md`, `docs/config-catalog.md`, `apps/cli/reference/README.md`, `docs/testing.md`, `packages/extensions/tool-cordis/README.md`, and the root/packages AGENTS.md files) so the guide stays a navigable map rather than a competing authority.

The guide is a pointer and orientation artifact, not a new source of truth. Its links, not its prose, are authoritative for exact contracts; the prose is kept deliberately thin to avoid duplicating the homes it links. The workspace memory pointer to the guide is this Agent Note (English `README.md`-linked decision record), which future plugin-development sessions can find through the `.agents/notes` tree.

## Alternatives considered

- **Write the summary into the existing `docs/` tree.** Rejected: the guide is an orientation summary for this workspace rather than canonical dsh documentation, and placing it in `docs/` would entangle it with the doc-tier and doc-budget gates. A workspace-root file keeps it clearly author-facing.
- **Persist only in `docs/` without an Agent Note.** Rejected: the request was explicitly to persist the file link in memory so future plugin-development sessions can find it; an Agent Note in `.agents/notes` is the repo's durable memory mechanism, and the guide root-links it mechanically.

## Consequences

- Plugin development has one stable entry point in the workspace plus a durable note that survives across sessions for future reference.
- The guide can drift from upstream docs if not maintained; because it only links (and briefly summarizes) each authoritative home, drift is bounded and `verify-md-links` enforces that its links resolve.
- The workspace now carries an extra root-level document; keeping it thin and link-based minimizes the tax on the documentation budget gates.
