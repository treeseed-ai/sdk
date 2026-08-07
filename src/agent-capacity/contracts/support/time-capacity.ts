export const CAPACITY_BUDGET_SCHEMA = 'treeseed.capacity-budget/v2' as const;

export interface CapacityTimeDimensions {
	requestedSeconds: number;
	reservedSeconds: number;
	activeSeconds: number;
	elapsedSeconds: number;
	releasedSeconds: number;
	overrunSeconds: number;
	hardDeadlineAt?: string | null;
	remainingSeconds?: number | null;
}

export interface CapacityTokenDimensions {
	inputTokens: number;
	cachedInputTokens: number;
	reasoningTokens: number;
	outputTokens: number;
	warningTokens?: number | null;
	hardLimitTokens?: number | null;
	hardLimitEnforceable: boolean;
}

export interface CapacityCostDimensions {
	amount: number;
	currency: string;
	warningAmount?: number | null;
	hardLimitAmount?: number | null;
	hardLimitEnforceable: boolean;
}

export interface CapacityNativeDimensions {
	unit: string;
	observed: number;
	cap?: number | null;
	capEnforceable: boolean;
}

export interface CapacityBudgetV2 {
	schemaVersion: typeof CAPACITY_BUDGET_SCHEMA;
	time: CapacityTimeDimensions;
	tokens: CapacityTokenDimensions;
	cost?: CapacityCostDimensions | null;
	native?: CapacityNativeDimensions[];
	maxAttempts: number;
	maxConcurrency?: number | null;
	deadline: string;
	pricingGeneration?: string | null;
	enforcementConfidence?: 'exact' | 'bounded' | 'estimated' | 'opaque';
	legacyAccounting?: Record<string, unknown> | null;
}

export const ASSIGNMENT_TERMINAL_DISPOSITIONS = [
	'completed',
	'completed_early',
	'deadline_exhausted',
	'budget_exhausted',
	'blocked',
	'cancelled',
	'failed',
] as const;

export type AssignmentTerminalDisposition = (typeof ASSIGNMENT_TERMINAL_DISPOSITIONS)[number];

export interface AssignmentCompletionEvidence {
	disposition: AssignmentTerminalDisposition;
	acceptanceChecks: Array<{ id: string; passed: boolean; evidenceRefs?: string[] }>;
	durableArtifactRefs: string[];
	remainingBudget: Partial<CapacityBudgetV2>;
	completionReason: string;
	noUsefulScopedWorkRemaining: boolean;
}

export const ASSIGNMENT_PERFORMANCE_SCHEMA = 'treeseed.assignment-performance/v1' as const;

export interface AssignmentPerformanceSummary {
	schemaVersion: typeof ASSIGNMENT_PERFORMANCE_SCHEMA;
	assignmentId: string;
	workdayId: string | null;
	teamId: string;
	projectId: string;
	agentId: string | null;
	agentClassId: string;
	activityProfile: string;
	handlerId: string | null;
	capacityProviderId: string;
	executionProviderId: string | null;
	model: string | null;
	groupIds: string[];
	taskSignature: string;
	disposition: AssignmentTerminalDisposition;
	reason: string;
	acceptanceChecks: AssignmentCompletionEvidence['acceptanceChecks'];
	completedScope: string[];
	remainingScope: string[];
	artifactRefs: string[];
	budget: CapacityBudgetV2;
	actual: {
		activeSeconds: number;
		elapsedSeconds: number;
		inputTokens: number;
		cachedInputTokens: number;
		reasoningTokens: number;
		outputTokens: number;
		costAmount: number | null;
		costCurrency: string | null;
		native: CapacityNativeDimensions[];
		attempts: number;
	};
	noUsefulScopedWorkRemaining: boolean;
	agentAssessment: Record<string, unknown> | null;
	systemAssessment: { generatedBy: 'agent-runner' | 'api-recovery'; measuredAt: string; enforcementConfidence: CapacityBudgetV2['enforcementConfidence'] };
	downstreamOutcomes: Array<{ kind: 'validation' | 'revision' | 'rejection'; status: string; evidenceRefs: string[]; occurredAt: string }>;
}

export interface WorkdayTimePolicy {
	cooperativePlanningPercent: number;
	governedExecutionPercent: number;
	reservePercent: number;
}

export function validateWorkdayTimePolicy(policy: WorkdayTimePolicy): { ok: boolean; diagnostics: Array<{ code: string; path: string; message: string }>; value?: WorkdayTimePolicy } {
	const values = [policy.cooperativePlanningPercent, policy.governedExecutionPercent, policy.reservePercent];
	if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) return { ok: false, diagnostics: [{ code: 'workday_time_percent_invalid', path: 'timePolicy', message: 'Workday time percentages must be finite values from 0 through 100.' }] };
	if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) >= 0.000001) return { ok: false, diagnostics: [{ code: 'workday_time_total_invalid', path: 'timePolicy', message: 'Workday time percentages must total exactly 100%.' }] };
	return { ok: true, diagnostics: [], value: policy };
}

export function emptyCapacityBudget(deadline: string, requestedSeconds: number): CapacityBudgetV2 {
	return {
		schemaVersion: CAPACITY_BUDGET_SCHEMA,
		time: { requestedSeconds, reservedSeconds: 0, activeSeconds: 0, elapsedSeconds: 0, releasedSeconds: 0, overrunSeconds: 0 },
		tokens: { inputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, outputTokens: 0, hardLimitEnforceable: false },
		maxAttempts: 1,
		deadline,
	};
}
