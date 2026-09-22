import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { resolveRepoRoot, toPosixRelative } from "../../utils/path.js";
import type { PlatformFinding } from "../types.js";
import { redactEvidenceDetail } from "../security/redact.js";

const INJECTION_PATTERNS: Array<{
  id: string;
  re: RegExp;
  severity: PlatformFinding["severity"];
  title: string;
}> = [
  {
    id: "ignore-previous",
    re: /ignore (all )?(previous|prior|above) (instructions|rules|policies)/i,
    severity: "critical",
    title: "Prompt-injection: ignore previous instructions",
  },
  {
    id: "exfiltrate",
    re: /exfiltrat|send (all )?(secrets|credentials|api keys) to/i,
    severity: "critical",
    title: "Suspected exfiltration instruction",
  },
  {
    id: "bypass-policy",
    re: /bypass (the )?(firewall|policy|approval|security|action policy)/i,
    severity: "high",
    title: "Policy-bypass instruction",
  },
  {
    id: "hidden-html",
    re: /<!--\s*(system|assistant|secret instruction)/i,
    severity: "high",
    title: "Hidden HTML instruction comment",
  },
  {
    id: "social-eng",
    re: /do not tell (the )?user|hide this from (the )?developer/i,
    severity: "high",
    title: "Social-engineering pattern",
  },
  {
    id: "obfuscated-b64",
    re: /eval\s*\(\s*atob\s*\(|Buffer\.from\([^,]+,\s*['"]base64['"]/i,
    severity: "medium",
    title: "Obfuscated execution pattern",
  },
];

/**
 * Module F — Context security / poisoning detection (pluggable pattern set).
 * Does not claim perfect detection. Evidence snippets are secret-redacted.
 */
export async function analyzeContextSecurity(rootInput: string): Promise<PlatformFinding[]> {
  const root = resolveRepoRoot(rootInput);
  const findings: PlatformFinding[] = [];
  const candidates = [
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "CONVENTIONS.md",
    "README.md",
    ".cursorrules",
    ".github/copilot-instructions.md",
  ];

  for (const rel of candidates) {
    const absolute = path.join(root, rel);
    let text: string;
    try {
      text = await fs.readFile(absolute, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      for (const pattern of INJECTION_PATTERNS) {
        if (!pattern.re.test(line)) continue;
        findings.push({
          id: `ctxsec_${createHash("sha1").update(`${rel}:${i}:${pattern.id}`).digest("hex").slice(0, 12)}`,
          module: "context-security",
          severity: pattern.severity,
          title: pattern.title,
          message: `Pattern ${pattern.id} in ${rel}:${i + 1}`,
          recommendation: "Review and remove untrusted instructions; tighten agent policies",
          confidence: 0.65,
          evidence: [
            {
              kind: "inferred",
              path: toPosixRelative(root, absolute),
              line: i + 1,
              detail: redactEvidenceDetail(line.slice(0, 200)),
            },
          ],
          falsePositiveWarning: "Pattern match only — confirm intent before treating as an attack",
        });
      }
    }
  }

  return findings.sort((a, b) => a.id.localeCompare(b.id));
}
