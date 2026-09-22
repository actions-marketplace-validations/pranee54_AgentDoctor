/**
 * AgentDoctor 2.0 platform contracts.
 * Local-first: no mandatory cloud, DB, or API keys.
 */

export type EvidenceKind = "verified" | "inferred" | "unknown";

export interface EvidenceRef {
  kind: EvidenceKind;
  path?: string;
  detail: string;
  line?: number;
}

export type PlatformSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface PlatformFinding {
  id: string;
  module: string;
  severity: PlatformSeverity;
  title: string;
  message: string;
  recommendation: string;
  confidence: number;
  evidence: EvidenceRef[];
  falsePositiveWarning?: string;
}

export interface GraphNode {
  id: string;
  kind:
    | "file"
    | "directory"
    | "function"
    | "class"
    | "module"
    | "api"
    | "test"
    | "dependency"
    | "doc"
    | "config"
    | "service"
    | "commit"
    | "owner";
  label: string;
  path?: string;
  meta?: Record<string, string | number | boolean>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  evidence: EvidenceKind;
}

export interface RepositoryGraph {
  root: string;
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  limitations: string[];
}

export type FirewallDecision =
  "allow" | "block" | "require-approval" | "sandbox-only" | "deny-network" | "deny-secrets";

export type AgentActionType =
  | "shell"
  | "file-create"
  | "file-modify"
  | "file-delete"
  | "git"
  | "package-install"
  | "database"
  | "network"
  | "docker"
  | "infra"
  | "secret-access"
  | "config-change"
  | "deploy";

export interface AgentActionRequest {
  actionId: string;
  agentId: string;
  userId?: string;
  timestamp: string;
  type: AgentActionType;
  params: Record<string, string>;
  repositoryRoot: string;
}

export interface FirewallVerdict {
  actionId: string;
  decision: FirewallDecision;
  reason: string;
  riskLevel: PlatformSeverity;
  policyId?: string;
  approvalStatus: "not-required" | "pending" | "approved" | "denied";
  executionResult: "not-executed";
}

export type LocalRole = "admin" | "developer" | "reviewer" | "auditor" | "readonly";

export interface PlatformSnapshot {
  version: "2.0";
  root: string;
  generatedAt: string;
  graph: RepositoryGraph;
  findings: PlatformFinding[];
  readiness: ReadinessReport;
  testImpact?: TestImpactSnapshot;
  limitations: string[];
}

/** Persisted subset of Module H test-impact analysis. */
export interface TestImpactSnapshot {
  gitAvailable: boolean;
  changedFiles: string[];
  recommendedTests: Array<{
    testPath: string;
    reason: string;
    confidence: number;
    evidence: EvidenceKind;
    exists: boolean;
    relatedModules: string[];
  }>;
  relatedModules: string[];
  missingTestWarnings: Array<{
    sourceFile: string;
    message: string;
    relatedModules: string[];
  }>;
  uncoveredAreas: string[];
  skipRisk: string;
  limitations: string[];
}

export interface ReadinessCategory {
  id: string;
  title: string;
  score: number;
  evidence: EvidenceRef[];
  gaps: string[];
  recommendations: string[];
}

export interface ReadinessReport {
  root: string;
  categories: ReadinessCategory[];
  overallNote: string;
  limitations: string[];
}
