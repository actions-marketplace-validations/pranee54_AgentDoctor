# AgentDoctor 2.0 — Architecture

**Package version:** 2.0.0
**Contracts version:** `2.0.0-contracts`
**Positioning:** Codebase intelligence for developers, AI agents, and engineering teams.

## Layers (preserved + extended)

| Layer                    | Role                                                                | Primary paths                                                            |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Safety                   | Scan / fix / verify / policy / CI                                   | `src/core/scanner`, `src/core/fix`, `src/core/verify`, `src/core/policy` |
| Project Brain + MCP      | Claims, evidence, contradictions, Brain tools                       | `src/core/understanding`, `src/mcp/brain`                                |
| Platform 2.0             | Graph, sessions, provenance, impact, firewall (evaluate-only)       | `src/platform`                                                           |
| Shared contracts         | Unified finding/graph/knowledge/policy shapes                       | `src/contracts`                                                          |
| Repository Brain product | Init proposals + human review lifecycle                             | `src/core/brain-product`                                                 |
| Intelligence             | TS AST graph (+ regex fallback), git hotspots                       | `src/intelligence`                                                       |
| Architecture views       | C4-style inferred views                                             | `src/architecture`                                                       |
| Knowledge governance     | Draft→approve abstention-aware store                                | `src/knowledge`                                                          |
| Storage abstraction      | Filesystem default; memory; SQLite stubbed off                      | `src/storage`                                                            |
| Enforcement              | Controlled runner interface (blocks only when AD controls boundary) | `src/enforcement`                                                        |
| Team (local-dev)         | scrypt password auth + RBAC — **not SSO**                           | `src/team`                                                               |
| Combined MCP             | Brain tool names preserved + intelligence tools                     | `src/mcp/agentdoctor`, `src/mcp/intelligence`                            |
| Dashboard / API          | Loopback read-only + `/api/v2/*`                                    | `src/dashboard`                                                          |
| Ops                      | Local health probe                                                  | `src/ops`                                                                |

## Trust model (short)

1. **Analysis** — scan, graph, brain, knowledge suggestions
2. **Policy evaluation** — firewall / packs; `executionResult: "not-executed"` by default
3. **Human approval** — knowledge / brain proposal review
4. **Runtime enforcement** — only via AgentDoctor-controlled runner / CI wrapper when explicitly used

## Non-goals (honest)

- No IDE interception of third-party agents
- No enterprise SSO / IdP in this package
- No claimed multi-language AST parity beyond TS/JS
- No forced cloud infrastructure for local users

## Extension rule

Additive modules + feature flags (`DEFAULT_FEATURE_FLAGS`). Existing Safety CLI exit codes, Brain store format, Brain MCP tool names, and platform evaluate-only behavior remain stable.
