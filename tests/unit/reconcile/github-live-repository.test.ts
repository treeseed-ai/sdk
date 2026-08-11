import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveMachineEnvironmentValues = vi.fn();
const runRepositoryGit = vi.fn();

vi.mock('../../../src/operations/services/configuration/config-runtime.ts', () => ({
	resolveMachineEnvironmentValues,
}));

vi.mock('../../../src/operations/services/operations/git-runner.ts', () => ({
	runRepositoryGit,
}));

const { resolveCurrentGitHubRepository } = await import('../../../src/reconcile/repositories/live-acceptance-github-client.ts');

describe('GitHub live repository resolution', () => {
	beforeEach(() => {
		resolveMachineEnvironmentValues.mockReset();
		runRepositoryGit.mockReset();
	});

	it('uses machine-wide local repository identity for staging smoke tests', () => {
		resolveMachineEnvironmentValues.mockImplementation((_cwd, scope) => scope === 'local'
			? { TREESEED_GITHUB_OWNER: 'treeseed-ai', TREESEED_GITHUB_REPOSITORY_NAME: 'market' }
			: {});
		runRepositoryGit.mockReturnValue({ stdout: 'https://github.com/knowledge-coop/market.git\n' });

		expect(resolveCurrentGitHubRepository('/workspace', {})).toBe('treeseed-ai/market');
		expect(runRepositoryGit).not.toHaveBeenCalled();
	});

	it('allows an environment-specific machine identity to override the local default', () => {
		resolveMachineEnvironmentValues.mockImplementation((_cwd, scope) => scope === 'local'
			? { TREESEED_GITHUB_OWNER: 'treeseed-ai', TREESEED_GITHUB_REPOSITORY_NAME: 'market' }
			: { TREESEED_GITHUB_REPOSITORY_NAME: 'platform' });

		expect(resolveCurrentGitHubRepository('/workspace', {})).toBe('treeseed-ai/platform');
	});
});
