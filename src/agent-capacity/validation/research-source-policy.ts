import type { ResearchSourcePolicy } from '../contracts/support/research-source-policy.ts';

export interface ResearchSourcePolicyDiagnostic {
	code: string;
	path: string;
	message: string;
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function validateResearchSourcePolicy(value: unknown) {
	const policy = record(value);
	const diagnostics: ResearchSourcePolicyDiagnostic[] = [];
	const add = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
	if (policy.schemaVersion !== 1) add('research_source_policy_version_invalid', 'schemaVersion', 'schemaVersion must be 1.');
	if (!Array.isArray(policy.allowedDomains) || policy.allowedDomains.length === 0 || policy.allowedDomains.some((domain) => typeof domain !== 'string' || !domain.trim() || domain.includes('/') || domain.includes(':'))) {
		add('research_source_policy_domains_invalid', 'allowedDomains', 'allowedDomains must contain hostnames without schemes, ports, or paths.');
	}
	if (!Number.isInteger(policy.requestTimeoutMs) || Number(policy.requestTimeoutMs) < 100 || Number(policy.requestTimeoutMs) > 60_000) add('research_source_policy_timeout_invalid', 'requestTimeoutMs', 'requestTimeoutMs must be an integer from 100 through 60000.');
	if (!Number.isInteger(policy.maxResponseBytes) || Number(policy.maxResponseBytes) < 1_024 || Number(policy.maxResponseBytes) > 1_000_000) add('research_source_policy_size_invalid', 'maxResponseBytes', 'maxResponseBytes must be an integer from 1024 through 1000000.');
	if (!Number.isInteger(policy.maxRedirects) || Number(policy.maxRedirects) < 0 || Number(policy.maxRedirects) > 10) add('research_source_policy_redirects_invalid', 'maxRedirects', 'maxRedirects must be an integer from zero through ten.');
	if (!Array.isArray(policy.allowedContentTypes) || policy.allowedContentTypes.length === 0 || policy.allowedContentTypes.some((type) => typeof type !== 'string' || !type.trim())) add('research_source_policy_content_types_invalid', 'allowedContentTypes', 'allowedContentTypes must be a non-empty string array.');
	return { ok: diagnostics.length === 0, diagnostics };
}

export function assertResearchSourcePolicy(value: unknown): ResearchSourcePolicy {
	const result = validateResearchSourcePolicy(value);
	if (!result.ok) throw new Error(`Invalid research source policy: ${result.diagnostics.map((item) => `${item.code} at ${item.path}`).join(', ')}`);
	return value as ResearchSourcePolicy;
}
