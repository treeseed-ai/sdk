import type { ResearchCitation } from '../support/research-citation.ts';

export const RESEARCH_WORKFLOW_STAGES = [
	'question-decomposition',
	'source-selection-criteria',
	'governed-source-search',
	'independent-source-fetch',
	'linked-evidence-notes',
	'claim-synthesis',
	'citation-review-rejection',
	'revision',
	'citation-review-approval',
	'cited-knowledge-publication',
	'workday-report',
] as const;

export type ResearchWorkflowStage = (typeof RESEARCH_WORKFLOW_STAGES)[number];
export type ResearchWorkflowStatus = 'ready' | 'running' | 'completed' | 'blocked' | 'failed';
export type ResearchWorkflowNodeStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed';

export interface ResearchClaim {
	id: string;
	text: string;
	material: boolean;
	status: 'unsupported' | 'supported' | 'contradicted';
	citationIds: string[];
}

export interface ResearchWorkflowNode {
	id: string;
	stage: ResearchWorkflowStage;
	role: 'researcher' | 'reviewer' | 'technical-writer' | 'reporter';
	status: ResearchWorkflowNodeStatus;
	dependsOn: string[];
	assignmentId?: string | null;
	artifactRefs: string[];
	completedAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ResearchWorkflowRecord {
	schemaVersion: 1;
	id: string;
	teamId: string;
	projectId: string;
	objectiveRef: string;
	questionRef: string;
	status: ResearchWorkflowStatus;
	stateVersion: number;
	minimumIndependentSources: number;
	maxRevisionCycles: number;
	nodes: ResearchWorkflowNode[];
	citations: ResearchCitation[];
	claims: ResearchClaim[];
	reviewerRejectedUnsupportedClaims: boolean;
	reviewerApprovedRevision: boolean;
	revisionCount: number;
	publicationRef?: string | null;
	reportRef?: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ResearchStageCompletion {
	expectedStateVersion: number;
	stage: ResearchWorkflowStage;
	assignmentId: string;
	artifactRefs: string[];
	citations?: ResearchCitation[];
	claims?: ResearchClaim[];
	reviewOutcome?: 'approved' | 'rejected';
	reviewReason?: string;
	publicationRef?: string;
	reportRef?: string;
	metadata?: Record<string, unknown>;
}
