# AgentDoctor 2.0 — MCP Documentation

## Servers

| Command                               | Server name         | Tools                |
| ------------------------------------- | ------------------- | -------------------- |
| `agentdoctor brain-mcp --root <path>` | `agentdoctor-brain` | Brain tools only     |
| `agentdoctor mcp --root <path>`       | `agentdoctor`       | Brain + intelligence |

Brain tool names are **stable** and must not be renamed:

`brain_overview`, `brain_query`, `brain_explain`, `brain_trace`, `brain_claims`, `brain_evidence`, `brain_ownership`, `brain_risk`, `brain_delta`, `brain_snapshot`

## Intelligence tools (additive)

| Tool                 | Purpose                           |
| -------------------- | --------------------------------- |
| `repo_overview`      | Graph builder + counts            |
| `codebase_search`    | Bounded node search               |
| `symbol_lookup`      | Functions/classes/modules         |
| `dependency_lookup`  | Incident edges                    |
| `call_graph_lookup`  | Call edges (best-effort)          |
| `test_impact`        | Test impact report                |
| `refactor_impact`    | Rename blast radius               |
| `code_health`        | Git intelligence                  |
| `architecture_info`  | C4 views (labeled inferred)       |
| `knowledge_retrieve` | Approved knowledge or abstain     |
| `policy_evaluate`    | Evaluate-only; **never executes** |

## Safety properties

- Inputs validated; unknown tools error
- Repository root required; path escape rejected
- No arbitrary shell execution from MCP
- Structured JSON results with confidence / limitations where applicable
- Unsupported languages / coverage gaps reported honestly
