# Agent Approvals (2.1)

**Status:** IMPLEMENTED · **Release:** NOT PERFORMED

| Risk     | Examples                              | Gate           |
| -------- | ------------------------------------- | -------------- |
| LOW      | read, search, explain                 | Auto-allow     |
| MEDIUM   | source edits, create, tests           | Human approval |
| HIGH     | delete, installs, migrations, network | Human approval |
| CRITICAL | credentials, deploy, destructive      | Human approval |

The model cannot approve its own actions. CLI/UI must pass explicit `--approve` / `approvedByHuman`.
