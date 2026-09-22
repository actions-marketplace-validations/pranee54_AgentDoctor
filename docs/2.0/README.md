# AgentDoctor 2.0 documentation

Canonical home for AgentDoctor 2.0 architecture, guides, audits, and release prep.

**Package version:** `2.0.0`
**Product positioning:** Codebase intelligence for developers, AI agents, and engineering teams.

## Quick navigation

### Overview

| Doc                                                                    | Purpose                          |
| ---------------------------------------------------------------------- | -------------------------------- |
| [overview/architecture.md](overview/architecture.md)                   | Layered architecture             |
| [overview/feature-matrix.md](overview/feature-matrix.md)               | Capability status matrix         |
| [overview/readiness-matrix.md](overview/readiness-matrix.md)           | Honest readiness classifications |
| [overview/known-limitations.md](overview/known-limitations.md)         | What we do **not** claim         |
| [overview/trust-boundaries.md](overview/trust-boundaries.md)           | Analysis vs evaluate vs enforce  |
| [overview/security-threat-model.md](overview/security-threat-model.md) | Threat model                     |

### Guides

| Doc                                                              | Purpose                      |
| ---------------------------------------------------------------- | ---------------------------- |
| [guides/repository-brain.md](guides/repository-brain.md)         | Init / proposals / review    |
| [guides/knowledge-governance.md](guides/knowledge-governance.md) | Draft → approve / abstention |
| [guides/cli.md](guides/cli.md)                                   | CLI surfaces                 |
| [guides/api.md](guides/api.md)                                   | Dashboard HTTP API           |
| [guides/mcp.md](guides/mcp.md)                                   | Brain + combined MCP         |
| [guides/migration.md](guides/migration.md)                       | 1.x → 2.0 compatibility      |
| [guides/deployment.md](guides/deployment.md)                     | Local / self-hosted notes    |

### Reports

| Doc                                                                    | Purpose                       |
| ---------------------------------------------------------------------- | ----------------------------- |
| [reports/implementation-report.md](reports/implementation-report.md)   | What shipped in-tree          |
| [reports/test-report.md](reports/test-report.md)                       | Test evidence                 |
| [reports/accuracy-benchmarks.md](reports/accuracy-benchmarks.md)       | Accuracy (no invented scores) |
| [reports/performance-benchmarks.md](reports/performance-benchmarks.md) | Perf notes                    |
| [reports/release-notes.md](reports/release-notes.md)                   | Pre-release notes             |

### Audits & validation

| Doc                                                                    | Purpose                   |
| ---------------------------------------------------------------------- | ------------------------- |
| [audits/phase0-baseline.md](audits/phase0-baseline.md)                 | Phase 0 baseline          |
| [audits/deep-audit.md](audits/deep-audit.md)                           | Deep audit                |
| [audits/post-audit-hardening.md](audits/post-audit-hardening.md)       | Post-audit hardening      |
| [audits/deep-validation.md](audits/deep-validation.md)                 | Deep validation (6 tasks) |
| [audits/security-test.md](audits/security-test.md)                     | Security test evidence    |
| [audits/performance-test.md](audits/performance-test.md)               | Measured AST perf sample  |
| [audits/release-candidate-audit.md](audits/release-candidate-audit.md) | RC audit                  |
| [audits/release-blockers.md](audits/release-blockers.md)               | What blocks npm 2.0.0     |

### Release preparation (this phase)

| Doc                                                                    | Purpose                                |
| ---------------------------------------------------------------------- | -------------------------------------- |
| [release/public-release-plan.md](release/public-release-plan.md)       | Public release prep plan               |
| [release/documentation-review.md](release/documentation-review.md)     | Consistency review                     |
| [release/npm-packaging-decision.md](release/npm-packaging-decision.md) | Pack docs Option A vs B                |
| [release/changelog-proposal.md](release/changelog-proposal.md)         | Proposed `[2.0.0]` changelog (not cut) |

## Related historical docs (elsewhere)

Older mega-spec drafts remain under `docs/archive/V2.0.0_*.md` and `docs/features/v2-features.md`. Prefer **this tree** + the repository README for current public claims.
