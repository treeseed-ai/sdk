import type { AgentLabWorkdaySnapshot } from '../../types.ts';

type Row = Record<string,unknown>;
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function structuredContentDiagnostic(value: unknown) {
	const payload = record(record(value).payload);
	const details = record(payload.details);
	const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : Array.isArray(details.diagnostics) ? details.diagnostics : [];
	const path = text(payload.path) || text(details.path);
	const model = text(payload.model) || text(details.model);
	const code = text(payload.code) || text(record(value).code);
	const fields = diagnostics.slice(0,5).map((candidate) => {
		const diagnostic = record(candidate); const field = text(diagnostic.field); const diagnosticCode = text(diagnostic.code); const message = text(diagnostic.message);
		return [field && `${field}:`,message,diagnosticCode && `(${diagnosticCode})`].filter(Boolean).join(' ');
	}).filter(Boolean);
	if (!code && !path && !model && !fields.length) return '';
	return [code,model && `model=${model}`,path && `path=${path}`,...fields].filter(Boolean).join(' · ');
}

export function agentLabDiagnostic(value: unknown, prefix = '') {
	const raw = value instanceof Error ? value.message : String(value);
	const payload = raw.search(/:\s*\[\{/u);
	const summary = payload > 0 ? raw.slice(0, payload) : raw;
	const structured = structuredContentDiagnostic(value);
	return `${prefix}${summary}${structured ? ` · ${structured}` : ''}`.slice(0, 1_000);
}

export function withAgentLabDiagnostic(day: AgentLabWorkdaySnapshot, value: unknown, prefix = '') {
	const message = agentLabDiagnostic(value, prefix);
	return day.diagnostics.includes(message) ? day : { ...day, diagnostics: [...day.diagnostics, message] };
}

export function localAgentLabApiConfig(env: Record<string, string | undefined>) {
	const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
	return {
		apiUrl: text(env.TREESEED_CAPACITY_ACCEPTANCE_API_URL) || text(env.TREESEED_API_BASE_URL) || 'http://127.0.0.1:3000',
		adminToken: text(env.TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN) || 'tsk_local_treeseed_acceptance_admin',
	};
}
