Build a multi-agent coding orchestration system with the following agents, behaviors, and constraints.

## Planning Philosophy
Before any implementation begins, the system enforces a mandatory progression:
PRD → Brainstorm → Design → Plan → Implement → Review.

Each phase gates the next. No code is written until a PRD exists and a design has been presented and approved.

**PRD phase:** For every project, a Product Requirements Document is written first, covering goals, scope, constraints, user flows, and success criteria. All subsequent planning derives from the PRD.

**Brainstorming phase:** The **smn-Planner** conducts a structured Socratic dialogue — reads the codebase, asks targeted clarifying questions (not generic ones), explores options and tradeoffs, and surfaces edge cases before committing to a direction. Output is a design document, not code. No implementation begins until design is approved.

**Planning phase:** The approved design converts into a multi-level implementation plan: overall architecture → module-level sub-plans → coding-level task specs. Each task is scoped to a single file with exact file path, interface contract, and verification criteria. No TBD sections permitted — all gaps resolved before planning closes.

## Agents

**smn-Orchestrator**** — top-level controller. Delegates to **smn-Planner**. Receives tier reports. Makes replanning decisions based on suggested_action hints from **smn-Reviewer**/**smn-Tester**. Maintains STATUS.md (live project state: tiers complete/in-progress/failed/blocked, updated after every **smn-Integrator** report). Escalates to human only if replanning fails repeatedly. Never writes source code. Tools: read, write, bash.

**smn-Planner**** — enforces PRD→Brainstorm→Design→Plan progression. Produces: (1) PRD, (2) design document (approved before proceeding), (3) full Mermaid diagram of entire pipeline, (4) per-tier contract files (JSON: tier name, receives_from, produces_for, checklist, diagram_ref), (5) coding-level task specs. Selects fastest commonly-used algorithms at spec stage. Identifies reusable modules to avoid duplication. No TBD sections in any output. Maintains MEMORY.md (caveman-compressed lessons learned from past failures; injected per-agent filtered by relevance). Tools: read, write, bash. Skill: Sequential Thinking.

**smn-Scout**** — stateless, on-demand only. Invoked as subprocess by any agent needing external information (library docs, CVE data, API references, research). Searches, writes structured result file, exits. No other agent carries search tools. Tools: read, write, bash. Skills: Brave Search, Context7.

**smn-Coder**** — leaf agent, stateless, one file per invocation, spawned fresh per task, parallelizable. Strictly follows:
- Unix philosophy: one file, one job, done well
- KISS: no over-engineering, no premature abstraction
- Lean code: no unnecessary complexity
- Standard reusable templates: prefer established patterns over custom solutions
- Maximum code reuse: check existing modules before writing new ones
- Intuitive naming: clear and descriptive, never bloated or abbreviated to obscurity
- Fastest commonly-used algorithms as specified in task spec
Runs compile/lint check after writing. Tools: read, write, edit, bash. No skills.

**smn-Integrator**** — one per tier. Consumes its scoped contract file (not the full diagram). Assembles **smn-Coder** outputs. Runs git diff and build check. Flags code duplication across assembled files. Ticks checklist. Writes status report upward. Tools: read, write, bash. No skills.

**smn-Reviewer**** — checks integrated tier output. Enforces: interface contracts, error handling, KISS compliance, algorithm efficiency, naming conventions, code reuse (no redundant implementations). Runs static analysis. Produces structured findings report:
```json
{
  "agent": "reviewer",
  "tier": "module-name",
  "status": "failed",
  "exit_reason": "interface_violation",
  "findings": ["description"],
  "severity": "blocking",
  "affected_files": ["src/path/file.ts"],
  "suggested_action": "replan:coder:taskName"
}
```
suggested_action is a hint only — **smn-Planner**/**smn-Orchestrator** decides. Never modifies source. Tools: read, write, bash.

**smn-Tester**** — writes and runs tests per tier. Produces structured result file:
```json
{
  "agent": "tester",
  "tier": "module-name",
  "status": "failed",
  "exit_reason": "assertion_error",
  "failed_tests": ["test description"],
  "tool_trace": ["run:test:file.test.ts"],
  "affected_files": ["src/path/file.ts"],
  "suggested_action": "replan:coder:taskName"
}
```
suggested_action is a hint only. Tools: read, write, edit, bash. No skills.

**smn-Frontend Designer**** — handles UI tasks at relevant tiers only. Produces interfaces that are slick, fast, and intuitive — prioritizes perceived performance, minimal cognitive load, clean visual hierarchy. Takes headless screenshot to verify render before reporting. Tools: read, write, edit, bash. Skill: Playwright.

**smn-Security Agent**** — runs at key tier boundaries. Scans for vulnerabilities, auth flaws, exposed secrets. Read-only on source — produces findings report only, never modifies code. Tools: read, bash. Skills: Semgrep, Trufflehog.

## Shared State (filesystem)
- PRD, design doc, Mermaid diagram, task specs → flow downward
- Structured report/result files → flow upward through tiers
- STATUS.md — maintained by **smn-Orchestrator**, live pipeline state
- MEMORY.md — maintained by **smn-Planner**, caveman-compressed lessons learned, injected per-agent filtered by relevance
- AGENTS.md — directory-scoped context files, discovered via filesystem reads on demand, never preloaded globally
- Per-tier contract files — produced by **smn-Planner**, consumed by **smn-Integrator**s (scoped slice only)

## System-wide Coding Standards (enforced by **smn-Coder** + **smn-Reviewer**)
- Unix philosophy: one task, one file, done well
- KISS: no over-engineering, no premature abstraction
- Standard templates and maximum code reuse; **smn-Planner** identifies reusable modules; **smn-Integrator** flags duplication
- Frontend: slick, fast, intuitive
- Algorithms: fastest commonly-used; chosen at planning stage, enforced at review
- Naming: intuitive and descriptive, never bloated or cryptically abbreviated

## Token Efficiency
- Caveman compression on all inter-tier reports going upward
- Each agent loads only its own relevant skills
- AGENTS.md discovered via tool results, not preloaded
- Prompt caching for parallel leaf agents with identical system prompts
- SKILL.md files pre-compressed with caveman-compress at authoring time

## Failure Handling
- **smn-Reviewer** and **smn-Tester** produce structured failure metadata with suggested_action hint
- Failure metadata references contract file node IDs for precise replanning location
- **smn-Orchestrator**/**smn-Planner** validates suggested_action before acting — agents never self-trigger replanning
- **smn-Orchestrator** escalates to human only if replanning fails repeatedly

Build each agent as a separate, self-contained unit with its own system prompt, tool list, and skill set as specified. The system is harness-agnostic — no framework dependency assumed.

Based on the architecture and what each agent actually needs, following tools are for them:

| Agent | Native Tools | Skills/External |
|---|---|---|
| **smn-Orchestrator**** | read, write, bash | — |
| **smn-Planner**** | read, write, bash | Sequential Thinking MCP |
| **smn-Scout**** | read, write, bash | WEb Search, Context7 MCP |
| **smn-Coder**** | read, write, edit, bash | — |
| **smn-Integrator**** | read, write, bash | — |
| **smn-Reviewer**** | read, write, bash | — |
| **smn-Tester**** | read, write, edit, bash | — |
| **smn-Frontend Designer**** | read, write, edit, bash | Playwright MCP |
| **smn-Security Agent**** | read, bash | Semgrep (bash-invoked), Trufflehog (bash-invoked) |

**Notes:**
- **smn-Reviewer** and **smn-Tester** deliberately have no external skills — if they need library context, they invoke **smn-Scout**.
- **smn-Orchestrator**'s bash covers subprocess invocation of all other agents — that's its primary power tool.
- **smn-Frontend Designer**'s Playwright is the only MCP addition beyond **smn-Scout**'s search tools — justified because visual verification can't be done via bash alone.
- edit is absent from **smn-Orchestrator**, **smn-Planner**, **smn-Integrator**, **smn-Reviewer**, Security — none of them should touch source code directly.

## Tool & Skill Availability Policy
Each agent will attempt to locate and use its assigned external skills and MCP tools at startup. If any external tool is unavailable, the agent continues operating without it — degraded but functional. Specifically:

- **smn-Scout**: if Brave Search unavailable, falls back to available search method or flags to **smn-Orchestrator** that external search is offline. If Context7 unavailable, works from training knowledge and flags potential staleness.
- **smn-Planner**: if Sequential Thinking MCP unavailable, performs explicit step-by-step reasoning natively in its output before committing to any plan.
- **smn-Frontend Designer**: if Playwright unavailable, skips visual verification step and notes in report that render was not verified.
- **smn-Security Agent**: invokes Semgrep and Trufflehog via bash. If either binary is not found on PATH, skips that scan and flags the gap explicitly in the findings report. Never silently omits a scan.
- All agents: external tool availability is checked once at task start, not repeatedly during execution. Unavailability is logged in the agent's output report so the **smn-Orchestrator** maintains accurate STATUS.md.

No agent should halt or error out due to a missing external tool. Degradation is always explicit and reported — never silent.
