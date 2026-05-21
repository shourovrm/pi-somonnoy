# pi-somonnoy: Multi-Agent Coding Orchestration Extension for pi

A pi extension that implements a multi-agent orchestration system with gated workflow (PRD → Brainstorm → Design → Plan → Implement → Review). Spawns specialized sub-agents via pi's SDK (`AgentSession`), each with its own system prompt, tool set, and skill configuration.

## Extension Architecture

pi-somonnoy is a single pi extension with agent behavior defined in skill files:

```
pi-somonnoy/
├── index.ts                    ← Extension entry point
├── skills/                     ← Agent behavior definitions
│   ├── somonnoy-orchestrator/SKILL.md
│   ├── somonnoy-planner/SKILL.md
│   ├── somonnoy-scout/SKILL.md
│   ├── somonnoy-coder/SKILL.md
│   ├── somonnoy-integrator/SKILL.md
│   ├── somonnoy-reviewer/SKILL.md
│   ├── somonnoy-tester/SKILL.md
│   ├── somonnoy-frontend/SKILL.md
│   └── somonnoy-security/SKILL.md
├── package.json
└── README.md
```

**Extension (`index.ts`) responsibilities:**
- Registers `/somonnoy` slash command for explicit user invocation
- Registers `somonnoy_propose` tool so the LLM can suggest orchestration when it detects complex multi-file work
- Registers agent-spawning tools: `somonnoy_spawn_planner`, `somonnoy_spawn_coder`, `somonnoy_spawn_reviewer`, `somonnoy_spawn_tester`, `somonnoy_spawn_integrator`, `somonnoy_spawn_scout`, `somonnoy_spawn_frontend`, `somonnoy_spawn_security`
- Each spawn tool creates an in-memory `AgentSession` via pi's SDK with agent-specific system prompt (loaded from the corresponding SKILL.md), tool set, and skills
- Manages agent lifecycle: spawn, timeout (default 300s for Coder/Reviewer/Tester, 600s for Planner), collect structured output, dispose session
- Checks MCP server availability at spawn time, passes capability flags to agent prompt
- Enforces tier isolation + single-writer file coordination pattern
- Filters MEMORY.md lessons by agent role, injects into spawn-time system prompt
- Tracks agent states in STATUS.md (pending/running/done/failed/blocked)

**Agent SKILL.md files responsibilities:**
- Define agent behavior, constraints, and coding standards
- Declare required pi-native tools (read, write, edit, bash, grep, find, web_search, web_fetch, etc.)
- Declare required/optional MCP servers with graceful degradation instructions
- Declare required/optional pi skills (caveman, frontend-design, brainstorming, etc.)
- Specify output format (structured JSON report for Reviewer/Tester, code files for Coder, etc.)

## Invocation

**Manual:** User types `/somonnoy "build a todo app with React and TypeScript"` — extension spawns Orchestrator agent which drives the full pipeline.

**Auto-detection:** The `somonnoy_propose` tool is available to the main LLM. When the LLM detects a request requiring multi-file, multi-module implementation, it can call `somonnoy_propose` to suggest orchestration. The user confirms, and the pipeline starts.

## Planning Philosophy

Before any implementation begins, the system enforces a mandatory progression:
PRD → Brainstorm → Design → Plan → Implement → Review.

Each phase gates the next. No code is written until a PRD exists and a design has been presented and approved.

**PRD phase:** For every project, a Product Requirements Document is written first, covering goals, scope, constraints, user flows, and success criteria. All subsequent planning derives from the PRD.

**Brainstorming phase:** The Planner conducts a structured Socratic dialogue — reads the codebase, asks targeted clarifying questions (not generic ones), explores options and tradeoffs, and surfaces edge cases before committing to a direction. Output is a design document, not code. No implementation begins until design is approved.

**Planning phase:** The approved design converts into a multi-level implementation plan: overall architecture → module-level sub-plans → coding-level task specs. Each task is scoped to a single file with exact file path, interface contract, and verification criteria. No TBD sections permitted — all gaps resolved before planning closes.

## Agents

### Orchestrator
Top-level controller. Delegates to Planner. Receives tier reports. Makes replanning decisions based on `suggested_action` hints from Reviewer/Tester. Maintains STATUS.md (live project state: tiers complete/in-progress/failed/blocked, updated after every Integrator report). Never writes source code.

**Spawned by:** `/somonnoy` command handler or `somonnoy_propose` tool handler (runs in main session, not a subagent — the Orchestrator IS the extension's command handler context).

**Capabilities:** Uses extension-registered spawn tools (`somonnoy_spawn_*`) to create subagents. Reads/writes contract files and STATUS.md. Escalates to human when replanning fails repeatedly by injecting a displayed message with structured suggestions (retry / skip tier / replan / abort) and pausing for user choice.

**Escalation format:**
```
Replanning failed 3x for tier: [tier-name]
Last error: [error summary]
Options: [1] Retry with same plan  [2] Skip tier and continue  [3] Full replan  [4] Abort project
```

### Planner
Enforces PRD→Brainstorm→Design→Plan progression. Produces: (1) PRD, (2) design document (approved before proceeding), (3) full Mermaid diagram of entire pipeline, (4) per-tier contract files (JSON: tier name, receives_from, produces_for, checklist, diagram_ref), (5) coding-level task specs. Selects fastest commonly-used algorithms at spec stage. Identifies reusable modules to avoid duplication. No TBD sections in any output. Maintains MEMORY.md.

**Spawn tool:** `somonnoy_spawn_planner`
**Pi-native tools:** read, write, bash, grep, find
**Skills:** brainstorming (pi superpower)
**MCP:** sequential-thinking (optional — if unavailable, performs explicit step-by-step reasoning natively before committing to any plan)

### Scout
Stateless, on-demand only. Invoked by any agent needing external information (library docs, API references, research). Searches, writes structured result file, exits. No other agent carries search tools.

**Spawn tool:** `somonnoy_spawn_scout`
**Pi-native tools:** read, write, bash, web_search, web_fetch
**Skills:** brave-search
**MCP:** context7 (optional — if unavailable, works from training knowledge and flags potential staleness in result)

### Coder
Leaf agent, stateless, one file per invocation, spawned fresh per task, parallelizable. Strictly follows:
- Unix philosophy: one file, one job, done well
- KISS: no over-engineering, no premature abstraction
- Lean code: no unnecessary complexity
- Standard reusable templates: prefer established patterns over custom solutions
- Maximum code reuse: check existing modules before writing new ones
- Intuitive naming: clear and descriptive, never bloated or abbreviated to obscurity
- Fastest commonly-used algorithms as specified in task spec

Runs compile/lint check after writing. Writes output to `coder_outputs/<task-id>.tmp` (never directly to tier directory — Integrator assembles).

**Spawn tool:** `somonnoy_spawn_coder`
**Pi-native tools:** read, write, edit, bash, grep
**Skills:** none
**Timeout:** 300s default
**Parallelism:** Multiple Coders can run concurrently for independent files within a tier. All parallel Coders receive identical system prompt structure for consistency.

### Integrator
One per tier. Consumes its scoped contract file (not the full diagram). Reads all `coder_outputs/<task-id>.tmp` files for the tier, assembles into final tier directory. Runs git diff and build check. Flags code duplication across assembled files. Ticks checklist items from contract. Writes status report upward. Sole writer to tier output directory.

**Spawn tool:** `somonnoy_spawn_integrator`
**Pi-native tools:** read, write, bash, grep, find
**Skills:** none

### Reviewer
Checks integrated tier output. Enforces: interface contracts, error handling, KISS compliance, algorithm efficiency, naming conventions, code reuse (no redundant implementations). Runs static analysis. Produces structured findings report. Never modifies source.

**Spawn tool:** `somonnoy_spawn_reviewer`
**Pi-native tools:** read, write, bash, grep
**Skills:** caveman (for compressing report output)
**Output format:**
```json
{
  "agent": "reviewer",
  "tier": "module-name",
  "status": "pass|failed",
  "exit_reason": "interface_violation|naming_convention|duplicate_implementation|inefficient_algorithm|missing_error_handling|...",
  "findings": ["specific description of each finding"],
  "severity": "blocking|warning",
  "affected_files": ["src/path/file.ts"],
  "suggested_action": "replan:coder:taskName|retry:coder:taskName|accept"
}
```
`suggested_action` is a hint only — Orchestrator/Planner decides. If Reviewer needs library context, it spawns Scout.

### Tester
Writes and runs tests per tier. Produces structured result file. Never modifies source (except test files).

**Spawn tool:** `somonnoy_spawn_tester`
**Pi-native tools:** read, write, edit, bash, grep
**Skills:** caveman (for compressing report output)
**Output format:**
```json
{
  "agent": "tester",
  "tier": "module-name",
  "status": "pass|failed",
  "exit_reason": "assertion_error|compile_error|timeout|missing_coverage|...",
  "failed_tests": ["test description with expected vs actual"],
  "tool_trace": ["run:test:file.test.ts"],
  "affected_files": ["src/path/file.ts"],
  "suggested_action": "replan:coder:taskName|retry:coder:taskName|accept"
}
```
`suggested_action` is a hint only. If Tester needs library context, it spawns Scout.

### Frontend Designer
Handles UI tasks at relevant tiers only. Produces interfaces that are slick, fast, and intuitive — prioritizes perceived performance, minimal cognitive load, clean visual hierarchy. Takes headless screenshot to verify render before reporting.

**Spawn tool:** `somonnoy_spawn_frontend`
**Pi-native tools:** read, write, edit, bash, grep
**Skills:** frontend-design
**MCP:** playwright (optional — if unavailable, skips visual verification step and notes in report that render was not verified)

### Security Agent
Runs at key tier boundaries. Scans for vulnerabilities, auth flaws, exposed secrets. Read-only on source — produces findings report only, never modifies code.

**Spawn tool:** `somonnoy_spawn_security`
**Pi-native tools:** read, bash, grep
**External CLI (bash-invoked):** semgrep, trufflehog (if either binary not found on PATH, skips that scan and flags the gap explicitly in findings report — never silently omits)

## Agent Spawning Mechanism

Each agent is spawned as an in-memory `AgentSession` via pi's SDK (`createAgentSession` with `SessionManager.inMemory()`). The extension:

1. Loads the agent's SKILL.md to build the system prompt
2. Checks MCP server availability via `mcp({})` — builds capability flags object
3. Injects capability flags + relevant MEMORY.md lessons into system prompt
4. Creates `AgentSession` with agent-specific tools only (enforced at session creation)
5. Sends the task as `session.prompt(taskDescription)`
6. Collects output via event subscription
7. Applies timeout (aborts session if exceeded)
8. Disposes session (`session.dispose()`)
9. Writes output to designated location

```
Extension (index.ts)
  │
  ├─ somonnoy_spawn_planner({ task, contract, ... })
  │    └─ create AgentSession with Planner system prompt + tools
  │       └─ session.prompt(task) → collect output → dispose
  │
  ├─ somonnoy_spawn_coder({ task, filePath, specs, ... })
  │    └─ create AgentSession with Coder system prompt + tools
  │       └─ session.prompt(task) → collect output → dispose
  │
  └─ ... (same pattern for all agents)
```

**Constraint:** Each spawn tool creates exactly one agent session per invocation. One Coder = one file. Parallel Coders are multiple spawn tool calls.

## Lifecycle Management

The extension tracks all active agent sessions. Each spawn registers the session in STATUS.md with state `running`. On completion (success/failure/timeout), state updates to `done` or `failed`.

**Timeouts (default, configurable):**
| Agent | Timeout |
|-------|---------|
| Planner | 600s |
| Coder | 300s |
| Integrator | 300s |
| Reviewer | 300s |
| Tester | 300s |
| Scout | 120s |
| Frontend Designer | 300s |
| Security Agent | 300s |

**STATUS.md agent state format:**
```
## Agent Status
| Agent ID | Type | Tier | State | Started | Timeout | Result |
|----------|------|------|-------|---------|---------|--------|
| planner-01 | planner | — | done | 12:00 | 12:10 | plan.json written |
| coder-auth-01 | coder | auth | running | 12:11 | 12:16 | — |
| coder-auth-02 | coder | auth | pending | — | — | — |
```

## Shared State (Filesystem)

### Single-Writer Pattern
Each file has exactly one writer agent type. No file locking needed.

| File/Directory | Writer | Readers |
|----------------|--------|---------|
| `STATUS.md` | Orchestrator | All agents |
| `MEMORY.md` | Planner | Extension (reads to filter + inject) |
| `PRD.md` | Planner | Orchestrator, all agents |
| `DESIGN.md` | Planner | Orchestrator, Integrator, Coder |
| `DIAGRAM.md` (Mermaid) | Planner | Orchestrator, Integrator |
| `contracts/<tier>.json` | Planner | Integrator (for that tier), Orchestrator |
| `task-specs/<task>.json` | Planner | Coder (for that task), Reviewer, Tester |
| `coder_outputs/<task-id>.tmp` | Coder | Integrator (reads, then deletes after assembly) |
| `src/<tier>/*` (final code) | Integrator | Reviewer, Tester, Security Agent |
| `tests/<tier>/*` | Tester | Reviewer |
| `reports/<agent>-<tier>.json` | Reviewer, Tester, Security | Orchestrator, Planner |

### Contract File Format
```json
{
  "tier": "auth-module",
  "receives_from": ["config-module"],
  "produces_for": ["api-module"],
  "tasks": [
    {
      "id": "auth-01",
      "file": "src/auth/login.ts",
      "description": "Login handler with JWT issuance",
      "interface": { "exports": ["login(req, res): Promise<AuthResult>"] },
      "algorithm": "bcrypt for password hashing, HS256 for JWT",
      "reuses": ["src/shared/jwt-utils.ts"],
      "verification": ["unit test for valid credentials", "unit test for invalid credentials"]
    }
  ],
  "checklist": [
    "All files compile without errors",
    "All interface contracts satisfied",
    "No duplicate implementations across files",
    "Error handling present on all external boundaries"
  ]
}
```

### Coding-Level Task Spec Format
```json
{
  "taskId": "auth-01",
  "agent": "coder",
  "file": "src/auth/login.ts",
  "description": "Implement login handler",
  "interface": {
    "exports": ["login(req: LoginRequest, res: Response): Promise<AuthResult>"],
    "imports": ["validateCredentials from ../shared/validate", "signToken from ../shared/jwt-utils"],
    "types": {
      "LoginRequest": "{ username: string, password: string }",
      "AuthResult": "{ token: string, user: User }"
    }
  },
  "algorithm": "Use bcrypt.compare for password check. Use jsonwebtoken.sign with HS256 for token generation.",
  "reuses": ["src/shared/jwt-utils.ts (signToken)", "src/shared/validate.ts (validateCredentials)"],
  "errorCases": ["Invalid credentials → 401", "Missing fields → 400", "Database error → 500"],
  "verification": "Compiles with tsc --noEmit. File is under 150 lines."
}
```

## Coding Standards (enforced by Coder + Reviewer)

- Unix philosophy: one task, one file, done well
- KISS: no over-engineering, no premature abstraction
- Standard templates and maximum code reuse; Planner identifies reusable modules; Integrator flags duplication
- Frontend: slick, fast, intuitive
- Algorithms: fastest commonly-used; chosen at planning stage, enforced at review
- Naming: intuitive and descriptive, never bloated or cryptically abbreviated

## Token Efficiency

- Caveman compression on all inter-tier reports going upward (Reviewer, Tester, Integrator load caveman skill)
- Each agent loads only its own relevant skills (enforced at spawn time)
- SKILL.md files authored with caveman-compress for minimal token footprint
- Parallel Coders receive identical system prompt structure for consistency
- Each subagent session is in-memory — no session file I/O overhead

## Failure Handling

- Reviewer and Tester produce structured failure metadata with `suggested_action` hint
- Failure metadata references contract file task IDs for precise replanning location
- Orchestrator/Planner validates `suggested_action` before acting — agents never self-trigger replanning
- Orchestrator escalates to human if replanning fails 3+ times on the same tier
  - Injects displayed message with structured options (retry / skip / replan / abort)
  - Pauses pipeline until user responds
- All failures logged in STATUS.md with error summary and affected task IDs

## MEMORY.md Mechanism

Planner maintains MEMORY.md with caveman-compressed lessons from failures. Format:

```markdown
## Lessons
### [coder] Always check for null before destructuring — auth-01 null pointer
### [reviewer] Enforce error types in interface contracts — api-02 missing HttpError
### [planner] Database schema must precede API tier planning — data-01 reorder needed
```

**Tags:** `[coder]`, `[reviewer]`, `[tester]`, `[integrator]`, `[planner]`, `[frontend]`, `[security]` — indicate which agent types should receive this lesson.

Extension filters by agent type at spawn time and injects relevant lessons into the system prompt under a `## Lessons Learned` section. Lessons older than 10 entries are pruned (rolling window).

## Tool & Skill Availability Policy (Capability Flags)

The extension checks tool/skill/MCP availability once at agent spawn time. Results are passed as a capability flags object in the system prompt:

```
## Available Capabilities
- sequential_thinking_mcp: true
- playwright_mcp: false
- context7_mcp: true
- brave_search_skill: true
- semgrep_binary: true
- trufflehog_binary: false
```

Each agent's SKILL.md includes degradation instructions for each optional capability. If a capability is unavailable, the agent follows its degradation path rather than erroring out. Degradation is always explicit and reported in the agent's output.

**Specific degradation paths:**
- **Scout:** If brave-search unavailable, uses `web_search` (pi-native) as fallback. If context7 unavailable, works from training knowledge and flags potential staleness.
- **Planner:** If sequential-thinking MCP unavailable, performs explicit step-by-step reasoning natively in output before committing to any plan.
- **Frontend Designer:** If playwright MCP unavailable, skips visual verification step and notes in report that render was not verified.
- **Security Agent:** If semgrep or trufflehog binary not found, skips that scan and flags the gap explicitly in findings. Never silently omits.

No agent halts or errors due to a missing external tool.

## Implementation Notes

1. **Pi SDK usage:** Extension imports `createAgentSession`, `SessionManager`, `AuthStorage`, `ModelRegistry` from `@earendil-works/pi-coding-agent`. Spawned sessions are in-memory only (`SessionManager.inMemory()`).
2. **Model selection:** Spawned subagents use the same model as the parent session by default. Configurable per agent type in settings.
3. **Error isolation:** One Coder crash does not affect other parallel Coders. Integrator assembles whatever outputs are available.
4. **Build verification:** Integrator runs `tsc --noEmit` (or equivalent) after assembly. If build fails, tier is marked blocked in STATUS.md.
5. **Visual explainer:** Planner's Mermaid diagram is rendered using the visual-explainer skill for human review.
