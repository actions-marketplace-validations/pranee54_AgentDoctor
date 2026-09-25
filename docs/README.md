# Documentation

Product landing: [../README.md](../README.md) · Visual assets: [assets/](assets/)

## Layout

```
docs/
  2.0/            AgentDoctor 2.0 (canonical claims, audits, release prep)
  guides/         Getting started and how-to
  reference/      Specs and contracts (rules, scoring, exit codes, …)
  features/       Feature guides (Brain, Fix, dashboard, plugins, …)
  mcp/            MCP deep-dive
  development/    Contributor workflows
  community/      Adoption and outreach
  demo/           Walkthrough scripts
  launch/         Launch checklists and draft posts
  release-notes/  Per-version release notes
  archive/        Historical plans and audits (superseded)
  assets/         README images
  images/         Screenshot / social specs
```

## AgentDoctor 2.0 (start here for current product)

| Document                                                                   | Description                                  |
| -------------------------------------------------------------------------- | -------------------------------------------- |
| [2.0/README.md](2.0/README.md)                                             | **2.0 documentation index**                  |
| [2.0/overview/capabilities.md](2.0/overview/capabilities.md)               | Capability map (status labels)               |
| [2.0/overview/readiness-matrix.md](2.0/overview/readiness-matrix.md)       | Honest readiness classifications             |
| [2.0/overview/known-limitations.md](2.0/overview/known-limitations.md)     | Unsupported / partial claims                 |
| [2.0/guides/cli.md](2.0/guides/cli.md)                                     | CLI surfaces                                 |
| [2.0/guides/mcp.md](2.0/guides/mcp.md)                                     | Brain + combined MCP                         |
| [2.0/guides/github-action.md](2.0/guides/github-action.md)                 | GitHub Action inputs / examples              |
| [2.0/release/final-release-report.md](2.0/release/final-release-report.md) | Verified 2.0.0 release evidence (historical) |
| [2.0.1/](2.0.1/)                                                           | 2.0.1 cut docs, audits, RC reports           |

Root pointer: [../AGENTDOCTOR_2.0.md](../AGENTDOCTOR_2.0.md).

## Guides

| Document                                                       | Description                      |
| -------------------------------------------------------------- | -------------------------------- |
| [guides/quickstart.md](guides/quickstart.md)                   | Developer quickstart (Brain MCP) |
| [guides/why-agentdoctor.md](guides/why-agentdoctor.md)         | Why AgentDoctor exists           |
| [guides/engineering-lessons.md](guides/engineering-lessons.md) | Lessons from shipping 1.1.0      |
| [guides/scan-examples.md](guides/scan-examples.md)             | Fixture-backed scan walkthroughs |
| [guides/migration-v2.md](guides/migration-v2.md)               | Migration notes 1.x → 2.0        |

## Reference

| Document                                                                 | Description                      |
| ------------------------------------------------------------------------ | -------------------------------- |
| [reference/architecture.md](reference/architecture.md)                   | Scan pipeline and package layout |
| [reference/surfaces-and-adapters.md](reference/surfaces-and-adapters.md) | CLI / Action / MCP + adapters    |
| [reference/rules.md](reference/rules.md)                                 | Stable rule IDs and severity     |
| [reference/exit-codes.md](reference/exit-codes.md)                       | CLI exit codes                   |
| [reference/scoring.md](reference/scoring.md)                             | Readiness scoring (v1)           |
| [reference/compatibility.md](reference/compatibility.md)                 | v1 compatibility promises        |

## Features

| Document                                               | Description                                         |
| ------------------------------------------------------ | --------------------------------------------------- |
| [features/project-brain.md](features/project-brain.md) | Project Brain                                       |
| [features/brain-cli.md](features/brain-cli.md)         | Project Brain CLI                                   |
| [features/safe-fix-2.md](features/safe-fix-2.md)       | Safe Fix backup / undo / audit                      |
| [features/plugin-sdk.md](features/plugin-sdk.md)       | Plugin manifest SDK                                 |
| [features/dashboard.md](features/dashboard.md)         | Local read-only dashboard                           |
| [features/pr-review.md](features/pr-review.md)         | Local PR review dry-run                             |
| [features/local-ai.md](features/local-ai.md)           | Optional local AI providers                         |
| [features/v2-features.md](features/v2-features.md)     | v2 CLI feature index (may lag; prefer README / 2.0) |
| [mcp/brain-mcp.md](mcp/brain-mcp.md)                   | Project Brain MCP                                   |

## Development

| Document                                                             | Description                           |
| -------------------------------------------------------------------- | ------------------------------------- |
| [development/development.md](development/development.md)             | Local setup and contributor workflows |
| [development/good-first-issues.md](development/good-first-issues.md) | Safety-oriented starter ideas         |
| [../CONTRIBUTING.md](../CONTRIBUTING.md)                             | How to contribute                     |
| [../ROADMAP.md](../ROADMAP.md)                                       | Shipped / next / planned              |
| [community/good-first-issues.md](community/good-first-issues.md)     | Brain/MCP adoption starters           |

## Community / demo / launch

| Document                                                               | Description                           |
| ---------------------------------------------------------------------- | ------------------------------------- |
| [community/](community/)                                               | Outreach, show-and-tell, GitHub setup |
| [demo/](demo/)                                                         | Walkthroughs and live demo scripts    |
| [launch/](launch/)                                                     | Launch checklist and draft posts      |
| [../validation/mcp-agent/README.md](../validation/mcp-agent/README.md) | Real-agent MCP validation             |
| [../SECURITY.md](../SECURITY.md)                                       | Vulnerability reporting               |

## Release notes

| Document                           | Description                        |
| ---------------------------------- | ---------------------------------- |
| [../CHANGELOG.md](../CHANGELOG.md) | Release history                    |
| [release-notes/](release-notes/)   | Per-version notes (`v1.1.1.md`, …) |

## Archive (historical)

Superseded plans and one-off audits. Prefer [2.0/](2.0/README.md) for current claims.

| Document                                                                                       | Description                         |
| ---------------------------------------------------------------------------------------------- | ----------------------------------- |
| [archive/V1.2.0_IMPLEMENTATION_PLAN.md](archive/V1.2.0_IMPLEMENTATION_PLAN.md)                 | Phase 0 audit (historical)          |
| [archive/V2.0.0_IMPLEMENTATION_PLAN.md](archive/V2.0.0_IMPLEMENTATION_PLAN.md)                 | Mega-spec plan (historical)         |
| [archive/V2.0.0_FINAL_IMPLEMENTATION_REPORT.md](archive/V2.0.0_FINAL_IMPLEMENTATION_REPORT.md) | Early close-out report (historical) |
| [archive/DEPENDENCY_SECURITY_AUDIT.md](archive/DEPENDENCY_SECURITY_AUDIT.md)                   | Dependabot / dependency audit       |
| [archive/DEPENDABOT_PR_REVIEW.md](archive/DEPENDABOT_PR_REVIEW.md)                             | Dependabot PR review notes          |
