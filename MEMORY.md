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
- MEMORY.md → only Planner agent
- Tier output → only Integrator
- Reports → each Reviewer/Tester writes own file
No file locking needed.

### Capability flags at spawn time
Extension checks MCP/binary availability once per agent spawn, passes `## Available Capabilities` block in system prompt. Agent SKILL.md has degradation instructions. Flags: sequential_thinking_mcp, playwright_mcp, brave_search_skill, context7_mcp, semgrep_binary, trufflehog_binary.

## Current State
- **Done:** Extension code, all 9 SKILL.md files, package.json, prompt.md (revised), STATUS.md
- **Pending:** Integration testing, frontend/security spawn tools, plan parsing validation, caveman compression of skills
- **Phase:** Core built, needs end-to-end test

## Gotchas

### `checkBinary()` is optimistic
Spawns `which` but doesn't wait for exit code. Returns true if spawn doesn't throw. Fast enough for capability check but not rigorous. Acceptable — capability flags are informational, agents degrade gracefully anyway.

### `parseTiersFromPlan()` regex is fragile
Expects `## Tier: name` and `- **File:** \`path\` - desc` format. If Planner outputs different format, parsing breaks and no tiers run. Need to validate against real Planner output or make parsing more flexible.

### `runOrchestrator` is fire-and-forget
`/somonnoy` command returns immediately, pipeline runs async. Status tracked via widget + STATUS.md. If user navigates away or session ends, pipeline keeps running but dashboard disconnects. State restored on session resume via `session_start` handler.

### Model locked to claude-sonnet-4-5 default
`DEFAULT_MODEL` hardcoded. Should use parent session's model or be configurable. Currently falls back to hardcoded if `ctx.model` undefined.

### Missing spawn tools
`somonnoy_spawn_frontend` and `somonnoy_spawn_security` not yet registered as tools. Pipeline uses them indirectly through tier flow but LLM can't call them directly.

### Git auto-commit per tier (Point D gate)
After both Reviewer and Tester pass for a tier, extension runs:
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
- How to handle tier-level frontend tasks (integrated into Coder or separate Frontend agent)?
- Should pipeline support parallel tiers (independent modules)?
