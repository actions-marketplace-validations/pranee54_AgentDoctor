# AgentDoctor 2.0 — Readiness Matrix

A **5/5** claim requires evidence across implementation, tests, accuracy, performance, security, deployment, and independent validation.

**Release-candidate audit (2026-09-21):** verify **53/394 PASS**; packed clean-install smoke PASS; version remains **1.1.1**.
**Publish recommendation:** begin formal 2.0.0 process; **do not publish 2.0.0 until blockers in `AGENTDOCTOR_2.0_RELEASE_BLOCKERS.md` are cleared.**

| Capability                   | Impl     | Tests          | Accuracy         | Perf                           | Security                                   | Deploy     | Independent | Classification                                            |
| ---------------------------- | -------- | -------------- | ---------------- | ------------------------------ | ------------------------------------------ | ---------- | ----------- | --------------------------------------------------------- |
| Safety layer                 | Y        | Y              | Y                | Y                              | Y                                          | Y          | Y           | Complete and verified                                     |
| Brain MCP (legacy tools)     | Y        | Y              | partial          | Y                              | Y                                          | Y          | Y           | Complete and verified                                     |
| Shared contracts             | Y        | Y              | n/a              | n/a                            | n/a                                        | Y          | N           | Implemented but partially validated                       |
| Repository Brain init/review | Y        | Y              | n/a              | n/a                            | Y (lifecycle)                              | Y          | N           | Implemented but partially validated                       |
| TS AST graph                 | Y        | Y              | partial          | measured (synthetic 120 files) | path/symlink hardened                      | Y (packed) | N           | Implemented but partially validated                       |
| Git intelligence             | Y        | Y              | method disclosed | unmeasured                     | n/a                                        | Y          | N           | Implemented but partially validated                       |
| C4 views                     | Y        | Y              | inferred         | n/a                            | labeled                                    | Y          | N           | Experimental                                              |
| Combined MCP intelligence    | Y        | Y (STDIO)      | partial          | unmeasured                     | path_escape + evaluate-only                | Y (packed) | N           | Implemented but partially validated                       |
| Knowledge governance         | Y        | Y (abstention) | abstention       | n/a                            | approval gated                             | Y          | N           | Implemented but partially validated                       |
| Enforcement runner           | Y        | Y (honesty)    | n/a              | n/a                            | blocked-by-enforcement scoped              | Y          | N           | Implemented but partially validated                       |
| Local-dev team auth          | Y        | Y              | n/a              | n/a                            | scrypt; not SSO                            | Y          | N           | Implemented but partially validated                       |
| Dashboard `/api/v2`          | Y        | Y              | n/a              | unmeasured                     | loopback + hostile path                    | Y (packed) | N           | Implemented but partially validated                       |
| npm pack / clean install     | Y        | smoke          | n/a              | n/a                            | n/a                                        | Y          | smoke       | Implemented but partially validated                       |
| Public docs for 2.0 (npm)    | partial  | N              | n/a              | n/a                            | README limitations OK; deep docs on GitHub | N          | N           | **Option B chosen for prep** — must reaffirm at 2.0.0 cut |
| SQLite/Postgres              | stub     | N              | N                | N                              | N                                          | N          | N           | Partially implemented                                     |
| Vector search                | flag off | N              | N                | N                              | N                                          | N          | N           | Unsupported                                               |
| Enterprise SSO               | N        | N              | N                | N                              | N                                          | N          | N           | Blocked by external dependency                            |
| Multi-language AST           | N        | N              | N                | N                              | N                                          | N          | N           | Unsupported                                               |
| IDE interception             | N        | N              | N                | N                              | N                                          | N          | N           | Unsupported                                               |

## Product readiness statement

In-tree AgentDoctor 2.0 capabilities are substantially implemented, verified at **1.1.1**, and installable from a packed artifact. They are **not** yet packaged/documented as a coherent public **2.0.0** release. No capability is auto-promoted to 5/5 by this RC audit.
