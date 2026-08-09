import type {
  DecisionAssignmentGraphEdge,
  DecisionAssignmentGraphNode,
} from "./decision-work.ts";

export const AGENT_ATLAS_TOPOLOGY_CONTRACT =
  "treeseed.agent-atlas-topology/v1" as const;

export const agentAtlasSizingMetrics = [
  "activity",
  "queue",
  "executions",
  "artifacts",
  "cost",
  "attention",
] as const;
export type AgentAtlasSizingMetric = (typeof agentAtlasSizingMetrics)[number];

export const agentAtlasEventCategories = [
  "question",
  "note",
  "proposal",
  "assignment",
  "estimate",
  "execution",
  "message",
  "artifact",
  "tool",
  "signal",
  "usage",
  "failure",
] as const;
export type AgentAtlasEventCategory =
  (typeof agentAtlasEventCategories)[number];

export interface AgentAtlasScope {
  teamId: string;
  selectedDate: string;
  workdayIds: string[];
  projectIds: string[];
  groupIds: string[];
  agentIds: string[];
  activityProfiles: string[];
  sizingMetric: AgentAtlasSizingMetric;
}

export type AgentAtlasNodeKind = "project" | "group" | "agent" | "external";
export type AgentAtlasEdgeKind =
  | "group-membership"
  | "declared-signal"
  | "observed-signal"
  | "assignment"
  | "artifact";

export interface AgentAtlasTopologyNode {
  id: string;
  kind: AgentAtlasNodeKind;
  projectId: string | null;
  parentId: string | null;
  name: string;
  slug: string;
  capacityClass: string | null;
  activityProfile: string | null;
  directGroupIds: string[];
  effectiveGroupIds: string[];
  contentPath: string | null;
  metadata: Record<string, unknown>;
}

export interface AgentAtlasTopologyEdge {
  id: string;
  kind: AgentAtlasEdgeKind;
  fromNodeId: string;
  toNodeId: string;
  contractId: string | null;
  direction: "input" | "output" | "relation";
  metadata: Record<string, unknown>;
}

export interface AgentAtlasTopologySnapshot {
  contract: typeof AGENT_ATLAS_TOPOLOGY_CONTRACT;
  revision: string;
  projectId: string;
  immutableRef: string;
  capturedAt: string;
  planningGraphRevision: string;
  nodes: AgentAtlasTopologyNode[];
  edges: AgentAtlasTopologyEdge[];
}

export interface AgentAtlasMetricReading {
  metric: AgentAtlasSizingMetric;
  rawValue: number;
  normalizedValue: number;
  unit: string;
}

export interface AgentAtlasNodeState {
  nodeId: string;
  workdayIds: string[];
  status:
    | "idle"
    | "queued"
    | "running"
    | "waiting"
    | "blocked"
    | "degraded"
    | "completed";
  progressPercent: number | null;
  elapsedSeconds: number | null;
  timeboxSeconds: number | null;
  metrics: AgentAtlasMetricReading[];
  activeAssignmentIds: string[];
  lastEventSequence: number | null;
  observedAt: string | null;
}

export interface AgentAtlasReplayCursor {
  cursor: string | null;
  observedAt: string;
  positions: Record<string, number>;
}

export interface AgentAtlasPlayback {
  mode: "live" | "historical";
  startedAt: string;
  endedAt: string | null;
  liveEdgeAt: string;
  cursor: AgentAtlasReplayCursor;
}

export interface AgentAtlasAssignmentSummary {
  id: string;
  projectId: string;
  workdayId: string;
  agentId: string | null;
  name: string;
  status: string;
  progressPercent: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  decisionId: string | null;
  proposalId: string | null;
  graphId: string | null;
  graphNodeId: string | null;
}

export interface AgentAtlasActivityItem {
  id: string;
  workdayId: string;
  sequence: number;
  timestamp: string;
  category: AgentAtlasEventCategory;
  direction: "input" | "output" | "internal";
  severity: "debug" | "info" | "warning" | "error";
  summary: string;
  projectId: string | null;
  agentId: string | null;
  activityProfile: string | null;
  signalContractId: string | null;
  assignmentId: string | null;
  artifactRefs: Record<string, unknown>[];
  metadata: Record<string, unknown>;
}

export interface AgentAtlasProjection {
  revision: string;
  generatedAt: string;
  timeZone: string;
  scope: AgentAtlasScope;
  topologies: AgentAtlasTopologySnapshot[];
  nodeStates: AgentAtlasNodeState[];
  assignments: AgentAtlasAssignmentSummary[];
  activity: AgentAtlasActivityItem[];
  playback: AgentAtlasPlayback;
  alerts: Array<{
    id: string;
    severity: "info" | "warning" | "error";
    message: string;
  }>;
}

export interface AgentAtlasDelta {
  revision: string;
  generatedAt: string;
  cursor: AgentAtlasReplayCursor;
  nodeUpserts: AgentAtlasNodeState[];
  removedNodeIds: string[];
  assignmentUpserts: AgentAtlasAssignmentSummary[];
  removedAssignmentIds: string[];
  activity: AgentAtlasActivityItem[];
}

export type AgentAtlasContextKind =
  | "project"
  | "group"
  | "agent"
  | "profile"
  | "workday"
  | "event"
  | "signal"
  | "assignment"
  | "artifact"
  | "proposal"
  | "decision";

export interface AgentAtlasContextReference {
  kind: AgentAtlasContextKind;
  id: string;
  projectId: string;
  workdayId?: string;
  eventSequence?: number;
  immutableRef?: string;
  path?: string;
  digest?: string;
}

export interface AgentAtlasAssignmentGraphProjection {
  id: string;
  projectId: string;
  decisionId: string;
  proposalId: string | null;
  status: string;
  nodes: Array<
    DecisionAssignmentGraphNode & {
      assignmentIds: string[];
      progressPercent: number | null;
    }
  >;
  edges: DecisionAssignmentGraphEdge[];
}

export function isAgentAtlasContextReference(
  value: unknown,
): value is AgentAtlasContextReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const kinds: AgentAtlasContextKind[] = [
    "project",
    "group",
    "agent",
    "profile",
    "workday",
    "event",
    "signal",
    "assignment",
    "artifact",
    "proposal",
    "decision",
  ];
  return (
    kinds.includes(candidate.kind as AgentAtlasContextKind) &&
    typeof candidate.id === "string" &&
    Boolean(candidate.id) &&
    typeof candidate.projectId === "string" &&
    Boolean(candidate.projectId) &&
    (candidate.eventSequence === undefined ||
      (Number.isInteger(candidate.eventSequence) &&
        Number(candidate.eventSequence) >= 0))
  );
}
