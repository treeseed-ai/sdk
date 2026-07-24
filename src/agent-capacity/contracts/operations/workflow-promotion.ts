import type { EngineeringAssignmentGraphRoles } from '../support/decision-work.ts';

export interface EngineeringWorkflowPromotionConfigV1 {
	schemaVersion: 1;
	id: string;
	projectId: string;
	decisionId: string;
	objectiveId: string;
	exactBaseRef: string;
	roles: EngineeringAssignmentGraphRoles;
	includeResearch?: boolean;
	includeArchitecture?: boolean;
	requireLinkedProposal?: boolean;
	requireRevisionCycle?: boolean;
	credits?: Partial<Record<'research' | 'architecture' | 'test' | 'implementation' | 'verification' | 'review' | 'documentation' | 'release' | 'operations', number>>;
	metadata?: Record<string, unknown>;
}

export interface EngineeringWorkflowPromotionValidation {
	ok: boolean;
	diagnostics: Array<{ code: string; path: string; message: string }>;
}
