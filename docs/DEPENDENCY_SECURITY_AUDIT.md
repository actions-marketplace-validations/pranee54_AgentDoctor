# Dependency Security Audit

Date: 2026-09-17  
Repository: `pranee54/AgentDoctor`  
Baseline commit: `3bf37594a10f800e6a2ff33a59867288e5d11ba5` (`main`)  
Package version (unchanged): `1.1.0`  
Release tag left untouched: `v1.1.0`

## Scope and method

- Inspected `package.json`, `package-lock.json` (lockfileVersion 3), CI workflows, and `action.yml`.
- Ran `npm audit` against the installed lockfile (before and after remediation).
- Cross-checked public GitHub Advisory Database entries for each GHSA.
- Listed open Dependabot PRs via the public GitHub REST API.
- **Limitation:** `gh` authentication is invalid (`token in keyring is invalid`), so the private Dependabot Alerts API (`/dependabot/alerts`) could not be queried. The table below is reconstructed from `npm audit`, advisory metadata, and open Dependabot PR descriptions. Re-auth with `gh auth refresh -h github.com` to reconcile the exact GitHub UI count (reported as 15 open alerts).

## Repository baseline

| Item                 | Value                                                               |
| -------------------- | ------------------------------------------------------------------- |
| Branch               | `main`                                                              |
| Commit               | `3bf37594a10f800e6a2ff33a59867288e5d11ba5`                          |
| Node requirement     | `>=20` (`package.json` engines)                                     |
| Local Node / npm     | `v22.23.1` / `10.9.8`                                               |
| Package manager      | npm (`package-lock.json`)                                           |
| Verify command       | `npm run verify` (= typecheck + lint + format:check + test + build) |
| Baseline verify      | **PASS** — 265 tests                                                |
| Action name          | `AgentDoctor Safety` (already on `main`)                            |
| Existing release tag | `v1.1.0` (not modified)                                             |

### Direct dependencies

| Package                     | Range     | Role                                |
| --------------------------- | --------- | ----------------------------------- |
| `@modelcontextprotocol/sdk` | `^1.30.0` | Production (Brain MCP stdio server) |
| `commander`                 | `^14.0.3` | Production (CLI)                    |
| `picocolors`                | `^1.1.1`  | Production (CLI output)             |

### Direct development dependencies

| Package             | Range      | Role                            |
| ------------------- | ---------- | ------------------------------- |
| `@eslint/js`        | `^9.39.2`  | Lint                            |
| `@types/node`       | `^22.19.1` | Types                           |
| `eslint`            | `^9.39.2`  | Lint                            |
| `prettier`          | `^3.7.4`   | Format                          |
| `tsx`               | `^4.21.0`  | Dev runner / validation scripts |
| `typescript`        | `^5.9.3`   | Build / typecheck               |
| `typescript-eslint` | `^8.50.0`  | Lint                            |
| `vitest`            | `^3.2.4`   | Tests                           |

## Vulnerability table

Status values:

- **Fixed (verified)** — lockfile updated and `npm audit` no longer reports the issue.
- **Deferred** — not upgraded in this change; rationale documented.

| Package               | Current version (pre-fix)                   | Vulnerability                                                                                                                                                                                                                                                                                                                                                           | Severity | Fixed version                                             | Direct/transitive                                                | Required action                                   |
| --------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| `js-yaml`             | `4.3.1` (override)                          | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) — `maxTotalMergeKeys` CPU DoS for empty merge sources                                                                                                                                                                                                                                          | High     | `4.3.2`                                                   | Transitive (`eslint` → `@eslint/eslintrc`)                       | **Fixed (verified)** — override `4.3.2`           |
| `fast-uri`            | `3.1.5`                                     | [GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8), [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc), [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf), [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp) (+ related host-confusion advisories cited by Dependabot PR #39) | High     | `3.1.8` (npm audit); Dependabot PR targeted `3.1.7`       | Transitive (`@modelcontextprotocol/sdk` → `ajv` / `ajv-formats`) | **Fixed (verified)** — override `3.1.8`           |
| `hono`                | `4.13.1`                                    | [GHSA-gqvv-2mrq-wpjv](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv), [GHSA-g6gw-c38x-mqfc](https://github.com/advisories/GHSA-g6gw-c38x-mqfc), [GHSA-crvj-82cr-hjcx](https://github.com/advisories/GHSA-crvj-82cr-hjcx) (+ related advisory cited by PR #42)                                                                                                       | Moderate | `>=4.13.5` (shipped `4.13.8`)                             | Transitive (`@modelcontextprotocol/sdk`)                         | **Fixed (verified)** — override `4.13.8`          |
| `qs`                  | `6.15.3`                                    | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g)                                                                                                                                                                                                                      | Moderate | `6.16.0`                                                  | Transitive (`@modelcontextprotocol/sdk` → `express`)             | **Fixed (verified)** — override `6.16.0`          |
| `vitest`              | `3.2.7`                                     | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) — path traversal / arbitrary file read via `@vitest/mocker` redirect mock                                                                                                                                                                                                                      | Moderate | `4.1.11` or `5.0.x` (Dependabot PR #43 proposes `^5.0.0`) | Direct (dev)                                                     | **Deferred** — major upgrade (3 → 4/5); see below |
| `@vitest/mocker`      | `3.2.7`                                     | Same as `vitest` ([GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9))                                                                                                                                                                                                                                                                             | Moderate | Bundled with fixed `vitest`                               | Transitive (dev, via `vitest`)                                   | **Deferred** with `vitest`                        |
| `next` (fixture only) | `15.5.21` in `fixtures/multi-agent-project` | [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36), [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)                                                                                                                                                                                                                      | Critical | `15.5.24`                                                 | Fixture manifest only (not installed by root `npm ci`)           | **Fixed (verified)** — pin bumped to `15.5.24`    |

### Reachability notes

| Package                     | Production reachable? | Notes                                                                                                                                                                                               |
| --------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js-yaml`                   | No                    | Dev/CI lint path only (`eslint`).                                                                                                                                                                   |
| `fast-uri` / `hono` / `qs`  | Low / unlikely        | Pulled by `@modelcontextprotocol/sdk`. AgentDoctor uses the **stdio** MCP transport (`StdioServerTransport`), not the SDK HTTP/Express/Hono stack. Overrides applied anyway as low-risk patch pins. |
| `vitest` / `@vitest/mocker` | No                    | Test runner only. Exploit requires malicious Vitest mock redirect configuration during test execution.                                                                                              |
| `next` (fixture)            | No                    | Declared in a scan fixture `package.json`; AgentDoctor does not install or execute that Next.js app. Pin updated to clear Dependabot/security noise.                                                |

## Remediation applied in this working tree

`package.json` overrides (replacing the insufficient `js-yaml@4.3.1` pin):

```json
"overrides": {
  "js-yaml": "4.3.2",
  "fast-uri": "3.1.8",
  "hono": "4.13.8",
  "qs": "6.16.0"
}
```

Also updated `fixtures/multi-agent-project/package.json`: `next` `15.5.21` → `15.5.24`.

Lockfile regenerated with `npm install`. Post-fix `npm audit`:

```text
2 moderate severity vulnerabilities
(@vitest/mocker + vitest — deferred major)
```

Previously: 7 reported issues (4 moderate + 3 high in human audit output; advisory fan-out explains GitHub’s higher alert count).

## Deferred: Vitest major upgrade

- Current: `vitest@3.2.7` with `@vitest/mocker@3.2.7`.
- Safe fixed line per advisory: `>=4.1.11`; Dependabot PR #43 proposes `vitest@^5.0.0`.
- Risk: **semver-major** for the test runner (config, reporter, and assertion changes). Repository Dependabot policy already ignores major updates for routine bumps (`.github/dependabot.yml`).
- Mitigation while deferred: Vitest is **dev-only**; CI does not expose a network-facing Vitest mock server; untrusted projects are not executed as Vitest suites inside this package’s own tests.
- GitHub Dependabot alerts for GHSA-82fw-gwwq-j7x9 (`vitest` / `@vitest/mocker`) were **dismissed as `tolerable_risk`** on 2026-09-20 with this rationale. PR #43 remains open as the upgrade vehicle.
- Recommended follow-up (separate change): upgrade to Vitest 4.1.11 or 5.x on a dedicated branch, run full `npm run verify` + understanding/brain suites, then merge #43 (or equivalent) and clear the dismissal by shipping the fixed versions.

## Package version / architecture

- npm package version remains **`1.1.0`** (no bump required for dependency overrides).
- No production source, CLI surface, Action inputs/outputs, or public API changes.
- Tag `v1.1.0` was not modified. Planned Action release tag `v1.1.1` is out of scope for this audit commit.

## Post-remediation verification

| Command                                                 | Result                                    |
| ------------------------------------------------------- | ----------------------------------------- |
| `npm run typecheck`                                     | PASS                                      |
| `npm run lint`                                          | PASS                                      |
| `npm run format:check`                                  | PASS                                      |
| `npm test`                                              | PASS — 265 / 265                          |
| `npm run build`                                         | PASS                                      |
| `npm run verify`                                        | PASS                                      |
| CLI `--help`                                            | PASS                                      |
| Scan fixture JSON (`fixtures/clean-configured-project`) | PASS — valid JSON, version `1.1.0`        |
| Scan `fixtures/multi-agent-project`                     | PASS — detects cursor, claude-code, codex |
| `npm audit`                                             | 2 moderate remaining (vitest only)        |

## Remaining release blockers (security)

1. ~~Re-authenticate GitHub CLI and confirm Dependabot alert count drops after this lockfile lands.~~ Done — open alert count is 0 after transitive fixes + documented Vitest dismissals.
2. Dedicated Vitest 4/5 migration (tracked by open PR #43) when ready to clear the deferred moderate advisory for real.
3. ~~Close or supersede open Dependabot PRs that this change renders redundant.~~ Done for security/transitive PRs; #43 kept open on purpose.
