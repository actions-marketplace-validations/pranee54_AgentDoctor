/**
 * Redaction for outbound model payloads.
 * Extends the local-ai redaction patterns; never send raw secrets to providers.
 */

const SECRET_PATTERNS: RegExp[] = [
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(ghp_[A-Za-z0-9]{36})\b/g,
  /\b(sk-[A-Za-z0-9]{20,})\b/g,
  /-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g,
  /\b((?:export\s+)?(?:AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|NPM_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|STRIPE_SECRET_KEY|AGENTDOCTOR_AI_API_KEY)\s*=\s*)(['"]?)[^\s'"]+\2/gi,
];

export function redactForModel(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

export function redactMessages<T extends { content: string }>(messages: T[]): T[] {
  return messages.map((m) => ({ ...m, content: redactForModel(m.content) }));
}
