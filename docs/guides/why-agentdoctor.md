# Why AgentDoctor exists

## Engineering problem

AI coding agents can understand individual files, generate code, modify repositories, and run tests. Repository-level engineering context is usually fragmented across source, dependencies, Git history, architecture docs, tests, policies, ADRs, and tribal knowledge.

The difficult problem is not typing code faster — it is knowing whether a change is **correct, safe, compatible, explainable, and consistent** with the repository.

## What AgentDoctor is for

AgentDoctor sits between developers / AI agents and the repository’s engineering reality. It collects signals and produces **evidence and controls** you can inspect — it does not autonomously guarantee correctness.

```text
Developer / AI Agent
        │
        ▼
   AgentDoctor
        │
┌───────────────────────────────┐
│ Repository Intelligence       │
│ AST / Graph / Git / Impact    │
├───────────────────────────────┤
│ Engineering Knowledge         │
│ Brain / Decisions / Provenance│
├───────────────────────────────┤
│ Safety & Policy               │
│ Scan / Fix / Enforce / Secrets│
├───────────────────────────────┤
│ Verification                  │
│ Tests / Reports / Evidence    │
└───────────────────────────────┘
```

## Not a generic analyzer

AgentDoctor is not positioned as a replacement for static analyzers, generic code search, documentation generators, code-health dashboards, or AI coding assistants. Those tools solve adjacent problems. AgentDoctor focuses on the lifecycle of an AI-driven engineering change:

```text
Understand → Analyze → Govern → Change → Verify → Prove
```

(“Prove” / Change Proof is a **planned** evidence-package direction — not a shipped runtime; see [ROADMAP.md](../../ROADMAP.md).)

## Further reading

- Product landing: [../../README.md](../../README.md)
- Capabilities: [../2.0/overview/capabilities.md](../2.0/overview/capabilities.md)
- Limitations: [../2.0/overview/known-limitations.md](../2.0/overview/known-limitations.md)
