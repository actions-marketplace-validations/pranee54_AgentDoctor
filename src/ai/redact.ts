/**
 * Redaction for outbound model payloads.
 * Extends the local-ai redaction patterns; never send raw secrets to providers.
 * Patterns avoid nested unbounded quantifiers (ReDoS-safe).
 */

const REDACTED = "[REDACTED]";

const SIMPLE_SECRET_PATTERNS: RegExp[] = [
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(ghp_[A-Za-z0-9]{36})\b/g,
  /\b(sk-[A-Za-z0-9]{20,80})\b/g,
  /\b((?:export\s+)?(?:AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|NPM_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|STRIPE_SECRET_KEY|AGENTDOCTOR_AI_API_KEY)\s*=\s*)(\S+)/gi,
];

/** Linear scan — avoids polynomial backtracking on PEM fences. */
function redactPrivateKeyBlocks(text: string): string {
  const beginToken = "-----BEGIN ";
  const endToken = "-----END ";
  const keySuffix = "PRIVATE KEY-----";
  let out = "";
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(beginToken, i);
    if (start === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, start);
    const afterBegin = start + beginToken.length;
    const keyLabelEnd = text.indexOf(keySuffix, afterBegin);
    if (keyLabelEnd === -1 || keyLabelEnd - afterBegin > 64) {
      out += text.slice(start, afterBegin);
      i = afterBegin;
      continue;
    }
    const headerEnd = keyLabelEnd + keySuffix.length;
    const endStart = text.indexOf(endToken, headerEnd);
    if (endStart === -1) {
      out += text.slice(start, headerEnd);
      i = headerEnd;
      continue;
    }
    const endLabelEnd = text.indexOf(keySuffix, endStart + endToken.length);
    if (endLabelEnd === -1 || endLabelEnd - (endStart + endToken.length) > 64) {
      out += text.slice(start, headerEnd);
      i = headerEnd;
      continue;
    }
    out += REDACTED;
    i = endLabelEnd + keySuffix.length;
  }
  return out;
}

export function redactForModel(text: string): string {
  let out = redactPrivateKeyBlocks(text);
  for (const re of SIMPLE_SECRET_PATTERNS) {
    out = out.replace(re, (_m, prefix?: string) =>
      typeof prefix === "string" && prefix.includes("=") ? `${prefix}${REDACTED}` : REDACTED,
    );
  }
  return out;
}

export function redactMessages<T extends { content: string }>(messages: T[]): T[] {
  return messages.map((m) => ({ ...m, content: redactForModel(m.content) }));
}
