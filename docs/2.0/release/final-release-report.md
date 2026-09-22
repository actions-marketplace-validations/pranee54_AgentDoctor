# AgentDoctor 2.0.0 — Final release report

**Status:** In progress at commit time; publish/GitHub fields filled after remote verification.

| Field               | Value                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Final version       | **2.0.0**                                                                                                        |
| npm package         | `@praneeth_54/agentdoctor`                                                                                       |
| Package description | Codebase intelligence, repository analysis, safety controls, and MCP tools for developers and engineering teams. |
| Local pack size     | **268.1 kB** / **496** files / **1.1 MB** unpacked                                                               |
| Tests               | **53** files / **394** tests passed (`npm run verify`)                                                           |
| Git branch          | `main`                                                                                                           |
| Remote              | `https://github.com/pranee54/AgentDoctor.git`                                                                    |

## Repository organization (this release)

- **Source:** Kept existing subsystem layout under `src/` (no mechanical deep re-nest — already discoverable).
- **Docs:** Canonical 2.0 under `docs/2.0/`; guides/reference/features/archive/release-notes organized; root `AGENTDOCTOR_2.0.md` pointer.
- **Scripts:** Perf harness at `scripts/perf/ast-graph.mjs`.
- **Action:** `action.yml` default version **2.0.0**; CI Action smoke pins updated to **2.0.0**.
- **Excluded from git:** `*.tgz`, `.private/**`, `node_modules/**`, `dist/**`, `.agentdoctor/**`, generated benchmark JSON.

## Quality

| Check                                | Result                                    |
| ------------------------------------ | ----------------------------------------- |
| `npm run verify`                     | PASS                                      |
| `npm pack` / dry-run                 | PASS (`2.0.0`)                            |
| Clean-install from local tarball     | PASS (`--version` 2.0.0, scan JSON 2.0.0) |
| MCP entrypoints (`mcp`, `brain-mcp`) | PASS (help)                               |
| Secrets in release scope             | No real credentials                       |
| Packed README claims                 | Limitations labeled; no blanket 5/5       |

## Packaging (Option B)

npm tarball contains only: `dist/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`.
`docs/2.0/` remains on GitHub.

## Known limitations (unchanged honesty)

See [../overview/known-limitations.md](../overview/known-limitations.md) and README. Partial/experimental surfaces remain labeled.

## Post-commit fields (filled after push / publish)

| Field                 | Value                                                  |
| --------------------- | ------------------------------------------------------ |
| Git commit            | _pending_                                              |
| Git tag               | `v2.0.0`                                               |
| GitHub Release URL    | _pending_                                              |
| npm published version | _pending_                                              |
| npm package URL       | https://www.npmjs.com/package/@praneeth_54/agentdoctor |
| Marketplace status    | MANUAL ACTION REQUIRED unless verified                 |

## Remaining risks

- CI Action smoke jobs that install `@praneeth_54/agentdoctor@2.0.0` from the registry require npm publish before those jobs succeed.
- GitHub Marketplace listing may need a manual “Publish this Action to Marketplace” step in the GitHub UI.
