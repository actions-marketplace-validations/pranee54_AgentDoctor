# Surfaces and adapters

AgentDoctor helps **any repository**, with or without AI tooling.

## Surfaces (how you run it)

| Surface           | Entry                                               | Role                                   |
| ----------------- | --------------------------------------------------- | -------------------------------------- |
| CLI               | `npx @praneeth_54/agentdoctor` / `agentdoctor scan` | Local Scan → Fix → Verify              |
| GitHub Action     | `AgentDoctor Safety` composite action               | CI policy / score gates                |
| Project Brain MCP | STDIO MCP (`brain_*` tools)                         | Agent-consumable project understanding |

Surfaces share the same scan engine. MCP does not replace Safety; it exposes Project Brain alongside it.

## Analysis layers

```text
CLI / Action / MCP
        │
        ▼
 Universal repo hygiene  (env files, keys, logs, generated dirs, MCP shape, …)
        │
        ▼
 Agent adapters  (detect config → attribute exposure → optional Safe Fix)
```

| Layer             | Always on?           | Notes                                                                                                          |
| ----------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Universal hygiene | Yes                  | Findings may have empty `affectedAgents` when no supported agent is present (`agentSecurityAnalysis: limited`) |
| Agent adapters    | When config detected | Sets `agentSecurityAnalysis: full`; enables agent-attributed findings and (where implemented) Safe Fix         |

Limited mode is **not** “nothing to audit” — hygiene still runs; agent-readiness scores are not treated as meaningful until a supported agent is configured.

## Supported agent adapters

| Agent          | Detect                                                                         | Empty / large instructions | Safe Fix writer                             |
| -------------- | ------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------- |
| Cursor         | `.cursor/`, `.cursorrules`, …                                                  | Yes                        | `.cursorignore`                             |
| Claude Code    | `CLAUDE.md`, `.claude/`, …                                                     | Yes                        | Read deny in `.claude/settings.json`        |
| Codex          | `AGENTS.md`, `.codex/config.toml`, …                                           | Yes                        | Filesystem deny in `.codex/config.toml`     |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md` | Yes                        | None (no official project deny/ignore file) |
| Windsurf       | `.windsurf/rules/`, `.devin/rules/`, `.windsurfrules`                          | Yes                        | None (no official project deny/ignore file) |
| Gemini CLI     | `GEMINI.md`, `.gemini/settings.json`, `.geminiignore`                          | Yes                        | `.geminiignore`                             |
| Aider          | `.aider.conf.yml`, `.aiderignore`, `CONVENTIONS.md` (with Aider config)        | Yes                        | `.aiderignore`                              |

Detection is **repository-local only** (no home-directory agent config).

## Safe Fix behavior

Supported writers run after a **preflight** that:

- allowlists only the five Fix target paths above
- refuses symlink targets and symlink ancestor directories
- refuses directory targets (expects a regular file)
- keeps every write inside the repository realpath

Writes still apply **sequentially**. If a later writer fails after an earlier success, AgentDoctor reports `partial: true`, the failed target, and the error. There is no multi-file rollback. Prefer `agentdoctor fix --dry-run` to preview.

### Codex empty configuration

When Codex is detected and `.codex/config.toml` is missing or empty, Safe Fix may create an `agentdoctor_context` permissions profile and set `default_permissions` to that profile so filesystem deny keys can be applied. Unrelated existing TOML is preserved when present. Writes are idempotent for the same deny keys. AgentDoctor does not invent undocumented Codex semantics beyond this project-local deny merge.

## Related docs

- [architecture.md](architecture.md) — scan pipeline
- [rules.md](rules.md) — rule IDs and severity
- [scoring.md](scoring.md) — readiness scores and limited analysis
- [scan-examples.md](../guides/scan-examples.md) — fixture-backed scan and fix dry-run walkthroughs
- [compatibility.md](compatibility.md) — Fix surface promises and limitations
- [mcp/brain-mcp.md](../mcp/brain-mcp.md) — Project Brain MCP
