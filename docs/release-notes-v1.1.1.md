# AgentDoctor v1.1.1

Patch line after `v1.1.0`: **Marketplace Action naming + dependency security pins**.

## What this release is

- GitHub Action display name: **AgentDoctor Safety**
- Transitive dependency overrides for known advisories (`js-yaml`, `fast-uri`, `hono`, `qs`)
- Fixture Next.js pin update for Dependabot noise reduction

## What this release is not

- Not a new Safety feature release
- Not a Project Brain behavior change
- Not an automatic Vitest 5 upgrade (deferred; major)

## npm vs git tag

| Channel                                 | Version  |
| --------------------------------------- | -------- |
| Git tag / GitHub Release                | `v1.1.1` |
| Published npm package (as of this note) | `1.1.0`  |

Action consumers should keep using a published npm version input (recommended
`1.1.0` or `1.0.0` for Safety-only), or `workspace` in this repository’s CI.

Owner follow-up when ready: bump `package.json` and `npm publish` a matching
`1.1.1` (or `1.1.2` if the existing tag must stay bound to the security-only
commit without a package-version rewrite).

## Install

```bash
npx @praneeth_54/agentdoctor@1.1.0
```

```yaml
- uses: pranee54/AgentDoctor@v1.1.1
  with:
    version: "1.1.0"
```

## Docs

- [CHANGELOG.md](../CHANGELOG.md)
- [docs/DEPENDENCY_SECURITY_AUDIT.md](DEPENDENCY_SECURITY_AUDIT.md)
- [docs/DEPENDABOT_PR_REVIEW.md](DEPENDABOT_PR_REVIEW.md)
