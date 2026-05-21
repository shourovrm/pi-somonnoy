/**
 * pi-somonnoy — Multi-Agent Coding Orchestration Extension
 *
 * LLM-orchestrated pipeline: PRD → Brainstorm → Design → Plan → Implement → Review
 * The LLM calls somonnoy_spawn_* tools. Each spawns an isolated pi subprocess.
 * Results return to chat. LLM decides next step — no hard-coded pipeline.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ── Extension directory (ESM-safe __dirname equivalent) ──
const EXT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

interface AgentConfig {
  name: string;
  description: string;
  tools: string[];
  skills: string[];
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

// ═══════════════════════════════════════════
// Model & Agent Config
// ═══════════════════════════════════════════

const DEFAULT_MODEL = "opencode-go/deepseek-v4-pro";

const AGENT_MODELS: Record<string, string> = {
  "smn-planner": "opencode-go/glm-5.1",
  "smn-integrator": "opencode-go/glm-5.1",
  "smn-security": "opencode-go/glm-5.1",
  "smn-coder": "opencode-go/qwen3.6-plus",
  "smn-tester": "opencode-go/qwen3.6-plus",
  "smn-frontend": "opencode-go/kimi-k2.6",
  "smn-reviewer": "opencode-go/kimi-k2.6",
  "smn-scout": "opencode-go/deepseek-v4-flash",
};

const AGENT_CONFIGS: Record<string, AgentConfig> = {
  "smn-planner": {
    name: "smn-planner",
    description: "Produces PRD, design, plan, task specs. Writes structured documents.",
    tools: ["read", "write", "bash", "grep", "find"],
    skills: ["brainstorming"],
    timeout: 600_000,
  },
  "smn-scout": {
    name: "smn-scout",
    description: "Stateless research agent. Searches web/docs, returns structured findings.",
    tools: ["read", "write", "bash", "web_search", "web_fetch"],
    skills: ["brave-search"],
    timeout: 120_000,
  },
  "smn-coder": {
    name: "smn-coder",
    description: "Leaf agent. One file per invocation. KISS, Unix philosophy, max reuse.",
    tools: ["read", "write", "edit", "bash", "grep", "context7_get_library_docs"],
    skills: [],
    timeout: 300_000,
  },
  "smn-integrator": {
    name: "smn-integrator",
    description: "Assembles Coder outputs per tier. Runs build check, flags duplication.",
    tools: ["read", "write", "bash", "grep", "find"],
    skills: [],
    timeout: 300_000,
  },
  "smn-reviewer": {
    name: "smn-reviewer",
    description: "Checks integrated tier output. Enforces contracts, KISS, naming, error handling.",
    tools: ["read", "write", "bash", "grep"],
    skills: ["caveman"],
    timeout: 300_000,
  },
  "smn-tester": {
    name: "smn-tester",
    description: "Writes and runs tests per tier. Structured failure reports.",
    tools: ["read", "write", "edit", "bash", "grep"],
    skills: ["caveman"],
    timeout: 300_000,
  },
  "smn-frontend": {
    name: "smn-frontend",
    description: "Handles UI tasks. Slick, fast, intuitive interfaces.",
    tools: ["read", "write", "edit", "bash", "grep", "context7_get_library_docs"],
    skills: ["frontend-design"],
    timeout: 300_000,
  },
  "smn-security": {
    name: "smn-security",
    description: "Scans for vulnerabilities, auth flaws, exposed secrets. Read-only.",
    tools: ["read", "bash", "grep"],
    skills: [],
    timeout: 300_000,
  },
};

// ═══════════════════════════════════════════
// Skill Loader
// ═══════════════════════════════════════════

function loadSkillFile(agentType: string): string {
  const cleanName = agentType.replace(/^smn-/, "");
  const skillPath = path.join(EXT_DIR, "skills", `somonnoy-${cleanName}`, "SKILL.md");
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

  // MCP capability flags
  const caps = buildCapabilityFlags(agentType);

  return `${skillContent}

## Available Capabilities
${Object.entries(caps).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

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
      flags.brave_search_skill = true;
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
  const agentModel = AGENT_MODELS[agentType] ?? model;

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
// Extension Entry
// ═══════════════════════════════════════════

export default function (pi: ExtensionAPI) {

  // ── somonnoy_propose tool ──
  pi.registerTool({
    name: "somonnoy_propose",
    label: "Propose Somonnoy",
    description: "Suggest using pi-somonnoy multi-agent orchestration when the user's request requires multi-file, multi-module implementation. Also provides pipeline instructions.",
    promptSnippet: "Propose pi-somonnoy multi-agent orchestration for complex multi-file projects",
    promptGuidelines: [
      "Use somonnoy_propose when the user requests a project requiring 3+ source files across multiple modules.",
      "After proposing, follow the pipeline order: Planner → Scout (if needed) → Coder → Integrator → Security → Reviewer → Tester.",
      "Pipeline order: 1) somonnoy_spawn_planner (PRD → DESIGN → PLAN), 2) somonnoy_spawn_scout (research unfamiliar deps), 3) somonnoy_spawn_coder or somonnoy_spawn_frontend per file, 4) somonnoy_spawn_integrator per tier, 5) somonnoy_spawn_security per tier, 6) somonnoy_spawn_reviewer per tier, 7) somonnoy_spawn_tester per tier.",
      "Read PLAN.md after planner completes to determine tiers and file assignments. Each tier has multiple files; spawn one coder per file.",
      "For UI files (.tsx, .jsx, .css, .vue, .svelte, or paths under components/, pages/, views/), use somonnoy_spawn_frontend instead of somonnoy_spawn_coder.",
      "After reviewer and tester both pass for a tier, git commit the tier with a conventional commit message.",
      "If reviewer or tester fails, fix issues by spawning another coder, then re-review/re-test.",
    ],
    parameters: Type.Object({
      reason: Type.String({ description: "Why orchestration would help (multi-file, multi-tier, etc.)" }),
      estimated_files: Type.Optional(Type.Number({ description: "Estimated number of source files needed" })),
    }),
    async execute(_toolCallId, params) {
      const msg = params.estimated_files
        ? `🐘 This looks like a ${params.estimated_files}+ file project. I'll use pi-somonnoy orchestration — structured PRD→Plan→Implement→Review pipeline.\n\n**Pipeline:** Planner → Scout (if needed) → Coder/Frontend → Integrator → Security → Reviewer → Tester\n**Agents:** 8 specialized agents, each an isolated pi subprocess with a dedicated model.`
        : `🐘 pi-somonnoy orchestration available for this multi-file project.`;
      pi.sendMessage({ customType: "somonnoy-propose", content: msg, display: true }, { triggerTurn: false });
      return { content: [{ type: "text", text: msg }], details: {} };
    },
  });

  // ── somonnoy_spawn_planner tool ──
  pi.registerTool({
    name: "somonnoy_spawn_planner",
    label: "Spawn Planner",
    description: "Spawn a Planner agent to produce PRD, design, plan, or task specs. Use first in the pipeline. Model: glm-5.1.",
    parameters: Type.Object({
      task: Type.String({ description: "Task description for the planner" }),
      output_file: Type.Optional(Type.String({ description: "Where to write output (e.g., PRD.md, DESIGN.md, PLAN.md)" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const result = await spawnPiAgent("smn-planner", params.task, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || result.error || "(no output)" }],
        details: { agent: result.agent, exitCode: result.exitCode, duration: result.duration },
      };
    },
  });

  // ── somonnoy_spawn_scout tool ──
  pi.registerTool({
    name: "somonnoy_spawn_scout",
    label: "Spawn Scout",
    description: "Spawn a Scout agent for web/docs research. Returns structured findings. Use when unfamiliar dependencies are needed. Model: deepseek-v4-flash.",
    parameters: Type.Object({
      query: Type.String({ description: "Research query or topic" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const result = await spawnPiAgent("smn-scout", `Research: ${params.query}`, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || "(no results)" }],
        details: { agent: result.agent, exitCode: result.exitCode, duration: result.duration },
      };
    },
  });

  // ── somonnoy_spawn_coder tool ──
  pi.registerTool({
    name: "somonnoy_spawn_coder",
    label: "Spawn Coder",
    description: "Spawn a Coder agent to implement a single file. KISS, Unix philosophy, max reuse. Model: qwen3.6-plus.",
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
        details: { agent: result.agent, exitCode: result.exitCode, duration: result.duration },
      };
    },
  });

  // ── somonnoy_spawn_integrator tool ──
  pi.registerTool({
    name: "somonnoy_spawn_integrator",
    label: "Spawn Integrator",
    description: "Spawn an Integrator agent to assemble coder outputs per tier, run build check, flag duplication. Model: glm-5.1.",
    parameters: Type.Object({
      tier: Type.String({ description: "Tier/module name to integrate" }),
      files: Type.String({ description: "Comma-separated list of file paths to integrate" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const files = params.files.split(",").map(f => f.trim()).map(f => `- ${f}`).join("\n");
      const task = `# Integrator Task\n\nTier: ${params.tier}\nAssemble all coder + frontend outputs for this tier. Run build check (tsc --noEmit or equivalent). Flag code duplication. Write status report to reports/integrator-${params.tier}.json.\n\nFiles to integrate:\n${files}`;
      const result = await spawnPiAgent("smn-integrator", task, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || result.error || "(no output)" }],
        details: { agent: result.agent, exitCode: result.exitCode, duration: result.duration },
      };
    },
  });

  // ── somonnoy_spawn_reviewer tool ──
  pi.registerTool({
    name: "somonnoy_spawn_reviewer",
    label: "Spawn Reviewer",
    description: "Spawn a Reviewer agent. Checks contracts, KISS, naming, error handling. Returns structured report. Model: kimi-k2.6.",
    parameters: Type.Object({
      tier: Type.String({ description: "Tier/module name to review" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const task = `# Reviewer Task\n\nTier: ${params.tier}\nReview integrated code. Check: interface contracts, error handling, KISS, algorithm efficiency, naming, code reuse.\nWrite structured report to reports/reviewer-${params.tier}.json`;
      const result = await spawnPiAgent("smn-reviewer", task, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || "(no findings)" }],
        details: { agent: result.agent, exitCode: result.exitCode, duration: result.duration },
      };
    },
  });

  // ── somonnoy_spawn_tester tool ──
  pi.registerTool({
    name: "somonnoy_spawn_tester",
    label: "Spawn Tester",
    description: "Spawn a Tester agent. Writes and runs tests. Returns structured report. Model: qwen3.6-plus.",
    parameters: Type.Object({
      tier: Type.String({ description: "Tier/module name to test" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const task = `# Tester Task\n\nTier: ${params.tier}\nWrite and run tests for this tier. Check edge cases, error paths.\nWrite structured report to reports/tester-${params.tier}.json`;
      const result = await spawnPiAgent("smn-tester", task, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || "(no test results)" }],
        details: { agent: result.agent, exitCode: result.exitCode, duration: result.duration },
      };
    },
  });

  // ── somonnoy_spawn_frontend tool ──
  pi.registerTool({
    name: "somonnoy_spawn_frontend",
    label: "Spawn Frontend",
    description: "Spawn a Frontend Designer agent. Handles UI tasks — slick, fast, intuitive interfaces. Uses frontend-design skill. Model: kimi-k2.6.",
    parameters: Type.Object({
      file_path: Type.String({ description: "Path to the UI file to write" }),
      task: Type.String({ description: "UI implementation task description" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const task = `# Frontend Task\n\nFile: ${params.file_path}\nTask: ${params.task}\n\nWrite UI code to ${params.file_path}. Prioritize perceived performance, minimal cognitive load, clean visual hierarchy. Take screenshot if Playwright available.`;
      const result = await spawnPiAgent("smn-frontend", task, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || result.error || "(no output)" }],
        details: { agent: result.agent, exitCode: result.exitCode, duration: result.duration },
      };
    },
  });

  // ── somonnoy_spawn_security tool ──
  pi.registerTool({
    name: "somonnoy_spawn_security",
    label: "Spawn Security",
    description: "Spawn a Security agent. Scans for vulnerabilities (Semgrep), exposed secrets (Trufflehog), and auth flaws. Read-only. Model: glm-5.1.",
    parameters: Type.Object({
      tier: Type.String({ description: "Tier/module name to scan" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const task = `# Security Scan\n\nTier: ${params.tier}\nScan integrated code for vulnerabilities, exposed secrets, auth flaws. Run Semgrep + Trufflehog if available. Write structured JSON report to reports/security-${params.tier}.json.`;
      const result = await spawnPiAgent("smn-security", task, process.cwd(), DEFAULT_MODEL, signal,
        onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }] }) : undefined);
      return {
        content: [{ type: "text", text: result.output || "(no findings)" }],
        details: { agent: result.agent, exitCode: result.exitCode, duration: result.duration },
      };
    },
  });
}
