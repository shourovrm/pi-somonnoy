# pi-somonnoy

Multi-agent orchestration for pi. One command → gated pipeline: PRD → Brainstorm → Design → Plan → Implement → Review.

## Install

```bash
pi install git:github.com/shourovrm/pi-somonnoy
```

Quick test: `pi -e ./index.ts`

## Use

```
/somonnoy "build a REST API with JWT auth, SQLite, and React frontend"
```

Pipeline runs async. Progress shown in TUI widget below editor. Output: `PRD.md`, `DESIGN.md`, `DIAGRAM.md`, `PLAN.md`, `STATUS.md`, `SOMONNOY_SUMMARY.md`.

## Commands

| Command | Does |
|---------|------|
| `/somonnoy <desc>` | Start pipeline |
| `/somonnoy-dashboard` | TUI dashboard overlay |
| `/somonnoy-stop` | Kill active pipeline |

## Agents

9 specialized sub-agents, each an isolated pi process:

| Agent | Job | Tools |
|-------|-----|-------|
| smn-Orchestrator | Delegation, STATUS.md | read, write, bash |
| smn-Planner | PRD, design, plan, MEMORY.md | read, write, bash, grep, find |
| smn-Scout | Web/docs research (on-demand) | read, write, bash, web_search, web_fetch |
| smn-Coder | One file per invocation | read, write, edit, bash, grep |
| smn-Integrator | Assemble tier, build check | read, write, bash, grep, find |
| smn-Reviewer | Code review, structured report | read, write, bash, grep |
| smn-Tester | Write + run tests | read, write, edit, bash, grep |
| smn-Frontend | UI tasks, Playwright verify | read, write, edit, bash, grep |
| smn-Security | Semgrep, Trufflehog, auth scan | read, bash, grep |

## Pipeline Flow

```
/somonnoy
  ├─ smn-Planner → PRD.md, DESIGN.md, DIAGRAM.md, PLAN.md
  ├─ Per tier:
  │   ├─ smn-Coders (parallel) → coder_outputs/*.tmp
  │   ├─ smn-Integrator → src/<tier>/
  │   ├─ smn-Reviewer → reports/reviewer-<tier>.json
  │   └─ smn-Tester → reports/tester-<tier>.json
  └─ SOMONNOY_SUMMARY.md
```

## Design

- **Isolated subprocesses** — `pi --mode json`, same pattern as built-in subagent
- **Single-writer per file** — STATUS.md (smn-Orchestrator), MEMORY.md (smn-Planner), tier output (smn-Integrator)
- **Capability flags** — MCP/binary availability checked at spawn, agents degrade gracefully
- **MEMORY.md filtering** — Lessons tagged `[coder]`, `[reviewer]`, etc.; injected per-agent
- **Escalation** — Human prompted with options after 3+ replan failures per tier

## Config

Edit `index.ts`: `DEFAULT_MODEL`, per-agent `timeout`, `tools`, `skills`.
Edit `skills/somonnoy-<agent>/SKILL.md` to customize agent prompts.

## Files

```
pi-somonnoy/
├── index.ts              Extension core
├── package.json          Pi manifest
├── skills/               9 agent SKILL.md files
├── prompt.md             Full spec (revised)
├── prompt.original.md    Original spec backup
├── STATUS.md             Project status
├── MEMORY.md             Architecture + gotchas
└── README.md
```

## License

MIT
