/**
 * Context citation and truth labels for evidence-backed agent answers.
 */

export type TruthLabel = "VERIFIED" | "INFERRED" | "UNKNOWN" | "EXTERNAL";

export type EvidenceType =
  | "source-code"
  | "project-brain"
  | "graph"
  | "architecture"
  | "test"
  | "git"
  | "finding"
  | "documentation"
  | "metadata";

export interface ContextCitation {
  source: "repository" | "brain" | "graph" | "session" | "external";
  path?: string;
  range?: string;
  evidenceType: EvidenceType;
  confidence: TruthLabel;
  excerpt?: string;
  note?: string;
}

export interface ContextBundle {
  root: string;
  query: string;
  citations: ContextCitation[];
  /** Rendered text for model (DATA channel — untrusted) */
  rendered: string;
  estimatedTokens: number;
  limitations: string[];
}
