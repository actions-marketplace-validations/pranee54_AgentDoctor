# AgentDoctor 2.0 — Feature Matrix

| Capability                            | Status                                               | Notes                                                   |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Safety scan/fix/verify                | **Complete and verified**                            | Preserved from 1.x                                      |
| Agent adapters (7)                    | **Complete and verified**                            | Cursor, Claude, Codex, Copilot, Windsurf, Gemini, Aider |
| Project Brain store + MCP tools       | **Complete and verified**                            | Tool names unchanged                                    |
| Shared contracts + adapters           | **Implemented but partially validated**              | `src/contracts`                                         |
| `agentdoctor init` + proposal review  | **Implemented but partially validated**              | Proposals never auto-approved                           |
| Brain snapshot/update/review CLI      | **Implemented but partially validated**              | Extends existing brain CLI                              |
| TS AST intelligence graph             | **Implemented but partially validated**              | Compiler API; regex fallback                            |
| Git hotspots / bus factor / co-change | **Implemented but partially validated**              | Method disclosed per metric                             |
| Dead-code categories                  | **Implemented but partially validated**              | Heuristic categories only                               |
| C4 views                              | **Experimental**                                     | Inferred from graph evidence                            |
| Combined MCP (`agentdoctor mcp`)      | **Implemented but partially validated**              | Brain + intelligence tools                              |
| Sessions / provenance                 | **Implemented but partially validated**              | Platform store                                          |
| Policy packs + evaluate-only firewall | **Implemented but partially validated**              | Packs in `src/policy/packs`                             |
| Controlled command runner             | **Implemented but partially validated**              | Blocks only under AD control                            |
| Governed knowledge store              | **Implemented but partially validated**              | Abstains without approval                               |
| Test / refactor impact                | **Implemented but partially validated**              | No coverage ingestion yet                               |
| Storage provider (FS/memory)          | **Implemented but partially validated**              | SQLite/Postgres adapters stubbed                        |
| Multi-repo workspaces                 | **Partially implemented**                            | API notice; not full product                            |
| Local-dev team auth + RBAC            | **Implemented but partially validated**              | Explicitly not enterprise SSO                           |
| Dashboard + `/api/v2/*`               | **Implemented but partially validated**              | Loopback default                                        |
| Vector search / cloud deploy / IdP    | **Blocked by external dependency** / **Unsupported** | Interfaces or docs only                                 |
| Full multi-language AST               | **Unsupported**                                      | TS/JS only                                              |
| Direct IDE interception               | **Unsupported**                                      | Not claimed                                             |

Classification key matches readiness matrix.
