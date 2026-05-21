/**
 * pi-somonnoy — Multi-Agent Coding Orchestration Extension
 *
 * Gated pipeline: PRD → Brainstorm → Design → Plan → Implement → Review
 * Spawns specialized sub-agents via pi --mode json for isolated execution.
 */

import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

interface AgentConfig {
  name: string;
  description: string;
  tools: string[];
  skills: string[];
  systemPrompt: string;
  timeout: number;
}

interface AgentResult {
  agent: string;
  task: string;
  exitCode: number;
  output: string;
  error: string;
  duration: number;
}

interface TierState {
  tier: string;
  status: "pending" | "planning" | "coding" | "integrating" | "scanning" | "reviewing" | "testing" | "done" | "failed";
  agents: AgentRunState[];
}

interface AgentRunState {
  id: string;
  agent: string;
  task: string;
  status: "pending" | "running" | "done" | "failed";
  result?: AgentResult;
}

interface SomonnoyState {
  projectName: string;
  phase: "init" | "prd" | "brainstorm" | "design" | "plan" | "implement" | "review" | "done";
  tiers: TierState[];
  startedAt: number;
  totalAgents: number;
  completedAgents: number;
  failedAgents: number;
}

const SESSION_KEY = "pi-somonnoy";
const STATUS_FILE = "STATUS.md";
const MEMORY_FILE = "MEMORY.md";
const DEFAULT_MODEL = "deepseek-v4-pro";

// ── Per-agent model selection ──
const AGENT_MODELS: Record<string, string> = {
  "smn-planner": "glm-5.1",
  "smn-integrator": "glm-5.1",
  "smn-security": "glm-5.1",
  "smn-coder": "qwen3.6-plus",
  "smn-tester": "qwen3.6-plus",
  "smn-frontend": "kimi-k2.6",
  "smn-reviewer": "kimi-k2.6",
  "smn-scout": "deepseek-v4-flash",
};

let state: SomonnoyState | null = null;
let dashboardWidget: (() => void) | null = null;

// ═══════════════════════════════════════════
// Agent Configs
// ═══════════════════════════════════════════

const AGENT_CONFIGS: Record<string, AgentConfig> = {
  "smn-planner": {
    name: "smn-planner",
    description: "Enforces PRD→Brainstorm→Design→Plan. Produces PRD, design, Mermaid diagram, task specs.",
    tools: ["read", "write", "bash", "grep", "find"],
    skills: ["brainstorming"],
    systemPrompt: "",
    timeout: 600_000,
  },
  "smn-scout": {
    name: "smn-scout",
    description: "Stateless research agent. Searches web/docs, returns structured findings.",
    tools: ["read", "write", "bash", "web_search", "web_fetch"],
    skills: ["brave-search"],
    systemPrompt: "",
    timeout: 120_000,
  },
  "smn-coder": {
    name: "smn-coder",
    description: "Leaf agent. One file per invocation. KISS, Unix philosophy, max reuse.",
    tools: ["read", "write", "edit", "bash", "grep", "context7_get_library_docs"],
    skills: [],
    systemPrompt: "",
    timeout: 300_000,
  },
  "smn-integrator": {
    name: "smn-integrator",
    description: "Assembles Coder outputs per tier. Runs build check, flags duplication.",
    tools: ["read", "write", "bash", "grep", "find"],
    skills: [],
    systemPrompt: "",
    timeout: 300_000,
  },
  "smn-reviewer": {
    name: "smn-reviewer",
    description: "Checks integrated tier output. Enforces contracts, KISS, naming, error handling.",
    tools: ["read", "write", "bash", "grep"],
    skills: ["caveman"],
    systemPrompt: "",
    timeout: 300_000,
  },
  "smn-tester": {
    name: "smn-tester",
    description: "Writes and runs tests per tier. Structured failure reports.",
    tools: ["read", "write", "edit", "bash", "grep"],
    skills: ["caveman"],
    systemPrompt: "",
    timeout: 300_000,
  },
  "smn-frontend": {
    name: "smn-frontend",
    description: "Handles UI tasks. Slick, fast, intuitive interfaces.",
    tools: ["read", "write", "edit", "bash", "grep", "context7_get_library_docs"],
    skills: ["frontend-design"],
    systemPrompt: "",
    timeout: 300_000,
  },
  "smn-security": {
    name: "smn-security",
    description: "Scans for vulnerabilities, auth flaws, exposed secrets. Read-only.",
    tools: ["read", "bash", "grep"],
    skills: [],
    systemPrompt: "",
    timeout: 300_000,
  },
};

// ═══════════════════════════════════════════
// Skill Loader
// ═══════════════════════════════════════════

function loadSkillFile(agentType: string): string {
  const cleanName = agentType.replace(/^smn-/, "");
  const skillPath = path.join(__dirname, "skills", `somonnoy-${cleanName}`, "SKILL.md");
  try {
    return fs.readFileSync(skillPath, "utf-8");
  } catch {
    return "";
  }
}

function buildSystemPrompt(agentType: string): string {
  const config = AGENT_CONFIGS[agentType];
  if (!config) return "";

  const skillContent = loadSkillFile(agentType);

  // MEMORY.md filtering — extract lessons tagged for this agent
  let memoryLessons = "";
  try {
    const memoryPath = path.join(process.cwd(), MEMORY_FILE);
    if (fs.existsSync(memoryPath)) {
      const memory = fs.readFileSync(memoryPath, "utf-8");
      const tag = `[${agentType}]`;
      const lines = memory.split("\n").filter((l) => l.includes(tag));
      if (lines.length > 0) {
        memoryLessons = `\n## Lessons Learned (from MEMORY.md)\n${lines.slice(-10).join("\n")}\n`;
      }
    }
  } catch { /* ignore */ }

  // MCP capability flags
  const caps = buildCapabilityFlags(agentType);

  return `${skillContent}

## Available Capabilities
${Object.entries(caps).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
${memoryLessons}

## Task
You are the ${config.name} agent in the pi-somonnoy orchestration system.
Your role: ${config.description}
Tools available: ${config.tools.join(", ")}
Skills loaded: ${config.skills.join(", ") || "none"}
${config.timeout ? `Timeout: ${config.timeout / 1000}s` : ""}

Write your output to the file path specified in the task. Be thorough and complete.
`;
}

function buildCapabilityFlags(agentType: string): Record<string, boolean> {
  const flags: Record<string, boolean> = {};

  switch (agentType) {
    case "smn-planner":
      flags.sequential_thinking_mcp = checkBinary("which mcp-server-sequential-thinking");
      break;
    case "smn-scout":
      flags.brave_search_skill = true; // built-in
      flags.context7_mcp = checkBinary("context7");
      break;
    case "smn-frontend":
      flags.playwright_mcp = checkBinary("npx");
      break;
    case "smn-security":
      flags.semgrep_binary = checkBinary("semgrep");
      flags.trufflehog_binary = checkBinary("trufflehog");
      break;
  }
  return flags;
}

function checkBinary(name: string): boolean {
  try {
    const result = spawn("which", [name], { stdio: "pipe", timeout: 2000 });
    result.on("error", () => {});
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════
// Agent Spawner
// ═══════════════════════════════════════════

async function spawnPiAgent(
  agentType: string,
  task: string,
  cwd: string,
  model: string,
  signal: AbortSignal | undefined,
  onUpdate?: (text: string) => void,
): Promise<AgentResult> {
  const config = AGENT_CONFIGS[agentType];
  if (!config) {
    return { agent: agentType, task, exitCode: 1, output: "", error: `Unknown agent: ${agentType}`, duration: 0 };
  }

  const startedAt = Date.now();
  const systemPrompt = buildSystemPrompt(agentType);
  const agentModel = AGENT_MODELS[agentType] ?? model; // per-agent override, fallback to orchestrator default

  // Write system prompt to temp file
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-somonnoy-"));
  const promptFile = path.join(tmpDir, "system-prompt.md");
  await fs.promises.writeFile(promptFile, systemPrompt, "utf-8");

  const args: string[] = [
    "--mode", "json",
    "-p",
    "--no-session",
    "--model", agentModel,
    "--tools", config.tools.join(","),
    "--append-system-prompt", promptFile,
  ];

  const taskFile = path.join(tmpDir, "task.md");
  await fs.promises.writeFile(taskFile, task, "utf-8");
  args.push(taskFile);

  let output = "";
  let error = "";
  let messages: any[] = [];

  try {
    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn("pi", args, {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PI_NO_COLOR: "1" },
      });

      let buffer = "";

      proc.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "message_end" && event.message?.role === "assistant") {
              messages.push(event.message);
              const text = event.message.content
                ?.filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n") || "";
              if (text) {
                output = text;
                onUpdate?.(text);
              }
            }
          } catch { /* skip malformed JSON */ }
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        error += data.toString();
      });

      proc.on("close", (code) => resolve(code ?? 0));
      proc.on("error", () => resolve(1));

      if (signal) {
        const kill = () => { proc.kill("SIGTERM"); setTimeout(() => proc.kill("SIGKILL"), 5000); };
        if (signal.aborted) kill();
        else signal.addEventListener("abort", kill, { once: true });
      }
    });

    return {
      agent: agentType,
      task,
      exitCode,
      output,
      error: error.slice(0, 2000),
      duration: Date.now() - startedAt,
    };
  } finally {
    try { fs.unlinkSync(promptFile); } catch {}
    try { fs.unlinkSync(taskFile); } catch {}
    try { fs.rmdirSync(tmpDir); } catch {}
  }
}

// ═══════════════════════════════════════════
// STATUS.md Manager
// ═══════════════════════════════════════════

function updateStatus(s: SomonnoyState): void {
  const lines: string[] = [
    `# ${s.projectName} — pi-somonnoy Pipeline`,
    "",
    `**Phase:** ${s.phase.toUpperCase()}  |  **Started:** ${new Date(s.startedAt).toISOString()}  |  **Progress:** ${s.completedAgents}/${s.totalAgents} tasks`,
    "",
    "## Tiers",
    "",
  ];

  for (const tier of s.tiers) {
    const icon = tier.status === "done" ? "✅" : tier.status === "failed" ? "❌" : tier.status === "pending" ? "⬜" : "🔄";
    lines.push(`### ${icon} ${tier.tier} (${tier.status})`);
    if (tier.agents.length > 0) {
      lines.push("| Agent | Task | Status | Time |");
      lines.push("|-------|------|--------|------|");
      for (const a of tier.agents) {
        const sIcon = a.status === "done" ? "✅" : a.status === "failed" ? "❌" : a.status === "running" ? "🔄" : "⬜";
        const dur = a.result ? `${(a.result.duration / 1000).toFixed(1)}s` : "-";
        const taskShort = a.task.length > 40 ? a.task.slice(0, 40) + "..." : a.task;
        lines.push(`| ${sIcon} ${a.agent} | ${taskShort} | ${a.status} | ${dur} |`);
      }
    }
    lines.push("");
  }

  try {
    fs.writeFileSync(path.join(process.cwd(), STATUS_FILE), lines.join("\n"), "utf-8");
  } catch { /* ignore */ }
}

function updateDashboard(ctx: ExtensionContext): void {
  if (!state) return;
  updateStatus(state);

  const s = state;
  const completed = s.completedAgents;
  const total = s.totalAgents;
  const failed = s.failedAgents;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Status bar
  ctx.ui.setStatus("somonnoy", ctx.ui.theme.fg("accent", `🐘 ${s.phase} ${pct}% (${completed}/${total})`));

  // Widget with agent progress
  const lines: string[] = [];
  lines.push(ctx.ui.theme.fg("accent", ctx.ui.theme.bold(`🐘 pi-somonnoy: ${s.projectName}`)));
  lines.push(ctx.ui.theme.fg("muted", `Phase: ${s.phase}  |  ${completed}/${total} done${failed > 0 ? `  ${ctx.ui.theme.fg("error", `⚠ ${failed} failed`)}` : ""}`));

  // Progress bar
  const barWidth = 30;
  const filled = Math.round((pct / 100) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
  lines.push(ctx.ui.theme.fg(pct === 100 ? "success" : "accent", bar));

  // Agent statuses
  for (const tier of s.tiers) {
    for (const a of tier.agents.slice(0, 12)) {
      const icon = a.status === "done" ? "✅" : a.status === "failed" ? "❌" : a.status === "running" ? "🔄" : "⬜";
      const dur = a.result ? ` ${(a.result.duration / 1000).toFixed(1)}s` : "";
      lines.push(`${icon} ${a.agent.padEnd(12)} ${ctx.ui.theme.fg("dim", a.task.slice(0, 40) + dur)}`);
    }
  }

  ctx.ui.setWidget("somonnoy", lines, { placement: "belowEditor" });
}

function clearDashboard(ctx: ExtensionContext): void {
  ctx.ui.setStatus("somonnoy", undefined);
  ctx.ui.setWidget("somonnoy", undefined);
}

// ═══════════════════════════════════════════
// TUI Dashboard Overlay
// ═══════════════════════════════════════════

class SomonnoyDashboard {
  private state: SomonnoyState;

  constructor(state: SomonnoyState) {
    this.state = state;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
      // Handled externally via onClose
    }
  }

  render(width: number): string[] {
    const s = this.state;
    const lines: string[] = [];
    const t = (c: string, s: string) => `\x1b[${c}m${s}\x1b[0m`;

    lines.push(truncateToWidth(t("1;36", `╔══ pi-somonnoy Dashboard ══ ${s.projectName} ══╗`), width));

    // Phase + progress
    const pct = s.totalAgents > 0 ? Math.round((s.completedAgents / s.totalAgents) * 100) : 0;
    lines.push(truncateToWidth(`  Phase: ${t("1;33", s.phase)}  |  ${s.completedAgents}/${s.totalAgents} tasks  |  ${pct}%`, width));

    // Progress bar
    const barW = Math.min(width - 4, 50);
    const filled = Math.round((pct / 100) * barW);
    lines.push(truncateToWidth(`  ${t("1;32", "█".repeat(filled))}${t("2;37", "░".repeat(barW - filled))}`, width));

    lines.push(truncateToWidth(t("2;37", "─".repeat(width)), width));

    // Tiers
    for (const tier of s.tiers) {
      const icon = tier.status === "done" ? "✅" : tier.status === "failed" ? "❌" : tier.status === "pending" ? "  " : "🔄";
      lines.push(truncateToWidth(` ${icon} ${t("1;36", tier.tier)} — ${tier.status}`, width));

      for (const a of tier.agents) {
        const aIcon = a.status === "done" ? "✅" : a.status === "failed" ? "❌" : a.status === "running" ? "🔄" : "  ";
        const dur = a.result ? `(${(a.result.duration / 1000).toFixed(1)}s)` : "";
        const task = a.task.length > 35 ? a.task.slice(0, 35) + "..." : a.task;
        lines.push(truncateToWidth(`   ${aIcon} ${a.agent.padEnd(12)} ${t("2;37", task)} ${dur}`, width));
      }
    }

    lines.push(truncateToWidth(t("2;37", "─".repeat(width)), width));
    lines.push(truncateToWidth(`  ${t("2;37", "esc/q to close")}  |  ${t("2;37", "STATUS.md for full log")}`, width));
    lines.push(truncateToWidth(t("1;36", "╚" + "═".repeat(width - 2) + "╝"), width));

    return lines;
  }

  invalidate(): void {}
}

// ═══════════════════════════════════════════
// Orchestrator Pipeline
// ═══════════════════════════════════════════

async function runOrchestrator(
  pi: ExtensionAPI,
  projectName: string,
  projectDesc: string,
  cwd: string,
  model: string,
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<void> {
  state = {
    projectName,
    phase: "init",
    tiers: [],
    startedAt: Date.now(),
    totalAgents: 0,
    completedAgents: 0,
    failedAgents: 0,
  };
  updateDashboard(ctx);

  try {
    // Phase 1: PRD
    state.phase = "prd";
    updateDashboard(ctx);
    const prdResult = await spawnPiAgent("smn-planner",
      `# PRD Task\n\nProject: ${projectName}\nDescription: ${projectDesc}\n\nWrite a PRD to ${cwd}/PRD.md. Cover goals, scope, constraints, user flows, success criteria. Be thorough.`,
      cwd, model, signal);
    state.completedAgents++;
    if (prdResult.exitCode !== 0) {
      state.failedAgents++;
      state.phase = "failed";
      updateDashboard(ctx);
      return;
    }

    // Phase 2: Brainstorm + Design
    state.phase = "brainstorm";
    updateDashboard(ctx);
    const designResult = await spawnPiAgent("smn-planner",
      `# Design Task\n\nRead PRD.md. Conduct structured analysis. Write design document to ${cwd}/DESIGN.md. Include architecture decisions, tradeoffs, edge cases. No code.`,
      cwd, model, signal);
    state.completedAgents++;
    if (designResult.exitCode !== 0) {
      state.failedAgents++;
      state.phase = "failed";
      updateDashboard(ctx);
      return;
    }

    // Phase 3: Plan — produce task specs and Mermaid diagram
    state.phase = "plan";
    updateDashboard(ctx);
    const planResult = await spawnPiAgent("smn-planner",
      `# Plan Task\n\nRead PRD.md and DESIGN.md. Produce:\n1. Full Mermaid diagram → ${cwd}/DIAGRAM.md\n2. Tier breakdown with tasks → ${cwd}/PLAN.md\n3. Per-tier contracts → ${cwd}/contracts/<tier>.json\n\nEach task must specify: file path, interface, algorithm, verification. No TBD sections.`,
      cwd, model, signal);
    state.completedAgents++;
    if (planResult.exitCode !== 0) {
      state.failedAgents++;
      state.phase = "failed";
      updateDashboard(ctx);
      return;
    }

    // Phase 4: Implement — parse PLAN.md for tiers and tasks
    state.phase = "implement";
    // Parse plan for tiers
    let planContent = "";
    try { planContent = fs.readFileSync(path.join(cwd, "PLAN.md"), "utf-8"); } catch {}
    const tiers = parseTiersFromPlan(planContent);
    state.tiers = tiers;
    state.totalAgents = 3 + tiers.reduce((sum, t) => sum + t.agents.length + 4, 0); // 3 plan phases + coders + integrator + security + reviewer + tester per tier
    updateDashboard(ctx);

    for (const tier of tiers) {
      if (signal.aborted) break;

      // Coding phase
      tier.status = "coding";
      updateDashboard(ctx);

      // Pre-fetch research for unfamiliar dependencies (20% case)
      const deps = scanForDependencies(tier.agents);
      let researchContext = "";
      if (deps.length > 0) {
        const scoutResult = await spawnPiAgent("smn-scout",
          `# Scout Research\n\nTier: ${tier.tier}\nResearch: ${deps.join(", ")}. Find API references, usage examples, gotchas for ${tier.tier} implementation. Write structured report.`,
          cwd, model, signal);
        if (scoutResult.exitCode === 0 && scoutResult.output) {
          researchContext = `\n\n## Research Context (pre-fetched by Scout)\n${scoutResult.output.slice(0, 3000)}\n`;
        }
        state.completedAgents++;
        if (scoutResult.exitCode !== 0) state.failedAgents++;
      }

      for (const agent of tier.agents) {
        if (agent.agent !== "smn-coder") continue;

        // Route UI files to frontend agent, backend files to coder
        const useFrontend = isUiFilePath(agent.id);
        const agentType = useFrontend ? "smn-frontend" : "smn-coder";
        agent.agent = agentType; // update for STATUS.md display
        agent.status = "running";
        updateDashboard(ctx);

        const taskPrompt = useFrontend
          ? `# Frontend Task\n\nTier: ${tier.tier}\nFile: ${agent.id}\nTask: ${agent.task}\n\nWrite UI code to ${agent.id}. Prioritize perceived performance, minimal cognitive load, clean visual hierarchy. Use frontend-design skill. Take screenshot if Playwright available.${researchContext}`
          : `# Coder Task\n\nTier: ${tier.tier}\nFile: ${agent.id}\nTask: ${agent.task}\n\nWrite code to ${agent.id}. Follow KISS, Unix philosophy. Max code reuse. Compile check after writing.${researchContext}`;

        agent.result = await spawnPiAgent(agentType, taskPrompt, cwd, model, signal);
        agent.status = agent.result.exitCode === 0 ? "done" : "failed";
        state.completedAgents++;
        if (agent.result.exitCode !== 0) state.failedAgents++;
        updateDashboard(ctx);
      }

      // Integration
      tier.status = "integrating";
      const integratorAgent: AgentRunState = {
        id: `integrator-${tier.tier}`,
        agent: "smn-integrator",
        task: `Integrate tier: ${tier.tier}`,
        status: "running",
      };
      tier.agents.push(integratorAgent);
      updateDashboard(ctx);
      const codeFiles = tier.agents.filter(a => a.agent === "smn-coder" || a.agent === "smn-frontend");
      integratorAgent.result = await spawnPiAgent("smn-integrator",
        `# Integrator Task\n\nTier: ${tier.tier}\nAssemble all coder + frontend outputs for this tier. Run build check (tsc --noEmit or equivalent). Flag code duplication. Write status report to ${cwd}/reports/integrator-${tier.tier}.json.\n\nFiles to integrate:\n${codeFiles.map(a => `- ${a.id}`).join("\n")}`,
        cwd, model, signal);
      integratorAgent.status = integratorAgent.result.exitCode === 0 ? "done" : "failed";
      state.completedAgents++;
      if (integratorAgent.result.exitCode !== 0) state.failedAgents++;
      updateDashboard(ctx);

      // Security scan (read-only, after integration)
      tier.status = "scanning";
      const securityAgent: AgentRunState = {
        id: `security-${tier.tier}`,
        agent: "smn-security",
        task: `Security scan: ${tier.tier}`,
        status: "running",
      };
      tier.agents.push(securityAgent);
      updateDashboard(ctx);
      securityAgent.result = await spawnPiAgent("smn-security",
        `# Security Scan\n\nTier: ${tier.tier}\nScan integrated code in src/ for vulnerabilities, exposed secrets, auth flaws. Run Semgrep + Trufflehog if available. Write structured JSON report to ${cwd}/reports/security-${tier.tier}.json.`,
        cwd, model, signal);
      securityAgent.status = securityAgent.result.exitCode === 0 ? "done" : "failed";
      state.completedAgents++;
      if (securityAgent.result.exitCode !== 0) state.failedAgents++;
      updateDashboard(ctx);

      // Review
      tier.status = "reviewing";
      const reviewerAgent: AgentRunState = {
        id: `reviewer-${tier.tier}`,
        agent: "smn-reviewer",
        task: `Review tier: ${tier.tier}`,
        status: "running",
      };
      tier.agents.push(reviewerAgent);
      updateDashboard(ctx);
      reviewerAgent.result = await spawnPiAgent("smn-reviewer",
        `# Reviewer Task\n\nTier: ${tier.tier}\nReview integrated code. Check: interface contracts, error handling, KISS, algorithm efficiency, naming, code reuse.\nWrite structured report to ${cwd}/reports/reviewer-${tier.tier}.json`,
        cwd, model, signal);
      reviewerAgent.status = reviewerAgent.result.exitCode === 0 ? "done" : "failed";
      state.completedAgents++;
      if (reviewerAgent.result.exitCode !== 0) state.failedAgents++;
      updateDashboard(ctx);

      // Test
      tier.status = "testing";
      const testerAgent: AgentRunState = {
        id: `tester-${tier.tier}`,
        agent: "smn-tester",
        task: `Test tier: ${tier.tier}`,
        status: "running",
      };
      tier.agents.push(testerAgent);
      updateDashboard(ctx);
      testerAgent.result = await spawnPiAgent("smn-tester",
        `# Tester Task\n\nTier: ${tier.tier}\nWrite and run tests. Check edge cases, error paths.\nWrite structured report to ${cwd}/reports/tester-${tier.tier}.json`,
        cwd, model, signal);
      testerAgent.status = testerAgent.result.exitCode === 0 ? "done" : "failed";
      state.completedAgents++;
      if (testerAgent.result.exitCode !== 0) state.failedAgents++;
      updateDashboard(ctx);

      tier.status = testerAgent.status === "done" && reviewerAgent.status === "done" ? "done" : "failed";
      updateDashboard(ctx);

      // Auto-commit: gate on both review + test passing (Point D)
      if (tier.status === "done") {
        const commitMsg = commitTier(tier.tier, cwd);
        if (commitMsg) {
          ctx.ui.notify(`📦 Committed: ${commitMsg}`, "info");
        }
      }
    }

    state.phase = state.tiers.every((t) => t.status === "done") ? "done" : "review";
    updateDashboard(ctx);

    // Final: write completion summary
    const summary = `# ${projectName} — Complete\n\nPhase: ${state.phase}\nTiers: ${state.tiers.length}\nTasks: ${state.totalAgents}\nDuration: ${((Date.now() - state.startedAt) / 1000).toFixed(1)}s\n\nSee STATUS.md for full log.`;
    try { fs.writeFileSync(path.join(cwd, "SOMONNOY_SUMMARY.md"), summary, "utf-8"); } catch {}

  } catch (err: any) {
    state.phase = "failed";
    updateDashboard(ctx);
  } finally {
    // Persist state
    pi.appendEntry(`${SESSION_KEY}-result`, { state, completedAt: Date.now() });
    setTimeout(() => clearDashboard(ctx), 30000); // clear after 30s
  }
}

function parseTiersFromPlan(plan: string): TierState[] {
  const tiers: TierState[] = [];
  const tierRegex = /^##\s+Tier:\s+(.+)$/gm;
  const taskRegex = /^-\s+\*\*File:\*\*\s+`(.+?)`\s*[-–]\s*(.+)$/gm;

  let tierMatch;
  while ((tierMatch = tierRegex.exec(plan)) !== null) {
    const tierName = tierMatch[1].trim();
    const agents: AgentRunState[] = [];

    // Find tasks under this tier
    const tierStart = tierMatch.index;
    const nextTierStart = plan.indexOf("## Tier:", tierStart + 1);
    const tierSection = nextTierStart > 0 ? plan.slice(tierStart, nextTierStart) : plan.slice(tierStart);

    let taskMatch;
    while ((taskMatch = taskRegex.exec(tierSection)) !== null) {
      agents.push({
        id: taskMatch[1].trim(),
        agent: "smn-coder",
        task: taskMatch[2].trim(),
        status: "pending",
      });
    }

    if (agents.length > 0) {
      tiers.push({ tier: tierName, status: "pending", agents });
    }
  }
  return tiers;
}

// ═══════════════════════════════════════════
// Git Auto-Commit
// ═══════════════════════════════════════════

function isUiFilePath(filePath: string): boolean {
  const uiPatterns = [
    /\.tsx$/i, /\.jsx$/i, /\.css$/i, /\.scss$/i, /\.less$/i,
    /\.html$/i, /\.svelte$/i, /\.vue$/i,
    /components?\//i, /pages?\//i, /views?\//i, /layouts?\//i,
  ];
  return uiPatterns.some((p) => p.test(filePath));
}

function scanForDependencies(agents: AgentRunState[]): string[] {
  // Match patterns like: "uses Stripe SDK", "integrate with SendGrid", "using redis",
  // "leverage X", "library: Y", or bare capitalized library names in task descriptions
  const depRegex = /(?:uses?|integrate(?:s|d)?\s+(?:with)?|using|leveraging?|library[:\s]+|framework[:\s]+|sdk[:\s]+|api[:\s]+)\s*["']?([A-Z][a-zA-Z0-9.\-_]{2,30}(?:\s+[A-Z][a-zA-Z0-9.\-_]{2,20}){0,2})["']?/gi;
  const deps = new Set<string>();
  for (const agent of agents) {
    if (agent.agent !== "smn-coder") continue;
    let match;
    while ((match = depRegex.exec(agent.task)) !== null) {
      deps.add(match[1].trim().toLowerCase());
    }
    // Also check file path for library hints in import-like paths
    const importHints = agent.id.match(/@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+/g);
    if (importHints) importHints.forEach((h) => deps.add(h.toLowerCase()));
  }
  return [...deps].slice(0, 5); // max 5 unique deps per tier
}

function commitTier(tierName: string, cwd: string): string | null {
  const slug = tierName.replace(/\s+/g, "-").toLowerCase();
  const msg = `feat(${slug}): implement ${tierName} tier`;
  try {
    execSync("git add .", { cwd, stdio: "pipe", timeout: 10_000 });
    execSync(`git commit -m "${msg}"`, { cwd, stdio: "pipe", timeout: 10_000 });
    return msg;
  } catch {
    // Nothing to commit or git unavailable — not fatal
    return null;
  }
}

// ═══════════════════════════════════════════
// Extension Entry
// ═══════════════════════════════════════════

export default function (pi: ExtensionAPI) {

  // ── /somonnoy command ──
  pi.registerCommand("somonnoy", {
    description: "Start multi-agent orchestration pipeline for a project",
    handler: async (args, ctx) => {
      if (!args || !args.trim()) {
        ctx.ui.notify("Usage: /somonnoy <project description>", "warning");
        return;
      }

      const projectDesc = args.trim();
      const projectName = projectDesc.slice(0, 50).replace(/[^a-zA-Z0-9\s_-]/g, "");

      ctx.ui.notify(`🐘 Starting pi-somonnoy: ${projectName}`, "info");

      const model = ctx.model?.id ?? DEFAULT_MODEL;
      const controller = new AbortController();

      // Run in background
      runOrchestrator(pi, projectName, projectDesc, ctx.cwd, model, ctx, controller.signal)
        .then(() => ctx.ui.notify(`🐘 pi-somonnoy complete: ${projectName}`, "success"))
        .catch((err) => ctx.ui.notify(`🐘 pi-somonnoy failed: ${err.message}`, "error"));
    },
  });

  // ── /somonnoy-dashboard command ──
  pi.registerCommand("somonnoy-dashboard", {
    description: "Show pi-somonnoy agent dashboard",
    handler: async (_args, ctx) => {
      if (!state) {
        ctx.ui.notify("No active pi-somonnoy pipeline. Start one with /somonnoy", "info");
        return;
      }

      await ctx.ui.custom((_tui, theme, _kb, done) => {
        const dash = new SomonnoyDashboard(state!);

        return {
          render: (w: number) => dash.render(w),
          invalidate: () => dash.invalidate(),
          handleInput: (data: string) => {
            if (matchesKey(data, Key.escape) || data === "q") {
              done(undefined);
            }
          },
        };
      });
    },
  });

  // ── /somonnoy-stop command ──
  pi.registerCommand("somonnoy-stop", {
    description: "Stop the active pi-somonnoy pipeline",
    handler: async (_args, ctx) => {
      if (!state) {
        ctx.ui.notify("No active pipeline to stop.", "info");
        return;
      }
      state.phase = "done";
      clearDashboard(ctx);
      state = null;
      ctx.ui.notify("pi-somonnoy pipeline stopped.", "info");
    },
  });

  // ── somonnoy_propose tool ──
  pi.registerTool({
    name: "somonnoy_propose",
    label: "Propose Somonnoy",
    description: "Suggest using pi-somonnoy multi-agent orchestration when the user's request requires multi-file, multi-module implementation.",
    promptSnippet: "Propose pi-somonnoy multi-agent orchestration for complex multi-file projects",
    promptGuidelines: [
      "Use somonnoy_propose when the user requests a project requiring 3+ source files across multiple modules.",
      "Use somonnoy_propose to notify the user that pi-somonnoy orchestration is available for structured planning and review.",
    ],
    parameters: Type.Object({
      reason: Type.String({ description: "Why orchestration would help (multi-file, multi-tier, etc.)" }),
      estimated_files: Type.Optional(Type.Number({ description: "Estimated number of source files needed" })),
    }),
    async execute(_toolCallId, params) {
      const msg = params.estimated_files
        ? `🐘 This looks like a ${params.estimated_files}+ file project. Want to use pi-somonnoy orchestration? (/somonnoy "${params.reason.slice(0, 80)}") — structured PRD→Plan→Implement→Review pipeline.`
        : `🐘 pi-somonnoy orchestration available: /somonnoy "${params.reason.slice(0, 80)}"`;
      pi.sendMessage({ customType: "somonnoy-propose", content: msg, display: true }, { triggerTurn: false });
      return { content: [{ type: "text", text: "Proposed pi-somonnoy to user." }], details: {} };
    },
  });

  // ── somonnoy_spawn_planner tool ──
  pi.registerTool({
    name: "somonnoy_spawn_planner",
    label: "Spawn Planner",
    description: "Spawn a Planner agent to produce PRD, design, plan, or task specs.",
    parameters: Type.Object({
      task: Type.String({ description: "Task description for the planner" }),
      output_file: Type.Optional(Type.String({ description: "Where to write output (e.g., PRD.md, DESIGN.md)" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const result = await spawnPiAgent("smn-planner", params.task, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || result.error || "(no output)" }],
        details: result,
      };
    },
  });

  // ── somonnoy_spawn_scout tool ──
  pi.registerTool({
    name: "somonnoy_spawn_scout",
    label: "Spawn Scout",
    description: "Spawn a Scout agent for web/docs research. Returns structured findings.",
    parameters: Type.Object({
      query: Type.String({ description: "Research query or topic" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const result = await spawnPiAgent("smn-scout", `Research: ${params.query}`, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || "(no results)" }],
        details: result,
      };
    },
  });

  // ── somonnoy_spawn_coder tool ──
  pi.registerTool({
    name: "somonnoy_spawn_coder",
    label: "Spawn Coder",
    description: "Spawn a Coder agent to implement a single file. KISS, Unix philosophy, max reuse.",
    parameters: Type.Object({
      file_path: Type.String({ description: "Path to the file to write" }),
      task: Type.String({ description: "Implementation task description" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const task = `# Coder Task\n\nFile: ${params.file_path}\nTask: ${params.task}\n\nWrite code to ${params.file_path}. Follow KISS, Unix philosophy. Max code reuse. Compile check after writing.`;
      const result = await spawnPiAgent("smn-coder", task, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || result.error || "(no output)" }],
        details: result,
      };
    },
  });

  // ── somonnoy_spawn_reviewer tool ──
  pi.registerTool({
    name: "somonnoy_spawn_reviewer",
    label: "Spawn Reviewer",
    description: "Spawn a Reviewer agent. Checks contracts, KISS, naming, error handling. Returns structured report.",
    parameters: Type.Object({
      tier: Type.String({ description: "Tier/module name to review" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const task = `# Reviewer Task\n\nTier: ${params.tier}\nReview all code in this tier. Check: interface contracts, error handling, KISS, algorithm efficiency, naming, code reuse.\nWrite structured JSON report.`;
      const result = await spawnPiAgent("smn-reviewer", task, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || "(no findings)" }],
        details: result,
      };
    },
  });

  // ── somonnoy_spawn_tester tool ──
  pi.registerTool({
    name: "somonnoy_spawn_tester",
    label: "Spawn Tester",
    description: "Spawn a Tester agent. Writes and runs tests. Returns structured report.",
    parameters: Type.Object({
      tier: Type.String({ description: "Tier/module name to test" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const task = `# Tester Task\n\nTier: ${params.tier}\nWrite and run tests for this tier. Check edge cases, error paths.\nWrite structured JSON report.`;
      const result = await spawnPiAgent("smn-tester", task, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || "(no test results)" }],
        details: result,
      };
    },
  });

  // ── somonnoy_spawn_frontend tool ──
  pi.registerTool({
    name: "somonnoy_spawn_frontend",
    label: "Spawn Frontend",
    description: "Spawn a Frontend Designer agent. Handles UI tasks — slick, fast, intuitive interfaces. Uses frontend-design skill.",
    parameters: Type.Object({
      file_path: Type.String({ description: "Path to the UI file to write" }),
      task: Type.String({ description: "UI implementation task description" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const task = `# Frontend Task\n\nFile: ${params.file_path}\nTask: ${params.task}\n\nWrite UI code to ${params.file_path}. Prioritize perceived performance, minimal cognitive load, clean visual hierarchy. Take screenshot if Playwright available.`;
      const result = await spawnPiAgent("smn-frontend", task, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || "(no output)" }],
        details: result,
      };
    },
  });

  // ── somonnoy_spawn_security tool ──
  pi.registerTool({
    name: "somonnoy_spawn_security",
    label: "Spawn Security",
    description: "Spawn a Security agent. Scans for vulnerabilities (Semgrep), exposed secrets (Trufflehog), and auth flaws. Read-only.",
    parameters: Type.Object({
      tier: Type.String({ description: "Tier/module name to scan" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const task = `# Security Scan\n\nTier: ${params.tier}\nScan integrated code for vulnerabilities, exposed secrets, auth flaws. Run Semgrep + Trufflehog if available. Write structured JSON report.`;
      const result = await spawnPiAgent("smn-security", task, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || "(no findings)" }],
        details: result,
      };
    },
  });

  // ── Session start: restore state ──
  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const lastResult = entries
      .filter((e: any) => e.type === "custom" && e.customType === `${SESSION_KEY}-result`)
      .pop() as any;

    if (lastResult?.data?.state && lastResult.data.state.phase !== "done") {
      state = lastResult.data.state;
      updateDashboard(ctx);
      ctx.ui.notify("🐘 Restored pi-somonnoy pipeline state", "info");
    }
  });

  // ── Session shutdown: cleanup ──
  pi.on("session_shutdown", async () => {
    state = null;
    dashboardWidget = null;
  });
}
