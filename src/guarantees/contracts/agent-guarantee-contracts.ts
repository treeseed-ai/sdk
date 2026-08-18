export const GUARANTEE_V2_SCHEMA_VERSION = 'treeseed.guarantee/v2' as const;
export const GUARANTEE_VERIFIER_RESULT_SCHEMA_VERSION = 'treeseed.guarantee-verifier-result/v1' as const;
export const AGENT_GUARANTEE_PROOF_SCHEMA_VERSION = 'treeseed.agent-guarantee-proof/v1' as const;

export type GuaranteeAssertionKind = 'required' | 'forbidden';
export type GuaranteeRunVariant = 'baseline' | 'clean-repeat' | 'interruption-resume' | string;

export interface GuaranteeOutcomeAssertion {
	id: string;
	kind: GuaranteeAssertionKind;
	description: string;
	evidenceKinds: string[];
	authoritativeSubjects?: string[];
	variants?: GuaranteeRunVariant[];
}

export interface GuaranteeActivationContract {
	minimumConsecutivePasses: number;
	requiredVariants: GuaranteeRunVariant[];
	invalidateOnSourceChange: boolean;
	distinctEntityRefs?: Array<{ subject: string; variants: GuaranteeRunVariant[] }>;
}

export interface GuaranteeCatalogContract {
	capabilityId: string;
	catalog: string;
	outcomes: GuaranteeOutcomeAssertion[];
	activation: GuaranteeActivationContract;
	proof: {
		requiredCommands: string[];
		outcomePredicates: Record<string, string[]>;
		minimumRepositoryPostconditions: number;
	};
	supersedes?: string[];
	supersededBy?: string;
}

export type GuaranteeAssertionResultStatus = 'passed' | 'failed' | 'blocked' | 'skipped';

export interface GuaranteeAssertionResult {
	id: string;
	status: GuaranteeAssertionResultStatus;
	evidence: string[];
	entityRefs?: Record<string, string>;
	diagnostics?: string[];
}

export interface GuaranteeVerifierResult {
	schemaVersion: typeof GUARANTEE_VERIFIER_RESULT_SCHEMA_VERSION;
	guaranteeId: string;
	capabilityId: string;
	variant: GuaranteeRunVariant;
	sourceGeneration: string;
	assertions: GuaranteeAssertionResult[];
	repositoryPostconditions: Array<{
		repository: string;
		baseRef: string;
		effectiveRef: string;
		targetRef?: string;
		changedPaths: string[];
		readBackVerified: boolean;
	}>;
	cleanup: {
		verified: boolean;
		activeAssignments: number;
		activeLeases: number;
		activeReservations: number;
		activeDemands: number;
		activeWorkspaces: number;
		activeWorktrees: number;
		unpublishedBranches: number;
		staleAuthorities: number;
	};
	evidence: string[];
}

export type AgentGuaranteeProofCommandKind = 'read' | 'operator-mutation' | 'simulated-human-mutation' | 'recovery';
export type AgentGuaranteeProofPredicateOperator = 'exists' | 'absent' | 'equals' | 'not-equals' | 'includes' | 'matches' | 'length-at-least' | 'distinct';

export interface AgentGuaranteeProofValueRef {
	commandId: string;
	path: string;
}

export interface AgentGuaranteeProofCommand {
	id: string;
	args: string[];
	kind: AgentGuaranteeProofCommandKind;
	expectedExitCode: number;
}

export interface AgentGuaranteeProofPredicate extends AgentGuaranteeProofValueRef {
	id: string;
	operator: AgentGuaranteeProofPredicateOperator;
	expected?: unknown;
	expectedRef?: AgentGuaranteeProofValueRef;
}

export interface AgentGuaranteeProofOutcome {
	outcomeId: string;
	evidenceCommands: string[];
	entityRefs: Record<string, AgentGuaranteeProofValueRef>;
	predicates: AgentGuaranteeProofPredicate[];
}

export interface AgentGuaranteeProofInput {
	schemaVersion: typeof AGENT_GUARANTEE_PROOF_SCHEMA_VERSION;
	capabilityId: string;
	variant: GuaranteeRunVariant;
	sourceGeneration: string;
	commands: AgentGuaranteeProofCommand[];
	outcomes: AgentGuaranteeProofOutcome[];
	repositoryPostconditions: Array<{
		repository: string;
		baseRef: AgentGuaranteeProofValueRef;
		effectiveRef: AgentGuaranteeProofValueRef;
		targetRef?: AgentGuaranteeProofValueRef;
		changedPaths: AgentGuaranteeProofValueRef;
		readBackVerified: AgentGuaranteeProofValueRef;
	}>;
	cleanup: {
		commandId: string;
		verified: AgentGuaranteeProofValueRef;
		activeAssignments: AgentGuaranteeProofValueRef;
		activeLeases: AgentGuaranteeProofValueRef;
		activeReservations: AgentGuaranteeProofValueRef;
		activeDemands: AgentGuaranteeProofValueRef;
		activeWorkspaces: AgentGuaranteeProofValueRef;
		activeWorktrees: AgentGuaranteeProofValueRef;
		unpublishedBranches: AgentGuaranteeProofValueRef;
		staleAuthorities: AgentGuaranteeProofValueRef;
	};
}
