/**
 * Redact likely secrets from evidence / report text while preserving security context.
 */

const REDACTED = "[REDACTED]";

const SECRET_PATTERNS: Array<{ id: string; re: RegExp }> = [
  {
    id: "aws-access-key",
    re: /\b(AKIA[0-9A-Z]{16})\b/g,
  },
  {
    id: "bearer-token",
    re: /\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
  },
  {
    id: "jwt",
    re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  },
  {
    id: "private-key-block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    id: "connection-string",
    re: /\b((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/)[^\s'"]+/gi,
  },
  {
    id: "password-assignment",
    re: /\b((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[=:]\s*)(['"]?)[^\s'"]+\2/gi,
  },
  {
    id: "env-export",
    re: /\b((?:export\s+)?(?:AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|NPM_TOKEN|OPENAI_API_KEY|STRIPE_SECRET_KEY)\s*=\s*)(['"]?)[^\s'"]+\2/gi,
  },
  {
    id: "generic-api-key",
    re: /\b((?:api[_-]?key|apikey|client_secret)\s*[=:]\s*)(['"]?)[A-Za-z0-9_\-/+=]{16,}\2/gi,
  },
  {
    id: "cloud-cred-json",
    re: /("(?:private_key|client_secret|refresh_token)"\s*:\s*")[^"]+(")/gi,
  },
];

export function redactSecrets(input: string): {
  text: string;
  redacted: boolean;
  patterns: string[];
} {
  let text = input;
  const patterns: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const before = text;
    if (pattern.id === "bearer-token") {
      text = text.replace(pattern.re, `$1${REDACTED}`);
    } else if (
      pattern.id === "password-assignment" ||
      pattern.id === "env-export" ||
      pattern.id === "generic-api-key"
    ) {
      text = text.replace(pattern.re, `$1$2${REDACTED}$2`);
    } else if (pattern.id === "connection-string") {
      text = text.replace(pattern.re, `$1${REDACTED}`);
    } else if (pattern.id === "cloud-cred-json") {
      text = text.replace(pattern.re, `$1${REDACTED}$2`);
    } else if (pattern.id === "private-key-block") {
      text = text.replace(
        pattern.re,
        `-----BEGIN PRIVATE KEY-----\n${REDACTED}\n-----END PRIVATE KEY-----`,
      );
    } else {
      text = text.replace(pattern.re, REDACTED);
    }
    if (text !== before) patterns.push(pattern.id);
  }
  return { text, redacted: patterns.length > 0, patterns: [...new Set(patterns)] };
}

export function redactEvidenceDetail(detail: string, maxLen = 160): string {
  const { text, redacted } = redactSecrets(detail);
  const clipped = text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
  return redacted ? `${clipped} (secrets redacted)` : clipped;
}

export function sanitizeFindingsForExport<T extends { evidence: Array<{ detail: string }> }>(
  findings: T[],
): T[] {
  return findings.map((f) => ({
    ...f,
    evidence: f.evidence.map((e) => ({
      ...e,
      detail: redactEvidenceDetail(e.detail),
    })),
  }));
}

export const SECRET_REDACTION_MARKER = REDACTED;
