# pi-somonnoy — Project Status

**Phase:** LLM-orchestrated tools (Option 1)  |  **Date:** 2026-05-21

## Architecture Change

Moved from hard-coded `runOrchestrator()` pipeline to **LLM-orchestrated tool calls**. The LLM calls `somonnoy_spawn_*` tools directly, sees results in chat, decides next step. No background pipeline, no dashboard overlay, no commands.

**Before:** `/somonnoy "build X"` → hard-coded JS pipeline → silent background → dashboard overlay
**After:** LLM calls tools → results in chat → LLM decides next step → normal extension flow

## Components

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| Extension core | `index.ts` (~480L) | ✅ Done | 9 tools, spawner, skill loader, model routing |
| Package manifest | `package.json` | ✅ Done | Pi package metadata |
| Spec (revised) | `prompt.md` | ✅ Done | 11 loopholes addressed |
| smn-Planner skill | `skills/somonnoy-planner/SKILL.md` | ✅ Done | 41 lines |
| smn-Scout skill | `skills/somonnoy-scout/SKILL.md` | ✅ Done | 26 lines |
| smn-Coder skill | `skills/somonnoy-coder/SKILL.md` | ✅ Done | 26 lines |
| smn-Integrator skill | `skills/somonnoy-integrator/SKILL.md` | ✅ Done | 25 lines |
| smn-Reviewer skill | `skills/somonnoy-reviewer/SKILL.md` | ✅ Done | 33 lines |
| smn-Tester skill | `skills/somonnoy-tester/SKILL.md` | ✅ Done | 35 lines |
| smn-Frontend skill | `skills/somonnoy-frontend/SKILL.md` | ✅ Done | 25 lines |
| smn-Security skill | `skills/somonnoy-security/SKILL.md` | ✅ Done | 33 lines |
| smn-Orchestrator skill | `skills/somonnoy-orchestrator/SKILL.md` | ✅ Done | Reference only — LLM is the orchestrator |
| MEMORY.md | `MEMORY.md` | ✅ Updated | Architecture + model routing |

## Tools (9)

| Tool | Agent | Model | Purpose |
|------|-------|-------|---------|
| `somonnoy_propose` | — | — | Suggest pipeline + provide pipeline instructions |
| `somonnoy_spawn_planner` | smn-planner | opencode-go/glm-5.1 | PRD, design, plan |
| `somonnoy_spawn_scout` | smn-scout | opencode-go/deepseek-v4-flash | Web/docs research |
| `somonnoy_spawn_coder` | smn-coder | opencode-go/qwen3.6-plus | Single file implementation |
| `somonnoy_spawn_integrator` | smn-integrator | opencode-go/glm-5.1 | Assembly + build check |
| `somonnoy_spawn_reviewer` | smn-reviewer | opencode-go/kimi-k2.6 | Code review |
| `somonnoy_spawn_tester` | smn-tester | opencode-go/qwen3.6-plus | Write + run tests |
| `somonnoy_spawn_frontend` | smn-frontend | opencode-go/kimi-k2.6 | UI tasks |
| `somonnoy_spawn_security` | smn-security | opencode-go/glm-5.1 | Vulnerability scan |

## Removed

- `runOrchestrator()` hard-coded pipeline function
- `/somonnoy` command
- `/somonnoy-dashboard` command
- `/somonnoy-stop` command
- `SomonnoyDashboard` TUI overlay class
- `updateDashboard()`, `updateStatus()`, `clearDashboard()` widget functions
- `parseTiersFromPlan()` regex
- `scanForDependencies()` auto-scout
- `isUiFilePath()` auto-routing
- `commitTier()` auto-commit
- `SomonnoyState`, `TierState`, `AgentRunState` types
- All dashboard/widget state management

## Pending

- [ ] End-to-end test: ask LLM to build a project using somonnoy tools
- [ ] Verify planner output → LLM can parse tiers and call correct coders
- [ ] Test scout research integration
- [ ] Test security scan with/without Semgrep
- [ ] Write caveman-compressed versions of SKILL.md files
