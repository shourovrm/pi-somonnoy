# pi-somonnoy — Project Status

**Phase:** Per-agent model selection added  |  **Date:** 2026-05-21

## Components

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| Extension core | `index.ts` (~1030L) | ✅ Done | Commands, tools, spawner, dashboard, lifecycle, git auto-commit, per-agent model selection, ESM skill path fix, provider-prefixed model IDs |
| Package manifest | `package.json` | ✅ Done | Pi package metadata |
| Spec (revised) | `prompt.md` | ✅ Done | 11 loopholes addressed, pi-native rewrite |
| Original spec backup | `prompt.original.md` | ✅ Done | For reference |
| smn-Orchestrator skill | `skills/somonnoy-orchestrator/SKILL.md` | ✅ Done | 33 lines, caps flag + constraints |
| smn-Planner skill | `skills/somonnoy-planner/SKILL.md` | ✅ Done | 41 lines, MEMORY.md format, degradation |
| smn-Scout skill | `skills/somonnoy-scout/SKILL.md` | ✅ Done | 26 lines, degradation paths |
| smn-Coder skill | `skills/somonnoy-coder/SKILL.md` | ✅ Done | 26 lines, KISS + Unix standards, context7 access |
| smn-Integrator skill | `skills/somonnoy-integrator/SKILL.md` | ✅ Done | 25 lines, single-writer pattern |
| smn-Reviewer skill | `skills/somonnoy-reviewer/SKILL.md` | ✅ Done | 33 lines, JSON report format |
| smn-Tester skill | `skills/somonnoy-tester/SKILL.md` | ✅ Done | 35 lines, JSON report format |
| smn-Frontend skill | `skills/somonnoy-frontend/SKILL.md` | ✅ Done | 25 lines, Playwright degradation, wired into pipeline, context7 access |
| smn-Security skill | `skills/somonnoy-security/SKILL.md` | ✅ Done | 33 lines, Semgrep/Trufflehog degradation, wired into pipeline |
| MEMORY.md | `MEMORY.md` | ✅ Updated | Architecture decisions + gotchas + git strategy + model routing |

## Commands

| Command | Status |
|---------|--------|
| `/somonnoy` | ✅ Registered |
| `/somonnoy-dashboard` | ✅ Registered |
| `/somonnoy-stop` | ✅ Registered |

## Tools

| Tool | Status |
|------|--------|
| `somonnoy_propose` | ✅ Registered |
| `somonnoy_spawn_planner` | ✅ Registered |
| `somonnoy_spawn_scout` | ✅ Registered |
| `somonnoy_spawn_coder` | ✅ Registered |
| `somonnoy_spawn_reviewer` | ✅ Registered |
| `somonnoy_spawn_frontend` | ✅ Registered |
| `somonnoy_spawn_security` | ✅ Registered |
| `somonnoy_spawn_tester` | ✅ Registered |

## Pending / TODO

- [x] Tier-level auto-commit (post review+test gate)
- [x] Register somonnoy_spawn_frontend + somonnoy_spawn_security tools
- [x] Wire frontend agent into pipeline (UI file detection → route to frontend)
- [x] Wire security agent into pipeline (scanning phase after integration)
- [x] Give coder + frontend context7_get_library_docs (curated docs, no open web)
- [x] Pre-fetch research: scanForDependencies() → spawn scout → inject into agent prompts
- [x] Per-agent model selection (AGENT_MODELS map, model override in spawnPiAgent)
- [x] Fix: ESM `__dirname` → `EXT_DIR` via `fileURLToPath(import.meta.url)` — skills now load correctly
- [x] Fix: Model IDs prefixed with `opencode-go/` — bare names caused wrong provider → API key missing crash
- [ ] Integration test: run `/somonnoy "build a simple CLI tool"` end-to-end
- [ ] Verify prompt.md → SKILL.md transfer completeness
- [ ] Test MCP capability flag detection (sequential-thinking, playwright, context7)
- [ ] Test graceful degradation when tools missing
- [ ] Test dashboard widget rendering with real agent runs
- [ ] Test escalation prompt when replan fails 3x
- [ ] Test MEMORY.md filtering by agent tag
- [ ] Test plan parsing (parseTiersFromPlan) with real smn-Planner output
- [ ] Write caveman-compressed versions of all SKILL.md files
- [ ] Add `agents/` directory with agent definitions (currently inline)
