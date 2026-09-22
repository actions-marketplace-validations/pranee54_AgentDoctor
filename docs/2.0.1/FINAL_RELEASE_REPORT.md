# AgentDoctor 2.0.1 — Final Release Report

## Release

Package: `@praneeth_54/agentdoctor`  
Version: `2.0.1`  
Git commit (release): `c73436afdc8dc146ca0d7c210e7f1d1627676543` — `release: AgentDoctor 2.0.1`  
Git tag: `v2.0.1` (annotated; object `865fb668bb9ce0601bf70f98ff13d844986ecce3`)  
Branch: `main` → `origin/main`  
GitHub Release: https://github.com/pranee54/AgentDoctor/releases/tag/v2.0.1

Follow-up (post-tag, required for CI / complete tree):

- Coverage sources were locally present but **gitignored** by a broad `coverage/` rule, so `src/coverage/*` and `tests/unit/coverage/parsers.test.ts` were **not** in `c73436a`.
- Fixed in `7105f101ca94ca01c9cab560fdf7019dd6ba9df8` — `fix: track src/coverage ignored by broad gitignore` (ignore narrowed to `/coverage/`).
- This report recorded in `6d409992a2cd90dc1171c4c271399ea279af703c` (and any later docs-only amend commits).
- **Do not force-move `v2.0.1`.** Publish npm from HEAD after the coverage fix, not from a bare tag checkout of `c73436a`.

## Pre-release verification (local)

| Check                             | Result                                                |
| --------------------------------- | ----------------------------------------------------- |
| `npm run verify`                  | **PASS**                                              |
| Tests                             | **70** files / **451** tests — PASS                   |
| Typecheck / lint / format / build | PASS                                                  |
| `npm pack --dry-run`              | **2.0.1**, ~328.9 kB, **550** files, unpacked ~1.4 MB |

## Git release

| Step         | Status                                    |
| ------------ | ----------------------------------------- |
| Commit       | **PASS** (`c73436a`)                      |
| Tag `v2.0.1` | **PASS** (created; did not already exist) |
| Push `main`  | **PASS** (`dd102b6..c73436a`)             |
| Push tag     | **PASS**                                  |
| Remote tag   | **PASS** — `git ls-remote` shows `v2.0.1` |

## npm release

| Step                             | Status                                            |
| -------------------------------- | ------------------------------------------------- |
| `npm whoami`                     | `praneeth_54`                                     |
| Pre-check `npm view …@2.0.1`     | **404** (not already published — safe to publish) |
| Registry `latest` before publish | **2.0.0**                                         |
| `npm publish`                    | **BLOCKED — EOTP**                                |

Exact error (stopped per safety rules; no `--force`, no retry with invented OTP):

```text
npm error code EOTP
npm error This operation requires a one-time password from your authenticator.
npm error You can provide a one-time password by passing --otp=<code> to the command you ran.
```

Human action required:

```bash
cd /Applications/XAMPP/xamppfiles/htdocs/AgentDoctor
# ensure coverage fix is on HEAD, then:
npm publish --otp=<authenticator-code>
npm view @praneeth_54/agentdoctor version   # expect 2.0.1 (may lag briefly)
```

| Registry version | **still 2.0.0** (2.0.1 not published) |
| Registry tarball | **N/A** — publish not completed |
| Registry integrity | **N/A** |

## Clean registry installation

**NOT RUN** — blocked until `@praneeth_54/agentdoctor@2.0.1` exists on the registry.

## Published CLI / MCP

**NOT RUN** — depends on registry publish + clean install under `/tmp/agentdoctor-2.0.1-published-verification`.

## Security (what was verified)

- No `.env` / credentials / `.private/` staged or committed.
- No `*.tgz` committed.
- Local `npm run verify` includes security / path / secrets / enforcement tests (451 total).
- Hostile published-package path checks: **deferred** until npm publish succeeds.

## GitHub

| Item                         | Status                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Remote `main` at release SHA | YES (`c73436a`)                                                                                              |
| Remote tag `v2.0.1`          | YES                                                                                                          |
| GitHub Release               | **YES** — https://github.com/pranee54/AgentDoctor/releases/tag/v2.0.1                                        |
| CI on release push           | **FAILURE** — https://github.com/pranee54/AgentDoctor/actions/runs/35779240600                               |
| CI failure cause             | `Cannot find module './coverage/load.js'` because `src/coverage/` was ignored by `coverage/` in `.gitignore` |
| CodeQL                       | in progress / not used as success claim                                                                      |
| Marketplace                  | **MANUAL ACTION REQUIRED** (unchanged)                                                                       |

## Known limitations (preserved)

Do **not** claim zero gaps. External / intentional boundaries remain, including:

1. Browser OAuth / full IdP login UX — EXPERIMENTAL
2. Postgres without live `AGENTDOCTOR_POSTGRES_URL` / CI service — EXTERNAL
3. Java / Kotlin / Rust / Dart (and Go extractor) AST — EXTERNAL
4. IDE / agent process interception — EXTERNAL
5. Engineering correctness / compliance certificates from hash integrity — never claimed
6. Hosted SaaS, HSM, vector production backend — EXTERNAL / out of boundary

See: [limitations.md](limitations.md) · [FINAL_COMPLETION_AUDIT.md](FINAL_COMPLETION_AUDIT.md).

## Remaining items

1. Human `npm publish --otp=<code>` for `@praneeth_54/agentdoctor@2.0.1` from HEAD (after coverage fix).
2. Registry confirm + clean install smoke under `/tmp/agentdoctor-2.0.1-published-verification`.
3. Confirm CI green on follow-up commit that adds `src/coverage/`.
4. Optional: Marketplace UI listing.
5. Optional later: annotated tag alignment / patch if consumers need tag SHA == full tree (no force-move in this session).

## Final status

# AGENTDOCTOR 2.0.1 — RELEASE PARTIALLY VERIFIED

Git commit, tag, push, and GitHub Release succeeded. Local verify passed (70/451). npm publish blocked on OTP; published clean-install / CLI / MCP gates not run. CI failed on the tagged commit due to missing gitignored `src/coverage/` (fixed in follow-up commit; tag left on `c73436a` without force).
