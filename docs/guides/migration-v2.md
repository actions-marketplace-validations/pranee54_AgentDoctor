# Migration guide — 1.x → 2.0.0

## Package version

Package version: **2.0.0**. Prefer [docs/2.0/guides/migration.md](../2.0/guides/migration.md).

## Compatible without changes

- `agentdoctor scan|fix|verify|explain|doctor|brain-mcp`
- GitHub Action Safety workflow
- MCP tool names
- Library `scan()` / Safe Fix allowlist behavior
- Project Brain store under `.agentdoctor/project-brain/`

## New optional surfaces

- Brain CLI, changes, context-health, secrets, baselines, packages, pr-review, dashboard, plugins, local-ai
- Safe Fix now writes `.agentdoctor/fix-audit/` on apply (new directory; gitignore if desired)

## Breaking / behavioral notes for 2.0.0 cut

- Safe Fix apply creates backups before write (disk use under `.agentdoctor/fix-audit/`).
- New CLI subcommands appear in `--help`.
- Content secret scanning remains opt-in (`secrets` command).

## Recommended upgrade steps

1. Run `npm run verify` / `agentdoctor doctor` on a sample repo.
2. Try `agentdoctor fix --dry-run` then `fix -y`; confirm `fix-history`.
3. Optionally `brain rebuild` and `baseline save --name main`.
4. Do not enable `secrets` or `local-ai --provider ollama` in CI unless intended.
