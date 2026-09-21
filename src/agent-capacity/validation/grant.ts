import type { CapacityGrantV2 } from '../grant.ts';

export interface CapacityGrantDiagnostic {
	code: string;
	path: string;
	message: string;
}

export interface CapacityGrantValidation {
	ok: boolean;
	diagnostics: CapacityGrantDiagnostic[];
}

export function validateCapacityGrantV2(grant: CapacityGrantV2): CapacityGrantValidation {
	const diagnostics: CapacityGrantDiagnostic[] = [];
	const add = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
	for (const [path, value] of [['id', grant.id], ['membershipId', grant.membershipId], ['teamId', grant.teamId], ['providerId', grant.providerId], ['projectId', grant.projectId], ['environment', grant.environment]] as const) {
		if (!value?.trim()) add('capacity_grant_field_required', path, `${path} is required.`);
	}
	if (grant.schemaVersion !== 2) add('capacity_grant_schema_invalid', 'schemaVersion', 'Grant schemaVersion must be 2.');
	if (!Array.isArray(grant.allowedModes) || grant.allowedModes.length === 0 || grant.allowedModes.some((mode) => !['planning', 'acting'].includes(mode))) add('capacity_grant_modes_invalid', 'allowedModes', 'Grant allowedModes must contain planning and/or acting.');
	for (const [path, values] of [['executionProviderIds', grant.executionProviderIds], ['laneIds', grant.laneIds], ['capabilities', grant.capabilities]] as const) {
		if (!Array.isArray(values) || values.some((value) => !value?.trim()) || new Set(values).size !== values.length) add('capacity_grant_list_invalid', path, `${path} must contain unique non-empty strings.`);
	}
	for (const [path, value] of [['dailyAgentSecondsLimit', grant.dailyAgentSecondsLimit], ['monthlyAgentSecondsLimit', grant.monthlyAgentSecondsLimit]] as const) {
		if (value != null && (!Number.isFinite(value) || value < 0)) add('capacity_grant_limit_invalid', path, `${path} must be zero or greater when configured.`);
	}
	if (grant.maxConcurrentAssignments != null && (!Number.isInteger(grant.maxConcurrentAssignments) || grant.maxConcurrentAssignments < 0)) add('capacity_grant_concurrency_invalid', 'maxConcurrentAssignments', 'maxConcurrentAssignments must be a non-negative integer when configured.');
	if (grant.budgetLimits?.tokens != null && (!Number.isFinite(grant.budgetLimits.tokens) || grant.budgetLimits.tokens < 0)) add('capacity_grant_token_limit_invalid', 'budgetLimits.tokens', 'Token limit must be finite and non-negative.');
	if (grant.budgetLimits?.cost && (!Number.isFinite(grant.budgetLimits.cost.amount) || grant.budgetLimits.cost.amount < 0 || !grant.budgetLimits.cost.currency.trim())) add('capacity_grant_cost_limit_invalid', 'budgetLimits.cost', 'Cost limit requires a non-negative amount and currency.');
	if (grant.budgetLimits?.native?.some((entry) => !entry.unit.trim() || !Number.isFinite(entry.amount) || entry.amount < 0)) add('capacity_grant_native_limit_invalid', 'budgetLimits.native', 'Native limits require a unit and non-negative amount.');
	if (!Array.isArray(grant.executionProviderIds) || grant.executionProviderIds.length === 0) add('capacity_grant_execution_provider_required', 'executionProviderIds', 'At least one execution provider is required.');
	if (!grant.unmetered && grant.dailyAgentSecondsLimit == null && grant.monthlyAgentSecondsLimit == null) add('capacity_grant_budget_required', 'unmetered', 'A metered grant requires a daily or monthly agent-time limit.');
	if (grant.unmetered && (grant.dailyAgentSecondsLimit != null || grant.monthlyAgentSecondsLimit != null)) add('capacity_grant_budget_ambiguous', 'unmetered', 'An unmetered grant must not also declare agent-time limits.');
	if (grant.expiresAt && timestamp(grant.expiresAt) === null) add('capacity_grant_expiry_invalid', 'expiresAt', 'expiresAt must be an ISO timestamp.');
	return { ok: diagnostics.length === 0, diagnostics };
}

function timestamp(value: string | null | undefined) {
	const parsed = value ? Date.parse(value) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : null;
}
