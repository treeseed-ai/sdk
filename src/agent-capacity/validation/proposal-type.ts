export const PROPOSAL_TYPE_SCHEMA = 'treeseed.proposal-type/v1' as const;
export interface ProposalTypeContract {
	schemaVersion: typeof PROPOSAL_TYPE_SCHEMA;
	id: string;
	label: string;
	description: string;
	defaultPriority?: 'low' | 'normal' | 'high' | 'urgent';
	subscriberSignals?: string[];
	requiredReviewerClasses?: string[];
	metadata?: Record<string, unknown>;
}
export interface ProposalTypeValidation { ok: boolean; diagnostics: Array<{ code: string; path: string; message: string }>; value?: ProposalTypeContract }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
export function validateProposalTypeContract(value: unknown): ProposalTypeValidation {
	const diagnostics: ProposalTypeValidation['diagnostics'] = [];
	if (!record(value)) return { ok: false, diagnostics: [{ code: 'proposal_type_invalid', path: '', message: 'Proposal type contract must be an object.' }] };
	if (value.schemaVersion !== PROPOSAL_TYPE_SCHEMA) diagnostics.push({ code: 'proposal_type_schema_invalid', path: 'schemaVersion', message: `schemaVersion must be ${PROPOSAL_TYPE_SCHEMA}.` });
	for (const key of ['id','label','description']) if (typeof value[key] !== 'string' || !String(value[key]).trim()) diagnostics.push({ code: 'proposal_type_text_required', path: key, message: `${key} must be a non-empty string.` });
	if (typeof value.id === 'string' && !/^[a-z][a-z0-9-]*$/u.test(value.id)) diagnostics.push({ code: 'proposal_type_id_invalid', path: 'id', message: 'id must use lowercase kebab-case.' });
	if (value.defaultPriority !== undefined && !['low','normal','high','urgent'].includes(String(value.defaultPriority))) diagnostics.push({ code: 'proposal_type_priority_invalid', path: 'defaultPriority', message: 'defaultPriority must be low, normal, high, or urgent.' });
	for (const key of ['subscriberSignals', 'requiredReviewerClasses']) if (value[key] !== undefined && (!Array.isArray(value[key]) || !value[key].length || value[key].some((entry) => typeof entry !== 'string' || !entry.trim()))) diagnostics.push({ code: 'proposal_type_list_invalid', path: key, message: `${key} must contain non-empty strings.` });
	if (value.metadata !== undefined && !record(value.metadata)) diagnostics.push({ code: 'proposal_type_metadata_invalid', path: 'metadata', message: 'metadata must be an object.' });
	return diagnostics.length ? { ok: false, diagnostics } : { ok: true, diagnostics, value: value as unknown as ProposalTypeContract };
}
