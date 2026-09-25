import type { EvidenceRef, FindingContract, GraphEdgeContract } from "./index.js";
import { CONTRACTS_VERSION, clampConfidence } from "./index.js";
import type { PlatformFinding, GraphEdge, EvidenceKind } from "../platform/types.js";

function mapKind(kind: EvidenceKind): EvidenceRef["kind"] {
  if (kind === "verified") return "observed";
  if (kind === "inferred") return "inferred";
  return "unknown";
}

export function platformFindingToContract(
  finding: PlatformFinding,
  opts?: { repositoryId?: string; snapshotId?: string },
): FindingContract {
  return {
    id: finding.id,
    module: finding.module,
    severity: finding.severity,
    title: finding.title,
    message: finding.message,
    recommendation: finding.recommendation,
    confidence: clampConfidence(finding.confidence),
    evidence: finding.evidence.map((e, i) => ({
      id: `${finding.id}_ev_${i}`,
      kind: mapKind(e.kind),
      detail: e.detail,
      ...(e.path
        ? {
            location: {
              path: e.path,
              ...(typeof e.line === "number" ? { startLine: e.line } : {}),
            },
          }
        : {}),
      ...(opts?.snapshotId ? { snapshotId: opts.snapshotId } : {}),
    })),
    analysisVersion: CONTRACTS_VERSION,
    timestamp: new Date().toISOString(),
    ...(opts?.repositoryId ? { repositoryId: opts.repositoryId } : {}),
    ...(opts?.snapshotId ? { snapshotId: opts.snapshotId } : {}),
    ...(finding.falsePositiveWarning
      ? {
          falsePositiveWarning: finding.falsePositiveWarning,
          limitations: [finding.falsePositiveWarning],
        }
      : {}),
  };
}

export function platformEdgeToContract(edge: GraphEdge): GraphEdgeContract {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    evidence: [
      {
        id: `${edge.id}_ev`,
        kind: mapKind(edge.evidence),
        detail: `edge kind=${edge.kind}`,
      },
    ],
    confidence: edge.evidence === "verified" ? 0.85 : edge.evidence === "inferred" ? 0.5 : 0.2,
    analysisVersion: CONTRACTS_VERSION,
  };
}
