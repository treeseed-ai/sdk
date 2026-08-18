import { describe, expect, it } from 'vitest';
import { buildGitHubRepositoryAdapter } from '../../../../src/reconcile/builtin-adapters/repositories/build-github-repository-adapter';

const unit = {
	unitId: 'github-repository:treeseed-ai/example',
	unitType: 'github-repository',
	provider: 'github',
	logicalName: 'treeseed-ai/example',
	spec: {
		repository: 'treeseed-ai/example',
		description: 'Example repository.',
		homepageUrl: null,
		visibility: 'public',
		lifecycle: 'adopt-only',
		deletionPolicy: 'retain',
		issues: true,
		projects: false,
		wiki: false,
	},
};

function observed(live: Record<string, unknown>, exists = true) {
	return { exists, status: exists ? 'ready' : 'missing', live, locators: {}, warnings: [] };
}

const matching = {
	slug: 'treeseed-ai/example',
	description: 'Example repository.',
	homepageUrl: null,
	visibility: 'public',
	hasIssues: true,
	hasProjects: false,
	hasWiki: false,
	actionsEnabled: true,
	defaultBranch: 'main',
	archived: false,
};

describe('GitHub repository reconciliation', () => {
	it('blocks a missing adopt-only repository', () => {
		const adapter = buildGitHubRepositoryAdapter();
		const diff = adapter.diff({ unit, observed: observed({}, false) } as never);
		expect(diff.action).toBe('blocked');
		expect(diff.reasons.join(' ')).toContain('adopt-only');
	});

	it('accepts an exact repository and verifies every declared metadata field', () => {
		const adapter = buildGitHubRepositoryAdapter();
		const input = { unit, observed: observed(matching) } as never;
		expect(adapter.diff(input).action).toBe('noop');
		expect(adapter.verify(input).verified).toBe(true);
	});

	it('detects description, visibility, feature, and archive drift', () => {
		const adapter = buildGitHubRepositoryAdapter();
		const drifts: Array<[string, Record<string, unknown>]> = [
			['description', { description: 'Wrong description.' }],
			['visibility', { visibility: 'private' }],
			['hasIssues', { hasIssues: false }],
			['actionsEnabled', { actionsEnabled: false }],
			['defaultBranch', { defaultBranch: 'staging' }],
			['archived', { archived: true }],
		];
		for (const [field, drift] of drifts) {
			const input = { unit, observed: observed({ ...matching, ...drift }) } as never;
			const diff = adapter.diff(input);
			expect(diff.action, JSON.stringify(drift)).toBe('update');
			expect(diff.reasons[0], JSON.stringify(drift)).toContain(`field ${field} drifted`);
			expect(adapter.verify(input).verified, JSON.stringify(drift)).toBe(false);
		}
	});
});
