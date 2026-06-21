import { describe, expect, it } from 'vitest';
import {
	createTreeseedManagedToolEnv,
	resolveTreeseedGitHubToken,
	resolveTreeseedRailwayApiToken,
	resolveTreeseedCloudflareApiToken,
	withTreeseedServiceCredentialEnv,
} from '../../src/index.ts';

describe('service credential translation', () => {
	it('resolves only canonical Treeseed credential names as config input', () => {
		expect(resolveTreeseedGitHubToken({ TREESEED_GITHUB_TOKEN: 'gh-canonical', GH_TOKEN: 'gh-native' })).toBe('gh-canonical');
		expect(resolveTreeseedGitHubToken({ TREESEED_GH_TOKEN: 'gh-legacy' })).toBe('');
		expect(resolveTreeseedGitHubToken({ GITHUB_TOKEN: 'github-native' })).toBe('');
		expect(resolveTreeseedGitHubToken({ GH_TOKEN: 'gh-native' })).toBe('');
		expect(resolveTreeseedCloudflareApiToken({ TREESEED_CLOUDFLARE_API_TOKEN: 'cf-canonical', CLOUDFLARE_API_TOKEN: 'cf-native' })).toBe('cf-canonical');
		expect(resolveTreeseedRailwayApiToken({ TREESEED_RAILWAY_API_TOKEN: 'railway-canonical', RAILWAY_API_TOKEN: 'railway-native' })).toBe('railway-canonical');
	});

	it('emits service-native names only in translated execution env', () => {
		const translated = withTreeseedServiceCredentialEnv({
			TREESEED_GITHUB_TOKEN: 'gh-canonical',
			TREESEED_CLOUDFLARE_API_TOKEN: 'cf-canonical',
			TREESEED_CLOUDFLARE_ACCOUNT_ID: 'cf-account',
			TREESEED_RAILWAY_API_TOKEN: 'railway-canonical',
			TREESEED_DOCKERHUB_USERNAME: 'docker-user',
			TREESEED_DOCKERHUB_TOKEN: 'docker-canonical',
			TREESEED_CODEX_API_KEY: 'codex-canonical',
		});
		expect(translated.GH_TOKEN).toBe('gh-canonical');
		expect(translated.GITHUB_TOKEN).toBe('gh-canonical');
		expect(translated.CLOUDFLARE_API_TOKEN).toBe('cf-canonical');
		expect(translated.CLOUDFLARE_ACCOUNT_ID).toBe('cf-account');
		expect(translated.RAILWAY_API_TOKEN).toBe('railway-canonical');
		expect(translated.DOCKERHUB_USERNAME).toBe('docker-user');
		expect(translated.DOCKERHUB_TOKEN).toBe('docker-canonical');
		expect(translated.CODEX_API_KEY).toBe('codex-canonical');
	});

	it('translates canonical credentials for managed CLI tool subprocesses', () => {
		const translated = createTreeseedManagedToolEnv({
			TREESEED_GITHUB_TOKEN: 'gh-canonical',
			TREESEED_CLOUDFLARE_API_TOKEN: 'cf-canonical',
			TREESEED_RAILWAY_API_TOKEN: 'railway-canonical',
		} as NodeJS.ProcessEnv);
		expect(translated.GH_TOKEN).toBe('gh-canonical');
		expect(translated.GITHUB_TOKEN).toBe('gh-canonical');
		expect(translated.CLOUDFLARE_API_TOKEN).toBe('cf-canonical');
		expect(translated.RAILWAY_API_TOKEN).toBe('railway-canonical');
		expect(translated.GH_PROMPT_DISABLED).toBe('1');
	});
});
