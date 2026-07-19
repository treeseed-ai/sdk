import type {
	EngineeringWorkflowPromotionConfigV1,
	EngineeringWorkflowPromotionValidation,
} from '../contracts/workflow-promotion.ts';

const REQUIRED_ROLES = ['tester', 'engineer', 'reviewer', 'technicalWriter', 'releaser'] as const;

function text(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function validateEngineeringWorkflowPromotionConfig(
	value: unknown,
): EngineeringWorkflowPromotionValidation {
	const diagnostics: EngineeringWorkflowPromotionValidation['diagnostics'] = [];
	const input = value && typeof value === 'object' && !Array.isArray(value)
		? value as Partial<EngineeringWorkflowPromotionConfigV1>
		: {};
	if (input.schemaVersion !== 1) diagnostics.push({ code: 'schema_version_invalid', path: 'schemaVersion', message: 'schemaVersion must be 1.' });
	for (const field of ['id', 'projectId', 'decisionId', 'objectiveId', 'exactBaseRef'] as const) {
		if (!text(input[field])) diagnostics.push({ code: 'field_required', path: field, message: `${field} is required.` });
	}
	if (text(input.exactBaseRef) && !/^[0-9a-f]{7,64}$/iu.test(input.exactBaseRef!)) {
		diagnostics.push({ code: 'exact_base_ref_invalid', path: 'exactBaseRef', message: 'exactBaseRef must be an immutable hexadecimal commit id.' });
	}
	const roles = input.roles && typeof input.roles === 'object' ? input.roles : {};
	for (const role of REQUIRED_ROLES) {
		if (!text(roles[role])) diagnostics.push({ code: 'role_required', path: `roles.${role}`, message: `${role} role is required.` });
	}
	for (const optional of ['operations', 'researcher', 'architect'] as const) {
		if (roles[optional] != null && !text(roles[optional])) diagnostics.push({ code: 'role_invalid', path: `roles.${optional}`, message: `${optional} must be a non-empty string when supplied.` });
	}
	if (input.includeResearch === true && !text(roles.researcher)) diagnostics.push({ code: 'researcher_role_required', path: 'roles.researcher', message: 'includeResearch requires a researcher role.' });
	if (input.includeArchitecture === true && !text(roles.architect)) diagnostics.push({ code: 'architect_role_required', path: 'roles.architect', message: 'includeArchitecture requires an architect role.' });
	for (const [stage, amount] of Object.entries(input.credits ?? {})) {
		if (!Number.isFinite(amount) || Number(amount) <= 0) diagnostics.push({ code: 'credit_invalid', path: `credits.${stage}`, message: 'Stage credits must be positive finite numbers.' });
	}
	return { ok: diagnostics.length === 0, diagnostics };
}
