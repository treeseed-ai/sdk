import type { AgentLabWorkdaySnapshot } from '../../types.ts';

export function agentLabDiagnostic(value: unknown, prefix = '') {
	const raw = value instanceof Error ? value.message : String(value);
	const payload = raw.search(/:\s*\[\{/u);
	const summary = payload > 0 ? raw.slice(0, payload) : raw;
	return `${prefix}${summary}`.slice(0, 1_000);
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
