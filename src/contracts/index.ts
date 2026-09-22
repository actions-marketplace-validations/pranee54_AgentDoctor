/**
 * AgentDoctor 2.0 shared core contracts.
 * Unifies Safety / Brain / Platform without breaking existing module types.
 */

export const CONTRACTS_VERSION = "2.0.0-contracts" as const;

export type Confidence = number; // 0..1
export type EpistemicKind = "observed" | "inferred" | "proposed" | "unknown";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface SourceLocation {
  path: string;
  startLine?: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
}

export interface EvidenceRef {
  id: string;
  kind: EpistemicKind;
  detail: string;
  location?: SourceLocation;
  snapshotId?: string;
  redacted?: boolean;
}

export interface ProvenanceRef {
  id: string;
  repositoryId: string;
  snapshotId?: string;
  commit?: string | null;
  branch?: string | null;
  agentId?: string | null;
  model?: string | null;
  analysisVersion: string;
  recordedAt: string;
  fields: Record<string, { value: string | null; kind: EpistemicKind }>;
}

export interface GraphNodeContract {
  id: string;
  kind: string;
  label: string;
  path?: string;
  meta?: Record<string, string | number | boolean>;
}

export interface GraphEdgeContract {
  id: string;
  from: string;
  to: string;
  kind: string;
  evidence: EvidenceRef[];
  confidence: Confidence;
  analysisVersion: string;
  sourceLocation?: SourceLocation;
}

export interface FindingContract {
  id: string;
  module: string;
  severity: Severity;
  title: string;
  message: string;
  recommendation: string;
  confidence: Confidence;
  evidence: EvidenceRef[];
  location?: SourceLocation;
  repositoryId?: string;
  snapshotId?: string;
  analysisVersion: string;
  timestamp: string;
  limitations?: string[];
  falsePositiveWarning?: string;
}

export type KnowledgeStatus =
  | "observed"
  | "proposed"
  | "draft"
  | "pending-review"
  | "approved"
  | "rejected"
  | "deprecated"
  | "unknown";

export interface KnowledgeRecordContract {
  id: string;
  title: string;
  content: string;
  status: KnowledgeStatus;
  owner?: string | null;
  approver?: string | null;
  audience?: string[];
  version: string;
  effectiveAt?: string | null;
  expiresAt?: string | null;
  source?: string;
  evidence: EvidenceRef[];
  relatedRepositoryId?: string;
  relatedModule?: string;
  relatedPolicyId?: string;
  changeHistory: Array<{
    at: string;
    by?: string;
    note: string;
    from?: KnowledgeStatus;
    to?: KnowledgeStatus;
  }>;
}

export type PolicyDecisionKind =
  "allow" | "block" | "require-approval" | "sandbox-only" | "deny-network" | "deny-secrets";

export interface PolicyDecisionContract {
  actionId: string;
  decision: PolicyDecisionKind;
  reason: string;
  policyId?: string;
  policyVersion: string;
  inputClassification: string;
  evidence: EvidenceRef[];
  riskLevel: Severity;
  executionStatus: "not-executed" | "executed" | "blocked-by-enforcement";
  approvalStatus: "not-required" | "pending" | "approved" | "denied";
  timestamp: string;
}

export interface AgentEventContract {
  id: string;
  sessionId: string;
  timestamp: string;
  type: string;
  summary: string;
  detail?: Record<string, string>;
  risk?: Severity | "none";
}

export interface OwnershipContract {
  path: string;
  owners: string[];
  kind: EpistemicKind;
  evidence: EvidenceRef[];
}

export interface RepositoryIdentity {
  id: string;
  root: string;
  name?: string;
}

export interface WorkspaceIdentity {
  id: string;
  name: string;
  repositoryIds: string[];
}

export interface SnapshotContract {
  id: string;
  repositoryId: string;
  createdAt: string;
  kind: "brain" | "platform" | "graph" | "workspace";
  analysisVersion: string;
  limitations: string[];
}

export interface StorageProvider {
  readonly kind: "filesystem" | "sqlite" | "postgres" | "memory";
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/** Feature flags for experimental AgentDoctor 2.0 capabilities. */
export interface FeatureFlags {
  typescriptAst: boolean;
  sqliteStorage: boolean;
  teamMode: boolean;
  enforcementRunner: boolean;
  vectorSearch: boolean;
  architectureC4: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  typescriptAst: true,
  sqliteStorage: false,
  teamMode: false,
  enforcementRunner: false,
  vectorSearch: false,
  architectureC4: true,
};

export function clampConfidence(value: number): Confidence {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
