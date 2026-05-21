# pi-somonnoy — Project Status

**Phase:** Extension built, ready for testing  |  **Date:** 2026-05-21

## Components

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| Extension core | `index.ts` (~900L) | ✅ Done | Commands, tools, spawner, dashboard, lifecycle, git auto-commit |
| Package manifest | `package.json` | ✅ Done | Pi package metadata |
| Spec (revised) | `prompt.md` | ✅ Done | 11 loopholes addressed, pi-native rewrite |
| Original spec backup | `prompt.original.md` | ✅ Done | For reference |
| Orchestrator skill | `skills/somonnoy-orchestrator/SKILL.md` | ✅ Done | 33 lines, caps flag + constraints |
| Planner skill | `skills/somonnoy-planner/SKILL.md` | ✅ Done | 41 lines, MEMORY.md format, degradation |
| Scout skill | `skills/somonnoy-scout/SKILL.md` | ✅ Done | 26 lines, degradation paths |
| Coder skill | `skills/somonnoy-coder/SKILL.md` | ✅ Done | 26 lines, KISS + Unix standards |
| Integrator skill | `skills/somonnoy-integrator/SKILL.md` | ✅ Done | 25 lines, single-writer pattern |
| Reviewer skill | `skills/somonnoy-reviewer/SKILL.md` | ✅ Done | 33 lines, JSON report format |
| Tester skill | `skills/somonnoy-tester/SKILL.md` | ✅ Done | 35 lines, JSON report format |
| Frontend skill | `skills/somonnoy-frontend/SKILL.md` | ✅ Done | 25 lines, Playwright degradation |
| Security skill | `skills/somonnoy-security/SKILL.md` | ✅ Done | 33 lines, Semgrep/Trufflehog degradation |
| MEMORY.md | `MEMORY.md` | ✅ Updated | Architecture decisions + gotchas + git strategy |

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
| `somonnoy_spawn_tester` | ✅ Registered |

## Pending / TODO

- [x] Tier-level auto-commit (post review+test gate)
- [ ] Integration test: run `/somonnoy "build a simple CLI tool"` end-to-end
- [ ] Verify prompt.md → SKILL.md transfer completeness
- [ ] Test MCP capability flag detection (sequential-thinking, playwright, context7)
- [ ] Test graceful degradation when tools missing
- [ ] Test dashboard widget rendering with real agent runs
- [ ] Test escalation prompt when replan fails 3x
- [ ] Test MEMORY.md filtering by agent tag
- [ ] Add `somonnoy_spawn_frontend` and `somonnoy_spawn_security` tools to index.ts
- [ ] Test plan parsing (parseTiersFromPlan) with real Planner output
- [ ] Install as pi package and verify /reload discovery
- [ ] Write caveman-compressed versions of all SKILL.md files
- [ ] Add `agents/` directory with agent definitions (currently inline)
