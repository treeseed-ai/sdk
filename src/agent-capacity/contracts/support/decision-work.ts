import type { ContentReference } from '../../../operations/content-operations.ts';
import type { AgentArtifactManifest } from '../../artifacts.ts';

export type AgentPlanningActivityType = 'planning' | 'estimating' | 'reviewing' | 'reporting';
export type ContentRef = ContentReference;
export type AgentEstimateConfidence = 'low' | 'medium' | 'high';
export type AgentEstimateRiskLevel = 'low' | 'medium' | 'high';
export type DecisionDependencyType = 'artifact' | 'capability' | 'decision' | 'external-resource' | 'human-input';
export type StructuredAgentEstimateStatus = 'submitted' | 'accepted' | 'rejected' | 'superseded';

export interface AgentOutputRequirement {
	id?: string;
	outputType: string;
	description?: string;
	contentModel?: string;
	required?: boolean;
	metadata?: Record<string, unknown>;
}

export interface DecisionDependencySpec {
	id: string;
	type: DecisionDependencyType;
	requiredBefore: 'start' | 'complete' | 'review' | 'release';
	optional?: boolean;
	deliverableType?: string;
	capability?: string;
	agentClass?: string;
	contentRefs?: string[];
	humanInputPolicy?: { requiredFrom: 'team-human' | 'any-human' | 'any-human-or-agent'; teamId?: string | null };
	summary?: string;
}

export interface StructuredAgentEstimate {
	id: string;
	teamId: string;
	projectId: string;
	decisionId?: string | null;
	proposalId?: string | null;
	workUnitId?: string | null;
	agentClass: string;
	agentId?: string | null;
	minCredits: number;
	expectedCredits: number;
	maxCredits: number;
	confidence: AgentEstimateConfidence;
	riskLevel: AgentEstimateRiskLevel;
	assumptions: string[];
	blockers: string[];
	dependencies: DecisionDependencySpec[];
	expectedOutputs: AgentOutputRequirement[];
	acceptanceCriteria: string[];
	completionEvidence: string[];
	createdAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface StructuredAgentEstimateRecord extends StructuredAgentEstimate {
	status: StructuredAgentEstimateStatus;
	acceptedAt: string | null;
	rejectedAt: string | null;
}

export interface DeliverableContract {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	deliverableType: string;
	producerAgentClasses: string[];
	reviewerAgentClasses?: string[];
	requiredSections?: string[];
	acceptanceCriteria: string[];
	status: 'required' | 'draft' | 'submitted' | 'approved' | 'rejected';
	metadata?: Record<string, unknown>;
}

export interface DeliverableContractRecord extends DeliverableContract {
	createdAt: string;
	updatedAt: string;
}

export interface DeliverableSourceAuthority {
	assignmentId: string;
	modeRunId: string;
	baseRef: string;
	effectiveRef: string;
	checkpointCommit?: string | null;
}

export interface DeliverableManifest {
	id: string;
	deliverableContractId: string;
	projectId: string;
	decisionId: string;
	producedRefs: ContentRef[];
	coverage?: Record<string, ContentRef[]>;
	summary: string;
	readyForReview: boolean;
	submittedByAgentId?: string | null;
	submittedAt?: string | null;
	sourceAuthority?: DeliverableSourceAuthority;
	metadata?: Record<string, unknown>;
}

export interface DeliverableManifestRecord extends DeliverableManifest {
	createdAt: string;
}

/** Authenticated, secret-free evidence projected from a completed graph ancestor. */
export interface GovernedPredecessorEvidence {
	graphNodeId: string;
	stage: string | null;
	deliverableContractId: string;
	deliverableType: string;
	contractStatus: 'approved' | 'rejected';
	deliverableManifest: DeliverableManifestRecord;
	artifactManifest: AgentArtifactManifest;
}

/** API-owned review policy projected from the accepted workflow and current graph state. */
export interface GovernedReviewPolicy {
	requireRevisionCycle: boolean;
	completedRevisionCycles: number;
	requiredDisposition: 'rejected' | null;
}

export interface DecisionAssignmentGraphNode {
	id: string;
	decisionId: string;
	projectId: string;
	targetAgentClass: string;
	activityType: AgentPlanningActivityType | 'acting';
	handler?: string | null;
	requiredCapabilities: string[];
	requiredDeliverableContractIds: string[];
	inputRefs: ContentRef[];
	outputRequirements: AgentOutputRequirement[];
	capacity: { expectedCredits: number; maxCredits: number };
	status: 'pending' | 'ready' | 'leased' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';
	metadata?: Record<string, unknown>;
}

export interface DecisionAssignmentGraphEdge {
	fromNodeId: string;
	toNodeId: string;
	edgeType: 'blocks-start' | 'blocks-completion' | 'blocks-release';
	reason?: string;
}

export interface DecisionAssignmentGraph {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	version: number;
	status: 'draft' | 'compiled' | 'ready' | 'executing' | 'completed' | 'blocked';
	estimateIds: string[];
	deliverableContracts: DeliverableContract[];
	nodes: DecisionAssignmentGraphNode[];
	edges: DecisionAssignmentGraphEdge[];
	compiledAt?: string | null;
	compiledBy: 'api-control-plane';
	metadata?: Record<string, unknown>;
}

export interface DecisionAssignmentGraphRecord extends DecisionAssignmentGraph {
	active: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface AgentCapacityContractDiagnostic {
	severity: 'info' | 'warning' | 'error';
	code: string;
	message: string;
	path?: string;
}

export interface AgentCapacityContractValidationResult { ok: boolean; diagnostics: AgentCapacityContractDiagnostic[]; }
export interface DecisionAssignmentGraphCompileResult { graph: DecisionAssignmentGraph; diagnostics: AgentCapacityContractDiagnostic[]; }

export interface EngineeringAssignmentGraphRoles {
	tester: string;
	engineer: string;
	reviewer: string;
	technicalWriter: string;
	releaser: string;
	operations?: string | null;
	researcher?: string | null;
	architect?: string | null;
}

export interface EngineeringAssignmentGraphInput {
	id?: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	version?: number;
	exactBaseRef: string;
	roles: EngineeringAssignmentGraphRoles;
	includeResearch?: boolean;
	includeArchitecture?: boolean;
	credits?: Partial<Record<'research' | 'architecture' | 'test' | 'implementation' | 'verification' | 'review' | 'documentation' | 'release' | 'operations', number>>;
	compiledAt?: string | null;
}

export interface EngineeringRevisionCycleResult {
	graph: DecisionAssignmentGraph;
	newContracts: DeliverableContract[];
	revisionCycle: number;
}
