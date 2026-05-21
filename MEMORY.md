# Project Memory — pi-somonnoy

## Overview
Multi-agent coding orchestration extension for pi. LLM-orchestrated: the LLM calls somonnoy_spawn_* tools, sees results in chat, decides next step. 9 agent types spawned as isolated pi subprocesses via `pi --mode json`.

## Architecture Evolution

### v1 → v2: Hard-coded pipeline → LLM-orchestrated tools
v1 had `runOrchestrator()` — a hard-coded JS function that ran the entire pipeline in the background. Problems:
- No chat visibility (agents ran silently)
- Dashboard overlay blocked TUI
- LLM couldn't see or influence the pipeline
- `/somonnoy` command bypassed the LLM entirely

v2: Remove `runOrchestrator()`, `/somonnoy` command, dashboard overlay. Keep only tools. LLM calls tools directly, results appear in chat. LLM is the orchestrator.

## Key Architecture Decisions

### LLM is the orchestrator (v2)
No `smn-orchestrator` agent spawned. The LLM that the user is chatting with IS the orchestrator. It calls `somonnoy_propose` for pipeline instructions, then `somonnoy_spawn_planner`, `somonnoy_spawn_coder`, etc. in order.

### Agent spawning: subprocess, not SDK
`pi --mode json -p --no-session` for process-level isolation. Same pattern as superpowers-plus subagent.

### Single extension, skills in directory
`EXT_DIR/skills/somonnoy-<agent>/SKILL.md`. Skill content injected as system prompt via `--append-system-prompt`.

### Per-agent model selection
`AGENT_MODELS` map resolves `AGENT_MODELS[agentType]` with fallback to `DEFAULT_MODEL`. All models provider-prefixed (`opencode-go/`).

## Model Routing

| Agent | Model | Rationale |
|-------|-------|----------|
| smn-planner | opencode-go/glm-5.1 | Structured docs, agentic reasoning |
| smn-integrator | opencode-go/glm-5.1 | Assembly + dedup |
| smn-security | opencode-go/glm-5.1 | Pattern matching + auth review |
| smn-coder | opencode-go/qwen3.6-plus | 1M context, strong code gen |
| smn-tester | opencode-go/qwen3.6-plus | Code understanding + test frameworks |
| smn-frontend | opencode-go/kimi-k2.6 | UI/visual tasks |
| smn-reviewer | opencode-go/kimi-k2.6 | Critical analysis |
| smn-scout | opencode-go/deepseek-v4-flash | Fast + cheap research |
| (orchestrator) | opencode-go/deepseek-v4-pro | DEFAULT_MODEL fallback |

## Gotchas

### `__dirname` in tsx ESM is `.` (not extension dir)
Fix: `EXT_DIR = path.dirname(fileURLToPath(import.meta.url))`. All skill path resolution uses `EXT_DIR`.

### Model IDs need provider prefix (`opencode-go/`)
`pi --model` expects `provider/model-id`. Bare names like `glm-5.1` resolve to wrong provider → API key missing → crash.

### `checkBinary()` is optimistic
Spawns `which` but doesn't wait for exit code. Returns true if spawn doesn't throw. Acceptable — capability flags are informational, agents degrade gracefully.

### Subprocess agents can't call custom tools
`pi --tools` only enables built-in tools. Extension tools (somonnoy_spawn_*) aren't available in subprocesses. This is why the LLM (parent session) orchestrates — it CAN call extension tools.

### smn-Orchestrator skill is reference-only
`skills/somonnoy-orchestrator/SKILL.md` exists but no `smn-orchestrator` agent is spawned. The LLM is the orchestrator. The skill file is kept as documentation.
