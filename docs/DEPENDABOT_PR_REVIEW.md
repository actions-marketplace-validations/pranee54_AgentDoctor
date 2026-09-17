# Dependabot PR Review

Date: 2026-09-17  
Repository: `pranee54/AgentDoctor`  
Baseline commit reviewed against: `3bf37594a10f800e6a2ff33a59867288e5d11ba5`  
Source: public GitHub REST API (`/repos/pranee54/AgentDoctor/pulls?state=open`)

**No Dependabot PRs were merged** as part of this audit.

**Auth note:** local `gh` token is invalid, so PR CI status could not be read via `gh pr checks`. Classifications below use PR metadata, advisory content, and local verification of equivalent lockfile overrides.

## Summary

| PR                                                     | Package                     | Change                | Classification                   | Recommendation                                                    |
| ------------------------------------------------------ | --------------------------- | --------------------- | -------------------------------- | ----------------------------------------------------------------- |
| [#39](https://github.com/pranee54/AgentDoctor/pull/39) | `fast-uri`                  | `3.1.5` → `3.1.7`     | Duplicate / superseded           | Close after landing local override to `3.1.8`                     |
| [#40](https://github.com/pranee54/AgentDoctor/pull/40) | `qs`                        | `6.15.3` → `6.16.0`   | Duplicate / superseded           | Close after landing local override to `6.16.0`                    |
| [#42](https://github.com/pranee54/AgentDoctor/pull/42) | `hono`                      | `4.13.1` → `4.13.7`   | Duplicate / superseded           | Close after landing local override to `4.13.8`                    |
| [#43](https://github.com/pranee54/AgentDoctor/pull/43) | `vitest` / `@vitest/mocker` | `^3.2.4` → `^5.0.0`   | Potentially breaking             | Do **not** merge for `v1.1.1`; schedule dedicated major migration |
| [#44](https://github.com/pranee54/AgentDoctor/pull/44) | `next` (fixture)            | `15.5.21` → `15.5.24` | Duplicate / superseded           | Close after landing fixture pin `15.5.24`                         |
| [#37](https://github.com/pranee54/AgentDoctor/pull/37) | `tsx`                       | `4.23.4` → `4.23.13`  | Safe to merge after verification | Optional maintenance; not a security fix for this release         |
| [#41](https://github.com/pranee54/AgentDoctor/pull/41) | `typescript-eslint`         | `8.65.0` → `8.69.0`   | Requires manual review           | Optional minor; verify lint before merge                          |

## Per-PR detail

### PR #39 — `fast-uri` 3.1.5 → 3.1.7

| Field                     | Detail                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| URL                       | https://github.com/pranee54/AgentDoctor/pull/39                                                                                  |
| Advisories (from PR body) | GHSA-qw65-cvwx-89v3, GHSA-58mr-gqgx-xq4g, GHSA-5jgf-p345-68v8, GHSA-fph4-wmhf-6fwf, GHSA-f65p-4m7j-42xc, GHSA-jqff-g426-hqxp     |
| Risk                      | Low (transitive patch under MCP SDK / ajv)                                                                                       |
| Local test result         | Equivalent fix verified via override `fast-uri@3.1.8` + full `npm run verify` (265 tests)                                        |
| Recommendation            | **Duplicate or superseded** — prefer the audit override at `3.1.8` (newer than PR target). Close PR after merge of audit change. |

### PR #40 — `qs` 6.15.3 → 6.16.0

| Field             | Detail                                                                  |
| ----------------- | ----------------------------------------------------------------------- |
| URL               | https://github.com/pranee54/AgentDoctor/pull/40                         |
| Advisories        | GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g                                |
| Risk              | Low (transitive via express inside MCP SDK; AgentDoctor uses stdio MCP) |
| Local test result | Override `qs@6.16.0` verified with `npm run verify`                     |
| Recommendation    | **Duplicate or superseded** — close after audit change lands.           |

### PR #42 — `hono` 4.13.1 → 4.13.7

| Field                     | Detail                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| URL                       | https://github.com/pranee54/AgentDoctor/pull/42                                          |
| Advisories (from PR body) | GHSA-hxh3-vqpv-xpqv, GHSA-crvj-82cr-hjcx, GHSA-gqvv-2mrq-wpjv, GHSA-g6gw-c38x-mqfc       |
| Risk                      | Low (transitive; stdio MCP path does not host Hono HTTP)                                 |
| Local test result         | Override `hono@4.13.8` verified with `npm run verify`                                    |
| Recommendation            | **Duplicate or superseded** — audit ships `4.13.8` (newer than PR). Close after landing. |

### PR #43 — `vitest` / `@vitest/mocker` → `^5.0.0`

| Field             | Detail                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| URL               | https://github.com/pranee54/AgentDoctor/pull/43                                                                                                                                            |
| Advisory          | GHSA-82fw-gwwq-j7x9                                                                                                                                                                        |
| Diff intent       | `package.json` `vitest` `^3.2.4` → `^5.0.0` plus large lockfile churn                                                                                                                      |
| Risk              | **High for release cadence** — semver-major test-runner migration                                                                                                                          |
| Local test result | **Not applied**. Current suite remains on Vitest 3.2.7 (265 passing).                                                                                                                      |
| Recommendation    | **Potentially breaking** / **Not relevant to the current release (`v1.1.1`)** — keep open or convert to a tracked issue for a dedicated Vitest 4.1.11+ / 5.x branch. Do not merge blindly. |

### PR #44 — `next` 15.5.21 → 15.5.24 (`fixtures/multi-agent-project`)

| Field             | Detail                                                                              |
| ----------------- | ----------------------------------------------------------------------------------- |
| URL               | https://github.com/pranee54/AgentDoctor/pull/44                                     |
| Advisories        | GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4 (critical RCE classes in Next.js)          |
| Risk              | Low for AgentDoctor runtime (fixture metadata only; not installed by root `npm ci`) |
| Local test result | Fixture pin updated to `15.5.24`; multi-agent scan still detects all three agents   |
| Recommendation    | **Duplicate or superseded** — close after fixture change lands.                     |

### PR #37 — `tsx` 4.23.4 → 4.23.13

| Field              | Detail                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| URL                | https://github.com/pranee54/AgentDoctor/pull/37                                                      |
| Security relevance | None observed in current `npm audit`                                                                 |
| Risk               | Low (devDependency patch within `^4.21.0`)                                                           |
| Local test result  | Not applied in this audit (security-only remediation scope)                                          |
| Recommendation     | **Safe to merge after verification** — run `npm run verify` on the PR branch; optional for `v1.1.1`. |

### PR #41 — `typescript-eslint` 8.65.0 → 8.69.0

| Field              | Detail                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| URL                | https://github.com/pranee54/AgentDoctor/pull/41                                                   |
| Security relevance | None observed in current `npm audit`                                                              |
| Risk               | Low–moderate (lint rule behavior can change across minor bumps)                                   |
| Local test result  | Not applied in this audit                                                                         |
| Recommendation     | **Requires manual review** — merge only after `npm run lint` + `npm run verify` on the PR branch. |

## Suggested close order after audit commit

1. Merge/land the local security override + fixture pin change.
2. Close #39, #40, #42, #44 as superseded.
3. Leave #43 open for a planned Vitest major migration.
4. Decide independently on #37 / #41 (maintenance only).

## Action release note

`action.yml` already contains `name: AgentDoctor Safety` on `main` (`3bf3759`). No Action metadata edits were required for this dependency audit. Do not move or rewrite tag `v1.1.0`; cut `v1.1.1` only after the security commit is approved and pushed.
