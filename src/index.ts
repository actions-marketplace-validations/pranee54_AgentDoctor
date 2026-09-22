export { CONTRACTS_VERSION, DEFAULT_FEATURE_FLAGS } from "./contracts/index.js";
export { buildIntelligenceGraph } from "./intelligence/graph/build.js";
export { analyzeGitIntelligence } from "./intelligence/git/analyze.js";
export { buildC4Views } from "./architecture/c4.js";
export {
  createKnowledgeRecord,
  listKnowledge,
  transitionKnowledge,
  retrieveAuthoritative,
} from "./knowledge/store.js";
export { FilesystemStorageProvider, MemoryStorageProvider } from "./storage/provider.js";
export { runControlledCommand } from "./enforcement/runner.js";
export { registerLocalDevUser, authenticateLocalDev, authorize } from "./team/auth.js";
export { runProjectInit, listProposals, reviewProposal } from "./core/brain-product/init.js";
export { collectOpsHealth } from "./ops/health.js";
export { listPolicyPacks, getPolicyPack } from "./policy/packs.js";
export {
  listIntelligenceMcpTools,
  INTELLIGENCE_MCP_TOOL_NAMES,
} from "./mcp/intelligence/registry.js";
export { scan } from "./core/scanner/scan.js";
export { verify } from "./core/verify/verify.js";
export { compareFindings } from "./core/verify/compare.js";
export { PACKAGE_VERSION } from "./constants.js";
export type {
  ScanOptions,
  ScanResult,
  RepositoryInfo,
  Finding,
  FindingsSummary,
  Scores,
  AgentPresence,
  AgentDetectionResult,
  AgentSecurityAnalysisMode,
  CliOptions,
  ExitCode,
} from "./types/index.js";
export type { VerifyResult, VerifyOptions } from "./core/verify/verify.js";
export type { VerifyFindingRef, FindingCompareResult } from "./core/verify/compare.js";
export { EXIT_CODES } from "./types/index.js";
export { agentRegistry } from "./agents/registry.js";
export { detectAgents } from "./agents/detect-agents.js";
export { ruleRegistry, getRuleById } from "./core/rules/registry.js";
export { runRules } from "./core/rules/run-rules.js";
export { buildFixPlan } from "./core/fix/plan.js";
export { applyFixPlan } from "./core/fix/apply.js";
export type { ApplyFixPlanOptions } from "./core/fix/apply.js";
export { runFix } from "./core/fix/run.js";
export {
  evaluatePolicy,
  evaluateScanPolicy,
  evaluateVerifyPolicy,
  parseFailOnRules,
  parseSeverityGate,
} from "./core/policy/evaluate.js";
export type {
  PolicyOptions,
  PolicyViolation,
  PolicyViolationCode,
  PolicyInput,
} from "./core/policy/evaluate.js";
export type { FixPlan, FixAction, FixApplyResult } from "./core/fix/types.js";
