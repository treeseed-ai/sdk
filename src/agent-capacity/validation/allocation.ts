import type {
	CapacityAllocationSetV2,
	CapacityGrantV2,
} from '../allocation.ts';

export interface CapacityAllocationDiagnostic {
	code: string;
	path: string;
	message: string;
}

export interface CapacityAllocationValidation {
	ok: boolean;
	diagnostics: CapacityAllocationDiagnostic[];
}

export function validateCapacityGrantV2(grant: CapacityGrantV2): CapacityAllocationValidation {
	const diagnostics: CapacityAllocationDiagnostic[] = [];
	const add = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
	for (const [path, value] of [['id', grant.id], ['membershipId', grant.membershipId], ['teamId', grant.teamId], ['providerId', grant.providerId], ['projectId', grant.projectId], ['environment', grant.environment]] as const) {
		if (!value?.trim()) add('capacity_grant_field_required', path, `${path} is required.`);
	}
	if (grant.schemaVersion !== 2) add('capacity_grant_schema_invalid', 'schemaVersion', 'Grant schemaVersion must be 2.');
	if (!Array.isArray(grant.allowedModes) || grant.allowedModes.length === 0 || grant.allowedModes.some((mode) => !['planning', 'acting'].includes(mode))) add('capacity_grant_modes_invalid', 'allowedModes', 'Grant allowedModes must contain planning and/or acting.');
	for (const [path, values] of [['executionProviderIds', grant.executionProviderIds], ['laneIds', grant.laneIds], ['capabilities', grant.capabilities]] as const) {
		if (!Array.isArray(values) || values.some((value) => !value?.trim()) || new Set(values).size !== values.length) add('capacity_grant_list_invalid', path, `${path} must contain unique non-empty strings.`);
	}
	for (const [path, value] of [['dailyCreditLimit', grant.dailyCreditLimit], ['monthlyCreditLimit', grant.monthlyCreditLimit]] as const) {
		if (value != null && (!Number.isFinite(value) || value < 0)) add('capacity_grant_limit_invalid', path, `${path} must be zero or greater when configured.`);
	}
	if (grant.maxConcurrentAssignments != null && (!Number.isInteger(grant.maxConcurrentAssignments) || grant.maxConcurrentAssignments < 0)) add('capacity_grant_concurrency_invalid', 'maxConcurrentAssignments', 'maxConcurrentAssignments must be a non-negative integer when configured.');
	if (!Array.isArray(grant.executionProviderIds) || grant.executionProviderIds.length === 0) add('capacity_grant_execution_provider_required', 'executionProviderIds', 'At least one execution provider is required.');
	if (!grant.unmetered && grant.dailyCreditLimit == null && grant.monthlyCreditLimit == null) add('capacity_grant_budget_required', 'unmetered', 'A metered grant requires a daily or monthly credit limit.');
	if (grant.unmetered && (grant.dailyCreditLimit != null || grant.monthlyCreditLimit != null)) add('capacity_grant_budget_ambiguous', 'unmetered', 'An unmetered grant must not also declare credit limits.');
	if (grant.expiresAt && timestamp(grant.expiresAt) === null) add('capacity_grant_expiry_invalid', 'expiresAt', 'expiresAt must be an ISO timestamp.');
	return { ok: diagnostics.length === 0, diagnostics };
}

function finitePercent(value: number) {
	return Number.isFinite(value) && value >= 0 && value <= 100;
}

function timestamp(value: string | null | undefined) {
	const parsed = value ? Date.parse(value) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : null;
}

export function validateCapacityAllocationSetV2(set: CapacityAllocationSetV2): CapacityAllocationValidation {
	const diagnostics: CapacityAllocationDiagnostic[] = [];
	const add = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
	if (set.schemaVersion !== 2) add('allocation_schema_invalid', 'schemaVersion', 'Allocation schemaVersion must be 2.');
	if (!['draft', 'validated', 'active', 'superseded', 'archived'].includes(set.status)) add('allocation_status_invalid', 'status', 'Allocation status is invalid.');
	if (!set.id?.trim()) add('allocation_id_required', 'id', 'Allocation id is required.');
	if (!set.teamId?.trim()) add('allocation_team_required', 'teamId', 'Allocation teamId is required.');
	if (!Number.isInteger(set.version) || set.version < 1) add('allocation_version_invalid', 'version', 'Allocation version must be a positive integer.');
	if (timestamp(set.effectiveFrom) === null) add('allocation_effective_from_invalid', 'effectiveFrom', 'effectiveFrom must be an ISO timestamp.');
	if (set.effectiveUntil && timestamp(set.effectiveUntil) === null) add('allocation_effective_until_invalid', 'effectiveUntil', 'effectiveUntil must be an ISO timestamp.');
	if (set.effectiveUntil && timestamp(set.effectiveFrom) !== null && (timestamp(set.effectiveUntil) ?? 0) <= (timestamp(set.effectiveFrom) ?? 0)) add('allocation_effective_interval_invalid', 'effectiveUntil', 'effectiveUntil must be later than effectiveFrom.');
	if (!finitePercent(set.reservePolicy?.percent)) add('allocation_reserve_invalid', 'reservePolicy.percent', 'Reserve percent must be between 0 and 100.');
	if (!['deny', 'approval-required', 'borrow'].includes(set.reservePolicy?.overflow)) add('allocation_reserve_overflow_invalid', 'reservePolicy.overflow', 'Reserve overflow must be deny, approval-required, or borrow.');
	const slices = Array.isArray(set.slices) ? set.slices : [];
	const borrowingRules = Array.isArray(set.borrowingRules) ? set.borrowingRules : [];
	if (slices.length === 0) add('allocation_slices_required', 'slices', 'At least one project allocation slice is required.');
	const ids = new Set<string>();
	for (const [index, slice] of slices.entries()) {
		const path = `slices[${index}]`;
		if (!slice || typeof slice !== 'object') {
			add('allocation_slice_invalid', path, 'Allocation slice must be an object.');
			continue;
		}
		if (!slice.id?.trim() || ids.has(slice.id)) add('allocation_slice_id_invalid', `${path}.id`, 'Slice id must be non-empty and unique.');
		ids.add(slice.id);
		if (!['project', 'agent-class', 'mode'].includes(slice.scope)) add('allocation_slice_scope_invalid', `${path}.scope`, 'Slice scope must be project, agent-class, or mode.');
		if (!slice.targetId?.trim()) add('allocation_slice_target_required', `${path}.targetId`, 'Slice targetId is required.');
		if (!slice.policy || typeof slice.policy !== 'object') {
			add('allocation_slice_policy_invalid', `${path}.policy`, 'Slice policy must be an object.');
			continue;
		}
		const { minPercent, targetPercent, maxPercent, hardCapPercent } = slice.policy;
		if (![minPercent, targetPercent, maxPercent, hardCapPercent].every(finitePercent) || !(minPercent <= targetPercent && targetPercent <= maxPercent && maxPercent <= hardCapPercent)) {
			add('allocation_slice_bounds_invalid', `${path}.policy`, 'Slice bounds must satisfy 0 <= min <= target <= max <= hardCap <= 100.');
		}
	}
	for (const [index, slice] of slices.entries()) {
		if (!slice || typeof slice !== 'object') continue;
		if (slice.parentSliceId && !ids.has(slice.parentSliceId)) add('allocation_parent_missing', `slices[${index}].parentSliceId`, 'Parent slice must exist in the allocation set.');
		const parent = slice.parentSliceId ? slices.find((candidate) => candidate && typeof candidate === 'object' && candidate.id === slice.parentSliceId) : null;
		if (!slice.parentSliceId && slice.scope !== 'project') add('allocation_root_scope_invalid', `slices[${index}].scope`, 'Only project slices may exist at the allocation root.');
		if (parent && ((slice.scope === 'agent-class' && parent.scope !== 'project') || (slice.scope === 'mode' && parent.scope !== 'agent-class') || slice.scope === 'project')) add('allocation_scope_hierarchy_invalid', `slices[${index}].scope`, 'Allocation hierarchy must be project, then agent-class, then mode.');
		const ancestors = new Set<string>();
		let current = slice;
		while (current.parentSliceId) {
			if (ancestors.has(current.parentSliceId) || current.parentSliceId === slice.id) {
				add('allocation_cycle_invalid', `slices[${index}].parentSliceId`, 'Allocation slice hierarchy must not contain cycles.');
				break;
			}
			ancestors.add(current.parentSliceId);
			const next = slices.find((candidate) => candidate && typeof candidate === 'object' && candidate.id === current.parentSliceId);
			if (!next) break;
			current = next;
		}
	}
	const validSlices = slices.filter((slice) => slice && typeof slice === 'object');
	const parentKeys = new Set(validSlices.map((slice) => slice.parentSliceId ?? 'root'));
	for (const parentKey of parentKeys) {
		const siblings = validSlices.filter((slice) => (slice.parentSliceId ?? 'root') === parentKey);
		const targetTotal = siblings.reduce((total, slice) => total + Number(slice.policy?.targetPercent ?? Number.NaN), 0);
		const expected = parentKey === 'root' ? 100 - set.reservePolicy.percent : 100;
		if (Math.abs(targetTotal - expected) > 0.000001) add('allocation_target_total_invalid', `slices(parent=${parentKey})`, `Sibling target percentages must total ${expected}.`);
	}
	const ruleIds = new Set<string>();
	for (const [index, rule] of borrowingRules.entries()) {
		if (!rule || typeof rule !== 'object') {
			add('allocation_borrowing_rule_invalid', `borrowingRules[${index}]`, 'Borrowing rule must be an object.');
			continue;
		}
		if (!rule.id?.trim() || ruleIds.has(rule.id)) add('allocation_borrowing_id_invalid', `borrowingRules[${index}].id`, 'Borrowing rule id must be non-empty and unique.');
		ruleIds.add(rule.id);
		if (!ids.has(rule.fromSliceId) || !ids.has(rule.toSliceId)) add('allocation_borrowing_slice_missing', `borrowingRules[${index}]`, 'Borrowing rule slices must exist.');
		if (rule.fromSliceId === rule.toSliceId) add('allocation_borrowing_self_invalid', `borrowingRules[${index}]`, 'A slice cannot borrow from itself.');
		const from = validSlices.find((slice) => slice.id === rule.fromSliceId);
		const to = validSlices.find((slice) => slice.id === rule.toSliceId);
		if (from && to && (from.scope !== to.scope || (from.parentSliceId ?? null) !== (to.parentSliceId ?? null))) add('allocation_borrowing_scope_invalid', `borrowingRules[${index}]`, 'Borrowing is allowed only between sibling slices at the same scope.');
		if (!finitePercent(rule.maxPercent) || rule.maxPercent === 0) add('allocation_borrowing_percent_invalid', `borrowingRules[${index}].maxPercent`, 'Borrowing maxPercent must be greater than zero and no more than 100.');
	}
	return { ok: diagnostics.length === 0, diagnostics };
}
