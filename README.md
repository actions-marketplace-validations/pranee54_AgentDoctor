# AgentDoctor

### Engineering Intelligence & Safety for AI Coding Agents

**Understand → Analyze → Govern → Change → Verify → Prove**

Understand your codebase, evaluate the impact of changes, govern engineering knowledge, enforce safety policies, and verify AI-generated changes with evidence.

[![npm](https://img.shields.io/npm/v/@praneeth_54/agentdoctor?label=npm)](https://www.npmjs.com/package/@praneeth_54/agentdoctor)
[![CI](https://img.shields.io/github/actions/workflow/status/pranee54/AgentDoctor/ci.yml?branch=main&label=CI)](https://github.com/pranee54/AgentDoctor/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/@praneeth_54/agentdoctor)](https://nodejs.org)
[![License](https://img.shields.io/github/license/pranee54/AgentDoctor)](LICENSE)

**Published:** [`@praneeth_54/agentdoctor@2.0.0`](https://www.npmjs.com/package/@praneeth_54/agentdoctor)

[Install](#install) · [Quickstart](#quickstart) · [Documentation](docs/2.0/README.md) · [MCP](#mcp) · [GitHub Action](#github-action) · [Architecture](#architecture)

---

## What AgentDoctor is

AgentDoctor sits between developers / AI coding agents and the repository’s engineering reality.

AI agents can write code quickly. The harder engineering problem is knowing whether a change is **correct, safe, compatible, explainable, and consistent** with the rest of the repository.

AgentDoctor collects repository signals — source structure, graphs, Git history, policies, knowledge, and verification evidence — so humans and agents can reason about changes with fewer unsupported assumptions.

It is **not** an autonomous coding agent, chatbot, or IDE interceptor. It does **not** guarantee correctness. It produces **evidence and controls** you can inspect.

**Short description:** Codebase intelligence, repository analysis, safety controls, and MCP tools for developers and engineering teams.

---

## Why AgentDoctor?

Modern AI coding agents can:

- read individual files
- generate and edit code
- run tests when asked

Repository-level context is usually fragmented across:

| Signal             | Typical location               |
| ------------------ | ------------------------------ |
| Source structure   | AST / imports / modules        |
| Dependencies       | manifests / lockfiles          |
| History            | Git                            |
| Architecture       | docs / conventions / inference |
| Tests              | test trees / naming heuristics |
| Policy             | CI rules / allowlists          |
| Decisions          | ADRs / RFCs / tribal knowledge |
| Secrets / exposure | config files / ignore rules    |

AgentDoctor brings those signals into one local toolchain around an AI-driven engineering change:

```text
Developer / AI Agent
        │
        ▼
   AgentDoctor
        │
┌───────────────────────────────┐
│ Repository Intelligence       │
│ AST / Graph / Git / Impact    │
├───────────────────────────────┤
│ Engineering Knowledge         │
│ Brain / Decisions / Provenance│
├───────────────────────────────┤
│ Safety & Policy               │
│ Scan / Fix / Enforce / Secrets│
├───────────────────────────────┤
│ Verification                  │
│ Tests / Reports / Evidence    │
└───────────────────────────────┘
        │
        ▼
Safer, explainable engineering decisions
```

---

## Capability map

Status labels: **SUPPORTED** · **PARTIAL** · **EXPERIMENTAL** · **NOT YET SUPPORTED**

Details and evidence: [docs/2.0/overview/capabilities.md](docs/2.0/overview/capabilities.md) · [readiness matrix](docs/2.0/overview/readiness-matrix.md)

### Repository intelligence

| Capability                                           | Status       |
| ---------------------------------------------------- | ------------ |
| TypeScript / JavaScript AST graph (+ regex fallback) | PARTIAL      |
| Import / inferred call relationships                 | PARTIAL      |
| Git hotspot / engineering intelligence               | PARTIAL      |
| Change / test / refactor impact                      | PARTIAL      |
| C4-style architecture views                          | EXPERIMENTAL |

### Engineering knowledge

| Capability                                                    | Status    |
| ------------------------------------------------------------- | --------- |
| Project Brain store + evidence-backed claims                  | SUPPORTED |
| Repository Brain init / proposal review (never auto-approved) | PARTIAL   |
| Governed knowledge + abstention on retrieve                   | PARTIAL   |
| Provenance envelopes on Brain MCP tools                       | SUPPORTED |

### Agent interfaces

| Capability                                                                        | Status    |
| --------------------------------------------------------------------------------- | --------- |
| Brain MCP (`brain_*` tools, STDIO)                                                | SUPPORTED |
| Combined MCP (Brain + intelligence tools)                                         | PARTIAL   |
| Agent adapters (Cursor, Claude Code, Codex, Copilot, Windsurf, Gemini CLI, Aider) | SUPPORTED |
| Local dashboard + `/api/v2/*`                                                     | PARTIAL   |
| Programmatic API (`scan`, Fix, Brain helpers)                                     | SUPPORTED |

### Safety & governance

| Capability                                               | Status                |
| -------------------------------------------------------- | --------------------- |
| Scan → Safe Fix → Verify                                 | SUPPORTED             |
| Policy gates (`--min-score`, severity, rule, verify-new) | SUPPORTED             |
| Evaluate-only policy / controlled enforcement runner     | PARTIAL               |
| Secret scan (redacted findings) + export redaction       | PARTIAL               |
| Path-safety for MCP / dashboard                          | PARTIAL               |
| Local-dev team auth (scrypt)                             | PARTIAL — **not SSO** |

### Verification

| Capability                                              | Status                     |
| ------------------------------------------------------- | -------------------------- |
| Unit / integration / MCP STDIO tests (`npm run verify`) | SUPPORTED                  |
| Packed CLI clean-install smoke                          | SUPPORTED                  |
| Reproducible AST perf harness                           | PARTIAL (synthetic sample) |

---

## How AgentDoctor is different

Most engineering tools optimize one layer: static analysis, search, docs generation, dashboards, security scanners, or AI chat.

AgentDoctor is designed around the **lifecycle of an AI-driven change**:

```text
Repository
    → Understand
    → Impact
    → Knowledge
    → Policy
    → Change
    → Verification
    → Evidence
```

That combination is the product direction. It does not mean every layer is equally mature — see the capability map and limitations.

---

## Architecture

```text
AgentDoctor
│
├── Repository Intelligence
│   ├── AST (TS/JS)
│   ├── Graph
│   ├── Git
│   └── Impact
│
├── Engineering Knowledge
│   ├── Brain
│   ├── Governance
│   └── Provenance
│
├── Safety
│   ├── Scanner
│   ├── Safe Fix
│   ├── Secrets
│   └── Policies
│
├── Agent Interface
│   ├── MCP (brain-mcp / mcp)
│   ├── CLI
│   ├── API / dashboard
│   └── Adapters
│
└── Verification
    ├── Tests
    ├── Reports
    └── Release validation
```

Code layout: `src/{intelligence,knowledge,core,mcp,platform,enforcement,cli}/`

Canonical docs: [docs/2.0/overview/architecture.md](docs/2.0/overview/architecture.md)

---

## Engineering principles

1. Evidence over assumptions
2. Explicit limitations over inflated claims
3. Safety before automation
4. Repository context over isolated files
5. Human approval for governed decisions
6. Backwards compatibility where documented
7. Reproducible verification
8. Explainable agent actions
9. Least privilege
10. Secure defaults

---

## Install

Requires **Node.js 20+**.

```bash
npm install -g @praneeth_54/agentdoctor
# or
npx @praneeth_54/agentdoctor@2.0.0 --help
```

From source:

```bash
git clone https://github.com/pranee54/AgentDoctor.git
cd AgentDoctor
npm install
npm run verify
```

---

## Quickstart

```bash
agentdoctor --version          # 2.0.0
agentdoctor scan .
agentdoctor scan . --json
agentdoctor fix --dry-run
agentdoctor verify --baseline agentdoctor-report.json

# Repository Brain proposals (not auto-approved)
agentdoctor init --name "My App" --domain "payments"
agentdoctor brain proposals

# Intelligence
agentdoctor graph --mode auto --json
agentdoctor impact --json
agentdoctor c4 --json

# MCP (absolute --root required)
agentdoctor brain-mcp --root /ABS/PATH/TO/REPO
agentdoctor mcp --root /ABS/PATH/TO/REPO
```

CLI reference: [docs/2.0/guides/cli.md](docs/2.0/guides/cli.md)

---

## MCP

AgentDoctor exposes local **STDIO** MCP servers (no API key).

| Server       | Command                              | Tools                                                                                                                                                               |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brain MCP    | `agentdoctor brain-mcp --root <abs>` | `brain_overview`, `brain_query`, `brain_explain`, `brain_trace`, `brain_claims`, `brain_evidence`, `brain_ownership`, `brain_risk`, `brain_delta`, `brain_snapshot` |
| Combined MCP | `agentdoctor mcp --root <abs>`       | All `brain_*` tools **plus** intelligence tools below                                                                                                               |

Intelligence tools (combined MCP):
`repo_overview`, `codebase_search`, `symbol_lookup`, `dependency_lookup`, `call_graph_lookup`, `test_impact`, `refactor_impact`, `code_health`, `architecture_info`, `knowledge_retrieve`, `policy_evaluate`

Guide: [docs/2.0/guides/mcp.md](docs/2.0/guides/mcp.md) · Deep Brain MCP: [docs/mcp/brain-mcp.md](docs/mcp/brain-mcp.md)

---

## GitHub Action

Use AgentDoctor Safety in CI for scan / verify gates. Default npm version input is **`2.0.0`**.

```yaml
- uses: pranee54/AgentDoctor@v2.0.0
  with:
    path: .
    version: "2.0.0"
    fail-on-severity: critical
```

For repository CI against the checked-out build: `version: workspace` (requires `dist/` from `npm run build`).

Guide: [docs/2.0/guides/github-action.md](docs/2.0/guides/github-action.md) · Action metadata: [`action.yml`](action.yml)

Marketplace listing: confirm in the GitHub UI if you need Marketplace discovery beyond the Action in this repository.

---

## Security model

| Control     | Behavior                                                                |
| ----------- | ----------------------------------------------------------------------- |
| Path safety | MCP / dashboard reject traversal, encoded escapes, hostile URLs         |
| Safe Fix    | Preflight targets; refuse symlink write-through / non-allowlisted paths |
| Secrets     | Opt-in scan; findings and exports redact sensitive patterns             |
| Policy      | Evaluate-only by default (`executionResult: "not-executed"`)            |
| Enforcement | Controlled runner blocks; does **not** claim IDE interception           |
| Dashboard   | Loopback by default; non-loopback requires explicit opt-in              |
| Team auth   | Local-dev scrypt only — **not** enterprise SSO                          |

Threat model: [docs/2.0/overview/security-threat-model.md](docs/2.0/overview/security-threat-model.md) · Trust boundaries: [docs/2.0/overview/trust-boundaries.md](docs/2.0/overview/trust-boundaries.md)

---

## What AgentDoctor does not do

- Enterprise SSO / IdP
- Complete multi-language AST (beyond TS/JS depth)
- Coverage-file-backed test selection as ground truth
- IDE / agent process interception
- Production multi-tenant cloud / managed hosting in this package
- Guaranteed autonomous command execution of “allowed” policies
- Treating inferred C4 / heuristic impact as approved architecture truth
- Shipping full `docs/2.0/` inside the npm tarball (Option B: README + GitHub docs)

Full list: [docs/2.0/overview/known-limitations.md](docs/2.0/overview/known-limitations.md)

---

## Roadmap / design direction: Change Proof

**PLANNED** — not a shipped runtime product.

A future “Change Proof” record could attach evidence to an AI-driven change: request, files/symbols, callers, tests, policies, ADRs, verification, and security results. Treat this as **design direction**, not a current CLI feature.

See [ROADMAP.md](ROADMAP.md).

---

## Documentation map

| Audience                               | Start here                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Product / 2.0                          | [docs/2.0/README.md](docs/2.0/README.md)                                                                |
| Capabilities / readiness               | [capabilities](docs/2.0/overview/capabilities.md) · [readiness](docs/2.0/overview/readiness-matrix.md)  |
| Guides                                 | [docs/2.0/guides/](docs/2.0/guides/)                                                                    |
| Reference (rules, scoring, exit codes) | [docs/reference/](docs/reference/)                                                                      |
| Contributing                           | [CONTRIBUTING.md](CONTRIBUTING.md) · [docs/development/development.md](docs/development/development.md) |
| Changelog                              | [CHANGELOG.md](CHANGELOG.md)                                                                            |
| Release evidence                       | [docs/2.0/release/final-release-report.md](docs/2.0/release/final-release-report.md)                    |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Prefer evidence-backed PRs, honest status labels, and no inflated capability claims.

---

## License

MIT — see [LICENSE](LICENSE).
