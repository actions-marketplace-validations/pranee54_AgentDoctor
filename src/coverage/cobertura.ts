import { normalizeCoveragePath, type CoverageFile, type NormalizedCoverage } from "./types.js";

/**
 * DOM-free Cobertura XML parser focused on class/@filename and line hits.
 */
export function parseCobertura(xml: string): NormalizedCoverage {
  const files: Record<string, CoverageFile> = {};
  const limitations = [
    "Cobertura parser extracts class filename + line hits only (DOM-free regex)",
    "No test→source mapping in standard Cobertura — test attribution is hybrid/heuristic",
  ];

  if (!xml.trim()) {
    return { format: "cobertura", files, limitations: ["Empty Cobertura input", ...limitations] };
  }

  const classRe = /<class\b([^>]*)>([\s\S]*?)<\/class>/gi;
  let classMatch: RegExpExecArray | null;
  while ((classMatch = classRe.exec(xml)) !== null) {
    const attrs = classMatch[1] ?? "";
    const body = classMatch[2] ?? "";
    const filename = attrValue(attrs, "filename") ?? attrValue(attrs, "name") ?? "";
    if (!filename) continue;
    const filePath = normalizeCoveragePath(filename);
    const file: CoverageFile = files[filePath] ?? {
      path: filePath,
      lines: {},
      functions: [],
    };

    const lineRe = /<line\b([^>]*)\/?>/gi;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRe.exec(body)) !== null) {
      const lineAttrs = lineMatch[1] ?? "";
      const number = Number(attrValue(lineAttrs, "number"));
      const hits = Number(attrValue(lineAttrs, "hits") ?? "0");
      if (!Number.isFinite(number)) continue;
      file.lines[number] = Math.max(
        file.lines[number] ?? 0,
        Number.isFinite(hits) ? hits : 0,
      );
    }
    files[filePath] = file;
  }

  return { format: "cobertura", files, limitations };
}

function attrValue(attrs: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  const m = attrs.match(re);
  return m?.[2] ?? null;
}

export function isCoberturaXml(text: string): boolean {
  const sample = text.slice(0, 8000);
  return (
    /<coverage\b/i.test(sample) ||
    /<!DOCTYPE\s+coverage/i.test(sample) ||
    (/<class\b/i.test(sample) && /<line\b/i.test(sample))
  );
}
