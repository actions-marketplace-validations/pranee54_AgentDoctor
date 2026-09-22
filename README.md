# AgentDoctor

**Codebase intelligence for developers, agents, and engineering teams.**

Local-first tooling that helps you understand a repository, keep AI coding agents safer, and query evidence-backed project knowledge — without requiring a cloud account or API key.

[![npm](https://img.shields.io/npm/v/@praneeth_54/agentdoctor?label=npm)](https://www.npmjs.com/package/@praneeth_54/agentdoctor)
[![CI](https://img.shields.io/github/actions/workflow/status/pranee54/AgentDoctor/ci.yml?branch=main&label=CI)](https://github.com/pranee54/AgentDoctor/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/@praneeth_54/agentdoctor)](https://nodejs.org)
[![License](https://img.shields.io/github/license/pranee54/AgentDoctor)](LICENSE)

**Published package:** `@praneeth_54/agentdoctor@`**2.0.0**

[Documentation index](docs/README.md) · [AgentDoctor 2.0 docs](docs/2.0/README.md) · [Known limitations](docs/2.0/overview/known-limitations.md) · [Readiness matrix](docs/2.0/overview/readiness-matrix.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

---

## What AgentDoctor does

AgentDoctor combines three complementary layers:

1. **Safety** — audit and safely fix AI coding-agent configuration (scan → fix → verify → policy → CI).
2. **Repository Brain** — evidence-backed claims, proposals, human review, and Project Brain MCP tools.
3. **Codebase intelligence** — TypeScript/JavaScript AST graphs, git hotspots, impact analysis, knowledge governance, evaluate-only policy, and a combined MCP server.

It is **not** an autonomous coding agent, chatbot, or IDE process interceptor. It does **not** block Cursor/Claude/Codex unless you deliberately run commands through AgentDoctor’s controlled runner.

---

## Install

```bash
npm install -g @praneeth_54/agentdoctor
# or
npx @praneeth_54/agentdoctor --help
```

Requires **Node.js 20+**. The runtime depends on the TypeScript compiler API for AST analysis.

---

## Quick start

```bash
# Safety loop
agentdoctor scan
agentdoctor fix --dry-run
agentdoctor verify --baseline agentdoctor-report.json

# Repository Brain proposals (never auto-approved)
agentdoctor init --name "My App" --domain "payments"
agentdoctor brain proposals
agentdoctor brain review --artifact <id> --decision approved

# Intelligence
agentdoctor graph --mode auto --json
agentdoctor health --json
agentdoctor c4 --json
agentdoctor impact --json
agentdoctor refactor-impact --symbol MySymbol --json

# Knowledge (draft → human approve)
agentdoctor knowledge-create --title "Standard" --content "…"
agentdoctor knowledge-approve --id <id> --decision approved

# Policy (evaluate-only by default)
agentdoctor enforce --command "npm test" --json

# MCP (Brain tools preserved; combined server adds intelligence tools)
agentdoctor brain-mcp --root /ABS/PATH/TO/REPO
agentdoctor mcp --root /ABS/PATH/TO/REPO

# Local dashboard (loopback)
agentdoctor dashboard
```

---

## Capability status (honest)

Classifications match [docs/2.0/overview/readiness-matrix.md](docs/2.0/overview/readiness-matrix.md). **No blanket 5/5 claims.**

### Fully verified (shipped & regression-tested core)

| Capability                                                                        | Notes                                                      |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Safety scan / Safe Fix / verify / policy gates                                    | Exit codes and CI Action preserved                         |
| Agent adapters (Cursor, Claude Code, Codex, Copilot, Windsurf, Gemini CLI, Aider) | Detect + rules; Safe Fix where official ignore/deny exists |
| Project Brain store + Brain MCP tool names (`brain_*`)                            | STDIO MCP; `--root` required                               |

### Partially validated (implemented, tested; accuracy/perf not independently certified)

| Capability                                      | Entry points                                |
| ----------------------------------------------- | ------------------------------------------- |
| Repository Brain init / proposal review         | `init`, `brain review`, `brain proposals`   |
| TS/JS AST intelligence graph (+ regex fallback) | `graph`                                     |
| Git hotspots / bus-factor style metrics         | `health` (method disclosed per metric)      |
| Impact / test-impact / refactor-impact          | `impact`, `test-impact`, `refactor-impact`  |
| Knowledge governance + abstention               | `knowledge*`; MCP `knowledge_retrieve`      |
| Policy packs + controlled enforcement runner    | `enforce`, `platform policy-check`          |
| Combined MCP (`agentdoctor mcp`)                | Brain + intelligence tools                  |
| Dashboard + `/api/v2/*`                         | `dashboard` (loopback default)              |
| Local-dev team auth (scrypt)                    | `team-register`, `team-login` — **not SSO** |

### Experimental

| Capability     | Notes                                                                             |
| -------------- | --------------------------------------------------------------------------------- |
| C4-style views | `c4` — **inferred/proposed** from graph evidence, not approved architecture truth |

### Unsupported / not claimed

| Topic                                            | Status                                             |
| ------------------------------------------------ | -------------------------------------------------- |
| Enterprise SSO / IdP                             | Not bundled                                        |
| Production SQLite / Postgres / vector search     | Flags off / stub only                              |
| Full multi-language AST (Python, Go, …)          | Unsupported                                        |
| Direct IDE interception / agent process blocking | Unsupported                                        |
| Coverage-backed test selection as ground truth   | Not bundled (test-impact is heuristic/graph-based) |

---

## Safety (preserved)

Scan agent configs and repository hygiene; apply Safe Fix where supported; verify against a baseline; fail CI on severity/score gates.

```bash
agentdoctor scan --json
agentdoctor fix -y
agentdoctor verify --baseline agentdoctor-report.json
```

GitHub Action: pin `pranee54/AgentDoctor@v2.0.0` (default npm version input is `2.0.0`). Surfaces matrix: [docs/reference/surfaces-and-adapters.md](docs/reference/surfaces-and-adapters.md).

```yaml
- uses: pranee54/AgentDoctor@v2.0.0
  with:
    path: .
    version: "2.0.0"
```

---

## Repository Brain

`agentdoctor init` writes **PROPOSED** artifacts under `.agentdoctor/repository-brain/proposals/`. They are **not** facts until a human reviews them.

```bash
agentdoctor brain init
agentdoctor brain snapshot
agentdoctor brain review --artifact prop_… --decision approved|rejected
```

Guide: [docs/2.0/guides/repository-brain.md](docs/2.0/guides/repository-brain.md).

---

## Codebase intelligence

- **AST graph** — TypeScript/JavaScript via the TypeScript compiler API; regex fallback when needed (`graph --mode auto|typescript-ast|regex`).
- **Git intelligence** — recent-window hotspots / co-change heuristics with method disclosure (`health`).
- **C4 views** — inferred diagrams (`c4`); label them proposed/inferred.
- **Impact** — change/test/refactor blast-radius helpers (`impact`, `refactor-impact`).

Limitations: call resolution is best-effort; non-TS languages are not deeply analyzed.

---

## Knowledge governance

Draft → pending-review → approved/rejected. Retrieval **abstains** when no approved record matches.

Guide: [docs/2.0/guides/knowledge-governance.md](docs/2.0/guides/knowledge-governance.md).

---

## Policy evaluation and controlled enforcement

| Mode                                                               | Behavior                                                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Policy evaluation (`platform policy-check`, MCP `policy_evaluate`) | Verdict only; `executionResult: "not-executed"`                                           |
| Controlled runner (`enforce`)                                      | Can report `blocked-by-enforcement` when **AgentDoctor** refuses to run a blocked command |
| Third-party IDEs                                                   | **Not** intercepted                                                                       |

Trust boundaries: [docs/2.0/overview/trust-boundaries.md](docs/2.0/overview/trust-boundaries.md).

---

## MCP

| Command                               | Server     | Tools                      |
| ------------------------------------- | ---------- | -------------------------- |
| `agentdoctor brain-mcp --root <path>` | Brain only | Stable `brain_*` names     |
| `agentdoctor mcp --root <path>`       | Combined   | Brain + intelligence tools |

MCP docs: [docs/2.0/guides/mcp.md](docs/2.0/guides/mcp.md) · legacy detail: [docs/mcp/brain-mcp.md](docs/mcp/brain-mcp.md).

---

## CLI / API / dashboard

- CLI index: [docs/2.0/guides/cli.md](docs/2.0/guides/cli.md)
- HTTP API (local dashboard): [docs/2.0/guides/api.md](docs/2.0/guides/api.md)
- Dashboard defaults to `127.0.0.1`; `?user=` role selection is **not** authentication

```bash
agentdoctor dashboard
agentdoctor doctor --json
```

---

## Local-development team authentication

```bash
agentdoctor team-register --username alice --password '………'
agentdoctor team-login --username alice --password '………'
```

This is **local-dev scrypt auth**, clearly labeled — **not** enterprise SSO.

---

## Important limitations (read before adopting)

1. AST depth is **TypeScript/JavaScript**-oriented.
2. Test-impact is **heuristic / graph-based**, not coverage-oracle accurate.
3. C4 views are **inferred**, not approved architecture.
4. Firewall is **evaluate-only** unless you use AgentDoctor’s controlled runner.
5. Team auth is **local-dev**, not SSO.
6. No IDE interception.
7. No production SQLite/Postgres/vector backend in this package.
8. No complete multi-language AST.
9. Deep 2.0 audits and readiness reports live on GitHub under [docs/2.0/](docs/2.0/README.md) (not inside the npm tarball — packaging Option B).

Full list: [docs/2.0/overview/known-limitations.md](docs/2.0/overview/known-limitations.md).

---

## Compatibility

- Safety CLI exit codes and Brain MCP tool names are preserved.
- Additive 2.0 commands do not remove 1.x workflows.
- Migration notes: [docs/2.0/guides/migration.md](docs/2.0/guides/migration.md).

---

## Documentation map

| Area             | Link                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| 2.0 index        | [docs/2.0/README.md](docs/2.0/README.md)                                   |
| CLI / MCP / API  | [docs/2.0/guides/](docs/2.0/guides/)                                       |
| Release blockers | [docs/2.0/audits/release-blockers.md](docs/2.0/audits/release-blockers.md) |
| Docs hub         | [docs/README.md](docs/README.md)                                           |
| Changelog        | [CHANGELOG.md](CHANGELOG.md)                                               |
| Contributing     | [CONTRIBUTING.md](CONTRIBUTING.md)                                         |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/development/development.md](docs/development/development.md).

---

## License

MIT — see [LICENSE](LICENSE).
