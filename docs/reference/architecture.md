# Architecture

AgentDoctor is a CLI-first, local-first auditor for AI coding agent configuration.

## Pipeline

```text
Discovery
   │  bounded walk · ignore heavy dirs · size limits
   ▼
Project detection
   │  language · framework · package manager · monorepo
   ▼
Agent adapters
   │  pluggable registry (Cursor · Claude Code · Codex · …)
   ▼
Rule engine
   │  shared RuleContext · registered rules · no terminal coupling
   ▼
Findings
   │  deterministic IDs · cross-agent dedupe · fixability metadata
   ▼
Reporters
      terminal (human) · JSON (CI / machines)
```

Scoring and automatic fixes are separate pipeline stages after findings.

## Package layout

```text
src/
  cli/           command parsing and process exit codes
  agents/        adapter interface + registry + detectors
  core/
    scanner/     public scan() orchestration
    rules/       rule types, runner, security/context/instructions/mcp
    mcp/         project MCP config parsing (no execution)
    scoring/     readiness scoring
    fix/         safe fix plan + apply (Cursor / Claude / Codex / Gemini / Aider writers)
    policy/      CI policy evaluation (CLI + Action)
  detectors/     repository fingerprinting
  discovery/     filesystem walk
  reporters/     terminal + JSON (+ GitHub summary/annotations)
  security/      redaction / sanitization helpers
  types/         shared contracts
  index.ts       programmatic API
```

## AgentDoctor 2.0 platform layer

Local-first modules under `src/platform/` extend Safety/Brain with repository
graph intelligence, code-health heuristics, an evaluate-only **Action Policy
Evaluator** (CLI: `platform policy-check`, compatibility alias `firewall-check` —
no commands executed and no agents intercepted), session audit, provenance,
context-security (evidence secret-redacted), knowledge governance, first-class
test-impact analysis (`platform test-impact` + snapshot/API/report), architecture
drift, time-machine diffs, refactor impact analysis, token planning, readiness
scorecards, and report exports.

Persistence: `.agentdoctor/platform/` (JSON). See
[AGENTDOCTOR_2.0_IMPLEMENTATION_REPORT.md](../2.0/reports/implementation-report.md)
and [AGENTDOCTOR_2.0_POST_AUDIT_HARDENING_REPORT.md](../2.0/audits/post-audit-hardening.md).

CLI entry: `agentdoctor platform …`

Dashboard binds to loopback by default; non-loopback requires `--allow-non-loopback`.
Local `?user=` roles are not authentication.

1. **Zero config** for first use
2. **Useful offline** — no API key for core features
3. **Local-first / privacy-first** — no default upload
4. **Never modify files** unless the user runs `fix` (or calls `applyFixPlan`)
5. **Every finding explains why** and, when possible, what to do
6. **Adapters over hardcoding** — new agents register without rewriting the scanner
7. **Minimal dependencies**
8. **Strict TypeScript**

## Public API

```ts
import { scan, verify, buildFixPlan, applyFixPlan } from "@praneeth_54/agentdoctor";

const result = await scan({ cwd: process.cwd() });
```

Scanning must not depend on terminal formatting.

## CLI surface

```text
agentdoctor [path]
agentdoctor scan [path]
agentdoctor fix [path]
agentdoctor verify [path]
agentdoctor explain <rule>
agentdoctor doctor
agentdoctor brain-mcp --root <path>
agentdoctor --json
agentdoctor --ci
agentdoctor --min-score <n>
agentdoctor --fail-on-severity <level>
agentdoctor --fail-on-rule <id>
agentdoctor --verbose
agentdoctor --version
agentdoctor --help
```

Surfaces (CLI · GitHub Action · Project Brain · MCP) and per-agent detect/Safe Fix matrix:
[surfaces-and-adapters.md](surfaces-and-adapters.md). Fixture walkthroughs: [scan-examples.md](../guides/scan-examples.md).

## Related docs

- [Rules catalog](rules.md)
- [Exit codes](exit-codes.md)
- [Surfaces and adapters](surfaces-and-adapters.md)
- [Development](../development/development.md)
- [Roadmap](../../ROADMAP.md)
