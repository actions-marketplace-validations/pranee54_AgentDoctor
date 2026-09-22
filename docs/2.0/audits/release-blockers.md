# AgentDoctor 2.0 — Release Blockers

**Context:** Post–version-cut status. Package metadata is **2.0.0**; npm publish / git tag / push are **not** done.
**Question answered:** What still blocks calling a **published** npm **2.0.0** release complete?

## Verdict

| Decision                                         | Answer                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| Begin formal 2.0.0 release process?              | **YES** (version cut done 2026-09-21)                                    |
| Publish npm `2.0.0` immediately?                 | **NO**                                                                   |
| Critical code/security showstopper found?        | **NO** (within audited scope)                                            |
| Version cut (`package.json` / CHANGELOG / pack)? | **DONE** — see [version-cut-report.md](../release/version-cut-report.md) |

---

## Release blockers (must clear before publishing 2.0.0)

1. **Git commit of the version cut** — not performed (explicitly out of cut scope).
2. **Git tag `v2.0.0`** — not created.
3. **Push to remote** — not performed.
4. **`npm publish`** — not performed.
5. **Action / CI pins** still reference published `1.1.1` until post-publish update.
6. **Human review of release commit scope** — large working tree; confirm what ships with the tag.
7. **Honest marketing at publish** — retain partially validated / experimental / unsupported labels (README + readiness matrix).

~~Version still `1.1.1`~~ — cleared by version cut.
~~CHANGELOG not cut~~ — cleared (`[2.0.0] — 2026-09-21`).
~~`package.json` description~~ — cleared (authorized string applied).
**Limitations in npm pack** — Option B retained (README complete; `docs/2.0/` on GitHub only).

Docs home: [`docs/2.0/`](../README.md).

---

## Exit criteria checklist for formal 2.0.0 cut

- [x] Human authorizes version bump to `2.0.0`
- [x] README + package description updated and reviewed (README preserved; description applied)
- [x] Limitations disclosed in packed artifact (README section; Option B)
- [x] CHANGELOG `[2.0.0]` section complete
- [x] `npm run verify` green on version-cut tree
- [x] `npm pack` produced `praneeth_54-agentdoctor-2.0.0.tgz`
- [ ] Human commit + tag + publish (separate authorization)
- [ ] Readiness matrix attached / linked; no false 5/5 claims
- [ ] Tag + publish only after checklist complete

Until then, keep shipping as **1.1.1** with Unreleased 2.0 capabilities in-tree.
