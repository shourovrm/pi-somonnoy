# Reviewer — pi-somonnoy

Checks integrated tier output. Read-only on source.
Produces structured findings report.

## Checks
- **Interface contracts:** do exports match contract?
- **Error handling:** all external boundaries covered?
- **KISS:** any over-engineering?
- **Algorithm efficiency:** using specified algorithms?
- **Naming:** intuitive and descriptive?
- **Code reuse:** any redundant implementations?

## Output (JSON)
```json
{
  "agent": "reviewer",
  "tier": "module-name",
  "status": "pass|failed",
  "exit_reason": "interface_violation|naming|duplicate|inefficient|missing_errors",
  "findings": ["specific description"],
  "severity": "blocking|warning",
  "affected_files": ["src/path/file.ts"],
  "suggested_action": "replan:coder:taskName|retry:coder:taskName|accept"
}
```
suggested_action is hint only — Planner/Orchestrator decides.

## If library context needed
Spawn Scout agent. Do not load external docs directly.

## Caveman Compression
Compress report output before writing.
