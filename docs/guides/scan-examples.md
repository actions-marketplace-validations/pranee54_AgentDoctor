# Scan examples

These examples use the checked-in fixtures, so they can be reproduced without
network access or real credentials. Run them from the repository root after
`npm run build`:

```sh
node dist/cli/index.js ./fixtures/<fixture>
# or, after install / ensure-cli-bin:
agentdoctor ./fixtures/<fixture>
```

A finding describes a repository condition; it is not a security certification.
Adapter coverage (detect vs Safe Fix): [surfaces-and-adapters.md](../reference/surfaces-and-adapters.md).

The examples below cover clean results, severity levels, limited mode (no AI
config), newer adapters, multi-agent repos, and Safe Fix dry-run behavior.

## Clean configured repository

```sh
node dist/cli/index.js ./fixtures/clean-configured-project
```

Expected summary (excerpt):

```text
AI Coding Agents
✓ Cursor       configured
✓ Claude Code  configured
✓ Codex        configured

Findings
  ✓ No findings
```

This fixture configures Cursor, Claude Code, and Codex. Other adapters (Copilot,
Windsurf, Gemini CLI, Aider) are absent here. A clean scan does not mean that
every possible risk has been checked.

## A. Repository with no AI-agent configuration (limited mode)

```sh
node dist/cli/index.js ./fixtures/no-agents-env
node dist/cli/index.js ./fixtures/no-agents-env --json
```

Expected terminal behavior:

```text
AI Coding Agents
– Cursor       not configured
– Claude Code  not configured
– Codex        not configured
– GitHub Copilot not configured
– Windsurf     not configured
– Gemini CLI   not configured
– Aider        not configured

Findings
  ! Agent-specific exposure checks are limited (no supported agent config); repository hygiene still applied.

CRITICAL
  ✗ … Sensitive environment file present in repository
    .env
```

JSON highlights:

```json
{
  "agentSecurityAnalysis": "limited",
  "findings": [
    {
      "ruleId": "security/env-file-exposure",
      "severity": "critical",
      "affectedAgents": []
    }
  ]
}
```

Limited mode is **not** “nothing to audit.” Universal repository hygiene still
runs (here: a critical `.env` finding). Agent-attributed exposure checks and
agent-readiness interpretation are limited until a supported agent config is
present. Terminal readiness may show `n/a`; numeric scores remain in JSON for
repository-risk findings only. See [scoring.md](../reference/scoring.md).

## B. GitHub Copilot (detection only)

```sh
node dist/cli/index.js ./fixtures/copilot-nested
node dist/cli/index.js ./fixtures/copilot-nested --json
```

This fixture detects:

- `.github/copilot-instructions.md` (repo instructions)
- Nested path instructions under `.github/instructions/*.instructions.md`

Example agent summary from JSON: configured Copilot with
`configPaths` including the root instructions file and two nested
`*.instructions.md` files; `agentSecurityAnalysis` is `full`.

Also useful:

```sh
node dist/cli/index.js ./fixtures/copilot-project   # configured
node dist/cli/index.js ./fixtures/copilot-empty     # detected, empty instructions
```

**Safe Fix:** GitHub Copilot has **no** official project-level deny/ignore writer
in AgentDoctor. `agentdoctor fix` will not invent one. When Copilot is an
affected agent on a safe-context finding, the fix plan **skips** with an
explicit reason (review instructions / `.gitignore` manually).

## C. Windsurf (detection only)

Supported repository-local detection paths:

| Path                    | Fixture                     |
| ----------------------- | --------------------------- |
| `.windsurf/rules/*.md`  | `fixtures/windsurf-project` |
| `.devin/rules/*.md`     | `fixtures/windsurf-devin`   |
| Legacy `.windsurfrules` | `fixtures/windsurf-legacy`  |

```sh
node dist/cli/index.js ./fixtures/windsurf-project
node dist/cli/index.js ./fixtures/windsurf-devin
node dist/cli/index.js ./fixtures/windsurf-legacy
```

Legacy scans may emit diagnostic `windsurf/legacy-rules` (prefer `.devin/rules/`
or `.windsurf/rules/`).

**Safe Fix:** intentionally **unsupported**. There is no official project-level
deny/ignore Fix writer for Windsurf. Fix plans skip Windsurf with an explicit
reason; AgentDoctor does not invent a writer.

## D. Gemini CLI (detection + `.geminiignore` Safe Fix)

```sh
node dist/cli/index.js ./fixtures/gemini-project
node dist/cli/index.js ./fixtures/gemini-project --json
```

Detection covers `GEMINI.md`, `.gemini/settings.json`, and `.geminiignore`
(when present). Edge fixtures: `gemini-malformed` (malformed settings
diagnostic), `gemini-empty-ignore` (empty ignore still counts as detected).

When Gemini CLI is configured and a **safe** context finding exists (for
example `context/generated-directory` for an unignored `build/`), Safe Fix may
propose appending patterns to **`.geminiignore`**. Preview without writing:

```sh
node dist/cli/index.js fix ./fixtures/<gemini-repo-with-safe-finding> --dry-run
```

The clean `gemini-project` fixture has no safe-context finding, so dry-run may
report “No automatic fixes available.” Writer behavior is covered in unit tests
and [surfaces-and-adapters.md](../reference/surfaces-and-adapters.md).

## E. Aider (detection + `.aiderignore` Safe Fix)

```sh
node dist/cli/index.js ./fixtures/aider-project
node dist/cli/index.js ./fixtures/aider-yaml-ext
node dist/cli/index.js ./fixtures/aider-conventions-only
```

- `aider-project`: `.aider.conf.yml`, `.aiderignore`, and `CONVENTIONS.md`
- `aider-yaml-ext`: `.aider.conf.yaml` extension
- `aider-conventions-only`: `CONVENTIONS.md` alone is **not** treated as Aider
  (avoids false positives)

When Aider is configured and a safe context finding exists, Safe Fix may append
patterns to **`.aiderignore`**. Use `fix --dry-run` to preview. Same note as
Gemini: a clean Aider fixture may have nothing for Fix to change.

## F. Safe Fix dry-run

Preview only (no writes):

```sh
node dist/cli/index.js fix ./fixtures/generated-root-unignored --dry-run
```

Example excerpt when Cursor is detected and `build/` is unignored:

```text
AgentDoctor fix (dry-run)

  Proposed actions: 1
    • [cursor] Exclude build from Cursor agent context via .cursorignore
      pattern: build/

  File changes:
    .cursorignore (+1 pattern(s))

  No files were modified (dry-run).
```

### What dry-run / apply protect

| Behavior               | Notes                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Supported writers      | `.cursorignore`, Claude Code Read deny, Codex filesystem deny, `.geminiignore`, `.aiderignore`                                                                                       |
| Unsupported            | Copilot and Windsurf — explicit skip reasons; no invented writers                                                                                                                    |
| Preflight              | All planned targets validated **before** any write                                                                                                                                   |
| Boundaries             | Targets must stay inside the repository realpath; allowlisted paths only                                                                                                             |
| Symlinks / directories | Symlink targets, symlink ancestor dirs, and directory targets are refused                                                                                                            |
| Partial apply          | After preflight, writes are still sequential; if a later writer fails, earlier files may already be updated (`partial` in apply result / terminal). There is no multi-file rollback. |

Apply for real only with an explicit confirmation path (`fix -y` / interactive). Prefer dry-run first. Details: [surfaces-and-adapters.md](../reference/surfaces-and-adapters.md), [compatibility.md](../reference/compatibility.md).

## Multi-agent repository

```sh
node dist/cli/index.js ./fixtures/multi-agent-project
node dist/cli/index.js ./fixtures/multi-agent-env-exposure
```

`multi-agent-project` configures Cursor, Claude Code, and Codex together (clean
scan in the current fixture). Compare with `multi-agent-env-exposure` for the
same multi-agent shape plus a critical env finding attributed to an agent.

When interpreting a multi-agent scan:

1. **Detection** — each adapter reports configured / absent independently.
2. **Universal hygiene** — env files, keys, logs, generated dirs, MCP shape, etc.
   can still fire with empty or partial `affectedAgents`.
3. **Safe Fix by agent** — only writers listed above can auto-fix safe context
   findings for that agent.
4. **Skips** — Copilot/Windsurf (and any agent without a writer) appear in the
   fix plan’s skipped list with reasons; detection does **not** imply automatic
   fix.

```sh
node dist/cli/index.js fix ./fixtures/multi-agent-project --dry-run
```

## Critical: environment file exposed to an agent

```sh
node dist/cli/index.js ./fixtures/multi-agent-env-exposure
```

The fixture contains a runtime `.env` and a Codex configuration without a
relevant exclusion. The result is one `security/env-file-exposure` critical
finding, affected agent `Codex`, with guidance to exclude the file and rotate
any credentials that may have been exposed. Security findings remain
review/manual — Safe Fix does not rewrite `.env` files.

## Critical: credential-like filenames

```sh
node dist/cli/index.js ./fixtures/credential-files-project
```

The result reports three `security/private-key-file` critical findings for
`app-signing.der`, `app-signing.pem`, and `my-service-account.json`. The
fixture uses marker text only; AgentDoctor reports filenames and never prints
the fixture contents as secret evidence.

## Warning: stale instruction paths

```sh
node dist/cli/index.js ./fixtures/nested-missing-path
```

The Cursor rule references two files that do not exist. The result contains two
`instructions/missing-path-reference` warnings and identifies the rule file and
missing paths so the author can correct or remove the references.

## Critical: broad MCP filesystem scope

```sh
node dist/cli/index.js ./fixtures/mcp-project
```

The Cursor MCP configuration points its filesystem server at `/`. AgentDoctor
reports one `security/mcp-broad-filesystem` critical finding and recommends
scoping the server to the repository instead of a root or home directory.

## Informational: generated output without an ignore rule

```sh
node dist/cli/index.js ./fixtures/generated-nested-unignored
```

The `apps/build/` directory is reported as one
`context/generated-directory` informational finding. This is not a secret
finding: it helps a repository decide whether generated output should be
excluded from an agent's context.

## JSON output for automation

Every example can be consumed without terminal formatting:

```sh
node dist/cli/index.js ./fixtures/multi-agent-env-exposure --json
node dist/cli/index.js ./fixtures/no-agents-env --json
```

The JSON result preserves stable rule IDs, severities, affected agents,
`agentSecurityAnalysis`, and evidence paths for CI annotations or downstream
reporting.
