# AgentDoctor 2.0.0 — Final release report

**Date:** 2026-09-22  
**Branch:** `main`  
**Commit:** `c8b6681` — `release: AgentDoctor 2.0.0`  
**Tag:** `v2.0.0` (annotated)

---

## Summary

| Field             | Value                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Final version     | **2.0.0**                                                                                                        |
| npm package       | `@praneeth_54/agentdoctor`                                                                                       |
| Description       | Codebase intelligence, repository analysis, safety controls, and MCP tools for developers and engineering teams. |
| Local pack size   | **268.1 kB** / **496** files / **1.1 MB** unpacked                                                               |
| Tests             | **53** files / **394** tests — `npm run verify` PASS                                                             |
| GitHub repository | https://github.com/pranee54/AgentDoctor                                                                          |
| GitHub Release    | https://github.com/pranee54/AgentDoctor/releases/tag/v2.0.0                                                      |
| Action default    | `action.yml` → `version: 2.0.0`                                                                                  |
| npm published     | **BLOCKED** — registry PUT returned 404/unauthorized (token present but not accepted for publish)                |
| Marketplace       | **MANUAL ACTION REQUIRED**                                                                                       |

---

## Repository organization

- Kept `src/` subsystem layout (no risky mechanical re-nest).
- Docs: `docs/2.0/` canonical; `guides/`, `reference/`, `features/`, `archive/`, `release-notes/`.
- Scripts: `scripts/perf/ast-graph.mjs`.
- Root pointer: `AGENTDOCTOR_2.0.md`.
- Excluded: `*.tgz`, `.private/**`, `node_modules/**`, `dist/**`, `.agentdoctor/**`, generated benchmarks.

## Quality

| Check                               | Result                               |
| ----------------------------------- | ------------------------------------ |
| `npm run verify`                    | PASS                                 |
| `npm pack`                          | PASS (`2.0.0`, 268.1 kB, 496 files)  |
| Clean-install from local tarball    | PASS                                 |
| `agentdoctor --version` / scan JSON | `2.0.0`                              |
| `mcp` / `brain-mcp` help            | PASS                                 |
| Secrets in release commit           | None real                            |
| Packed README                       | Limitations + labels; no blanket 5/5 |

## Packaging (Option B)

Tarball: `dist/` + `README.md` + `CHANGELOG.md` + `LICENSE` + `package.json` only.

## GitHub

| Step                           | Status                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| Commit pushed to `origin/main` | **DONE** (`c8b6681`)                                                   |
| Tag `v2.0.0` pushed            | **DONE**                                                               |
| GitHub Release created         | **DONE** — https://github.com/pranee54/AgentDoctor/releases/tag/v2.0.0 |

## npm

| Step                          | Status                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| Registry already has 2.0.0?   | No (404 on view)                                                                                 |
| `npm publish --access public` | **FAILED** — `404 Not Found` on PUT (typical when auth is invalid/expired for the package owner) |
| Published version verified    | **NOT DONE**                                                                                     |

### Manual npm publish (required)

As package maintainer `praneeth_54`:

```bash
npm login
cd /path/to/AgentDoctor   # at c8b6681 / v2.0.0
npm publish --access public
npm view @praneeth_54/agentdoctor version   # expect 2.0.0
```

Then smoke from a clean directory:

```bash
npm install @praneeth_54/agentdoctor@2.0.0
npx agentdoctor --version
```

## GitHub Action / Marketplace

| Item                         | Status                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action.yml` default `2.0.0` | DONE in tree/tag                                                                                                                                           |
| CI matrix pins `2.0.0`       | DONE (Action smoke needs published npm 2.0.0)                                                                                                              |
| Action reference             | `pranee54/AgentDoctor@v2.0.0`                                                                                                                              |
| Marketplace listing          | **MANUAL ACTION REQUIRED** — use GitHub UI “Publish this Action to the GitHub Marketplace” if not already listed; do not claim published until UI confirms |

## Known limitations

Unchanged honesty: TS/JS AST focus, heuristic test-impact, inferred C4, evaluate-only firewall, local-dev auth (not SSO), no IDE interception, no production DB backends. See README + `docs/2.0/overview/known-limitations.md`.

## Remaining manual actions

1. **npm login + publish** as `praneeth_54`.
2. Verify published package install/smoke.
3. Confirm GitHub Marketplace listing / update if needed.
4. Re-check CI Action smoke jobs after npm 2.0.0 is live.

## Final status

| Gate                               | Status           |
| ---------------------------------- | ---------------- |
| Repository clean (local)           | YES              |
| GitHub commit/tag/release verified | YES              |
| npm verified                       | **NO — BLOCKED** |
| Marketplace verified               | **NO — MANUAL**  |
