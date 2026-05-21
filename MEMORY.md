# Project Memory — pi-somonnoy

## Overview
Multi-agent coding orchestration extension for pi. Gated pipeline: PRD→Brainstorm→Design→Plan→Implement→Review. 9 agent types spawned as isolated pi subprocesses via `pi --mode json`.

## Key Architecture Decisions

### Agent spawning: subprocess, not SDK
Chose `pi --mode json -p --no-session` over SDK `createAgentSession` because:
- No session conflict with parent process
- Process-level isolation (one crash doesn't take down orchestrator)
- Same pattern as pi's built-in `subagent` extension
- Simpler auth/model reuse (inherits parent env)

### Extension + skills, not multi-extension
Single `index.ts` + `skills/` directory. Keeps agent behavior separate from orchestration mechanics. Skills injected as system prompt via `--append-system-prompt`.

### Single-writer file coordination
Each shared file has exactly one writing agent:
- STATUS.md → only extension (via updateDashboard)
- MEMORY.md → only smn-Planner agent
- Tier output → only smn-Integrator
- Reports → each smn-Reviewer/smn-Tester writes own file
No file locking needed.

### Capability flags at spawn time
Extension checks MCP/binary availability once per agent spawn, passes `## Available Capabilities` block in system prompt. Agent SKILL.md has degradation instructions. Flags: sequential_thinking_mcp, playwright_mcp, brave_search_skill, context7_mcp, semgrep_binary, trufflehog_binary.

## Current State
- **Done:** Extension code, all 9 SKILL.md files, package.json, prompt.md (revised), STATUS.md, per-agent model routing
- **Pending:** Integration testing, plan parsing validation, caveman compression of skills
- **Phase:** Core built + bugfixes, ready for end-to-end test

## Gotchas

### `__dirname` in tsx ESM is `.` (not extension dir)
Fixed: use `path.dirname(fileURLToPath(import.meta.url))` → `EXT_DIR`. All skill/file path resolution uses `EXT_DIR` instead of `__dirname`. Without this fix, skills silently fail to load (catch returns empty string).

### Model IDs need provider prefix (`opencode-go/`)
`pi --model` expects `provider/model-id`. Bare names like `glm-5.1` resolve to wrong provider (`opencode` instead of `opencode-go`) → API key missing → crash. All `AGENT_MODELS` and `DEFAULT_MODEL` use full `opencode-go/*` format.

### `totalAgents` must be initialized before first agent runs
Previously `totalAgents: 0` at init. After Phase 1 PRD, `completedAgents: 1` with `totalAgents: 0` → shows "1/0" progress. Fix: initialize to `3` (PRD + Design + Plan phases), update after tier parsing.

### TUI dashboard overlay blocks chat view
`SomonnoyDashboard` class with `ctx.ui.custom()` created a full-screen overlay that hid model thinking and chat output. Removed. Progress now shown via `ctx.ui.setWidget()` (below editor) + `ctx.ui.notify()` toasts. `/somonnoy-dashboard` outputs markdown text to chat. Matches superpowers-plus pattern.

### `checkBinary()` is optimistic
Spawns `which` but doesn't wait for exit code. Returns true if spawn doesn't throw. Fast enough for capability check but not rigorous. Acceptable — capability flags are informational, agents degrade gracefully anyway.

### `parseTiersFromPlan()` regex is fragile
Expects `## Tier: name` and `- **File:** \`path\` - desc` format. If smn-Planner outputs different format, parsing breaks and no tiers run. Need to validate against real smn-Planner output or make parsing more flexible.

### `runOrchestrator` (smn-orchestrator) is fire-and-forget
`/somonnoy` command returns immediately, pipeline runs async. Status tracked via widget + STATUS.md. If user navigates away or session ends, pipeline keeps running but dashboard disconnects. State restored on session resume via `session_start` handler.

### Model locked to claude-sonnet-4-5 default
`DEFAULT_MODEL` hardcoded. Should use parent session's model or be configurable. Currently falls back to hardcoded if `ctx.model` undefined.

### Missing spawn tools
`somonnoy_spawn_frontend` and `somonnoy_spawn_security` not yet registered as tools. Pipeline uses them indirectly through tier flow but LLM can't call them directly.

### smn-Frontend agent auto-routing
smn-Coding phase detects UI files via `isUiFilePath()` — checks file extension (.tsx, .jsx, .css, .vue, .svelte, etc.) and path patterns (components/, pages/, views/, layouts/). UI files routed to `spawnPiAgent("smn-frontend", ...)` instead of `"smn-coder"`. Agent type updated in `agent.agent` for correct STATUS.md display. smn-Integrator's file list updated to include both coder + frontend outputs.

### smn-Security agent in pipeline
smn-Security scan runs after integration, before review (read-only phase). Spawns `"smn-security"` agent per tier. Tier status set to `"scanning"` during this phase. Added to `TierState` union type. Runs Semgrep + Trufflehog if binaries available; gracefully skips if not.

### Agent research: context7, not web_search and not callback
Subprocess agents can't call custom tools (somonnoy_spawn_scout) — only pi-native tools work with `--tools` flag. smn-Coder + frontend get `context7_get_library_docs` (curated library docs, not open web). smn-smn-Scout stays specialized for smn-orchestrator use when MCP-powered research needed. Pre-fetch pattern implemented: `scanForDependencies()` scans task descriptions for "uses X", "integrate with Y", imports — spawns smn-scout before coding phase, injects structured findings (trimmed to 3000 chars) into each agent's task prompt under `## Research Context`. smn-smn-Scout failure is non-fatal — agents proceed with training knowledge only.

### Git auto-commit per tier (Point D gate)
After both smn-Reviewer and smn-Tester pass for a tier, extension runs:
```
git add . && git commit -m "feat(<tier-slug>): implement <tier> tier"
```
- Uses `execSync` with 10s timeout, `|| true` semantics (commit failure is non-fatal)
- Tier name slugified for conventional commit scope
- Gate: review pass AND test pass — safest commit point, no untested code committed
- No planning-phase commit (PRD/DESIGN/PLAN artifacts committed with first tier or at pipeline end)
- No branch management or tagging — that belongs in a wrapper/CI layer, not in the pipeline

## Open Questions
- Should planning artifacts get their own commit before implementation starts?
- Should MEMORY.md rolling window be configurable? (currently 10 entries)
- Should agent timeouts be configurable per project?
- How to handle tier-level frontend tasks (integrated into smn-Coder or separate smn-Frontend agent)?
- Should pipeline support parallel tiers (independent modules)?

## Model Routing (2026-05-21)
Per-agent model selection via `AGENT_MODELS` map. `spawnPiAgent()` resolves `AGENT_MODELS[agentType]` with fallback to `DEFAULT_MODEL` (orchestrator model).

| Agent | Model | Rationale |
|-------|-------|----------|
| smn-planner | glm-5.1 | Structured docs, strong agentic reasoning |
| smn-integrator | glm-5.1 | Assembly + dedup, same reasoning needs |
| smn-security | glm-5.1 | Pattern matching + auth logic review |
| smn-coder | qwen3.6-plus | 1M context, strong code gen, explicit CoT |
| smn-tester | qwen3.6-plus | Same reasoning strength, needs code understanding |
| smn-frontend | kimi-k2.6 | UI/visual tasks, 262K context sufficient |
| smn-reviewer | kimi-k2.6 | Critical analysis, contract checking |
| smn-scout | deepseek-v4-flash | Fast + cheap research, no deep reasoning needed |
| smn-orchestrator | deepseek-v4-pro | Pipeline coordination (DEFAULT_MODEL fallback) |

**Cost rationale:** Planner/Integrator/Security use glm-5.1 (free/cheap). Coder/Tester use qwen3.6-plus ($1.95/M output). Scout uses flash ($0.28/M output). Only orchestrator uses pro. Balances quality vs cost across 8+ agent invocations per tier.
