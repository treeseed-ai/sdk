import { describe, expect, it } from 'vitest';
import { validateResearchSourcePolicy } from '../../../src/agent-capacity/validation/research-source-policy.ts';

describe('ResearchSourcePolicy', () => {
	it('accepts a bounded explicit source policy', () => {
		expect(validateResearchSourcePolicy({
			schemaVersion: 1,
			allowedDomains: ['example.com', 'docs.example.org'],
			requestTimeoutMs: 20_000,
			maxResponseBytes: 250_000,
			maxRedirects: 3,
			allowedContentTypes: ['text/*', 'application/json'],
		}).ok).toBe(true);
	});

	it('rejects missing allowlists and unsafe bounds', () => {
		const result = validateResearchSourcePolicy({ schemaVersion: 1, allowedDomains: [], requestTimeoutMs: 0, maxResponseBytes: 10_000_000, maxRedirects: 20, allowedContentTypes: [] });
		expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
			'research_source_policy_domains_invalid',
			'research_source_policy_timeout_invalid',
			'research_source_policy_size_invalid',
			'research_source_policy_redirects_invalid',
			'research_source_policy_content_types_invalid',
		]));
	});
});
