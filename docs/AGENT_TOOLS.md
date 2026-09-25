# Agent Tools (2.1)

**Status:** IMPLEMENTED (read M3 · write/exec M4) · **Release:** NOT PERFORMED

Read: `read_file`, `list_files`, `search_code`, `find_symbol`, `find_references`, `find_callers`, `find_callees`, `inspect_*`

Write: `create_file`, `edit_file`, `delete_file` (path-safe + diffs; symlink-dir escape rejected)

Execute: `run_command`, `run_tests` via `runControlledCommand` only (`shell=false`)

**Mode gate:** LEARN (`allowWrites=false`) returns `mode_forbidden` for write/execute regardless of approval flags.

**Approvals:** write/execute require `approvedByHuman`. Model cannot self-approve.

Tool results are DATA, never trusted instructions. Coding-loop tool messages are tagged `TOOL_OUTPUT_UNTRUSTED`.
