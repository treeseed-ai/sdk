export const CAPACITY_BUDGET_SCHEMA = 'treeseed.capacity-budget/v2' as const;

export interface CapacityTimeDimensions {
	requestedSeconds: number;
	reservedSeconds: number;
	activeSeconds: number;
	elapsedSeconds: number;
	releasedSeconds: number;
	overrunSeconds: number;
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
	legacyAccounting?: Record<string, unknown> | null;
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
