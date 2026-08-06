export const AGENT_SIGNAL_SCHEMA = 'treeseed.agent-signal/v1' as const;
export const AGENT_SIGNAL_ORIGINS = ['treedx-change', 'deterministic-handler', 'agent-tool'] as const;

export interface AgentSignalContract {
	schemaVersion: typeof AGENT_SIGNAL_SCHEMA;
	id: string;
	label: string;
	description: string;
	subjectKinds: string[];
	allowedOrigins: Array<typeof AGENT_SIGNAL_ORIGINS[number]>;
	payloadSchema: Record<string, unknown>;
	filterableFields?: string[];
	commitEvidence: 'required' | 'optional' | 'forbidden';
	allowedProducerClasses?: string[];
	subscriberActivityProfiles?: string[];
	idempotency: 'causation-subject' | 'commit-subject' | 'explicit-key';
	supersession: 'append' | 'replace-subject' | 'replace-correlation';
	coalescing: 'none' | 'latest-subject';
	evidenceRequirements?: string[];
	relationSemantics?: string[];
}

export interface AgentSignalValidation {
	ok: boolean;
	diagnostics: Array<{ code: string; path: string; message: string }>;
	value?: AgentSignalContract;
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.trim()); }

export function validateAgentSignalContract(value: unknown): AgentSignalValidation {
	const diagnostics: AgentSignalValidation['diagnostics'] = [];
	if (!record(value)) return { ok: false, diagnostics: [{ code: 'agent_signal_invalid', path: '', message: 'Signal contract must be an object.' }] };
	const text = (key: string) => { if (typeof value[key] !== 'string' || !String(value[key]).trim()) diagnostics.push({ code: 'agent_signal_text_required', path: key, message: `${key} must be a non-empty string.` }); };
	if (value.schemaVersion !== AGENT_SIGNAL_SCHEMA) diagnostics.push({ code: 'agent_signal_schema_invalid', path: 'schemaVersion', message: `schemaVersion must be ${AGENT_SIGNAL_SCHEMA}.` });
	for (const key of ['id', 'label', 'description']) text(key);
	for (const key of ['subjectKinds', 'allowedOrigins']) if (!strings(value[key])) diagnostics.push({ code: 'agent_signal_list_required', path: key, message: `${key} must contain non-empty strings.` });
	if (Array.isArray(value.allowedOrigins) && value.allowedOrigins.some((origin) => !(AGENT_SIGNAL_ORIGINS as readonly unknown[]).includes(origin))) diagnostics.push({ code: 'agent_signal_origin_invalid', path: 'allowedOrigins', message: 'allowedOrigins contains an unsupported origin.' });
	if (!record(value.payloadSchema)) diagnostics.push({ code: 'agent_signal_payload_schema_invalid', path: 'payloadSchema', message: 'payloadSchema must be an object.' });
	if (!['required', 'optional', 'forbidden'].includes(String(value.commitEvidence))) diagnostics.push({ code: 'agent_signal_commit_policy_invalid', path: 'commitEvidence', message: 'commitEvidence must be required, optional, or forbidden.' });
	if (!['causation-subject', 'commit-subject', 'explicit-key'].includes(String(value.idempotency))) diagnostics.push({ code: 'agent_signal_idempotency_invalid', path: 'idempotency', message: 'Unknown idempotency policy.' });
	if (!['append', 'replace-subject', 'replace-correlation'].includes(String(value.supersession))) diagnostics.push({ code: 'agent_signal_supersession_invalid', path: 'supersession', message: 'Unknown supersession policy.' });
	if (!['none', 'latest-subject'].includes(String(value.coalescing))) diagnostics.push({ code: 'agent_signal_coalescing_invalid', path: 'coalescing', message: 'Unknown coalescing policy.' });
	for (const key of ['filterableFields', 'allowedProducerClasses', 'subscriberActivityProfiles', 'evidenceRequirements', 'relationSemantics']) if (value[key] !== undefined && !strings(value[key])) diagnostics.push({ code: 'agent_signal_list_invalid', path: key, message: `${key} must contain non-empty strings.` });
	return diagnostics.length ? { ok: false, diagnostics } : { ok: true, diagnostics, value: value as unknown as AgentSignalContract };
}
