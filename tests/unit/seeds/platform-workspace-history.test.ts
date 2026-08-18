import { describe, expect, it } from 'vitest';
import { parseDeployConfig } from '../../../src/platform/deploy-config/parse-deploy-config.ts';
import {
	classifyPlatformWorkspaceBranch,
	normalizePlatformBoundaryVerifier,
	platformConfigurationAssets,
	platformDeployConfig,
	platformVerificationFiles,
} from '../../../src/seeds/workspaces/platform-workspace-history.ts';

describe('Platform workspace migration recovery', () => {
	it('creates only an empty target and blocks unrecognized history', () => {
		expect(classifyPlatformWorkspaceBranch({ sourceDigest: 'next', targetCommit: null })).toMatchObject({ action: 'create' });
		expect(classifyPlatformWorkspaceBranch({ sourceDigest: 'next', targetCommit: 'unknown' })).toMatchObject({ action: 'blocked' });
	});

	it('replays exact snapshots and fast-forwards journal-owned changes', () => {
		const receipt = { sourceDigest: 'old', targetCommit: 'owned', verified: true };
		expect(classifyPlatformWorkspaceBranch({ sourceDigest: 'old', targetCommit: 'owned', receipt })).toMatchObject({ action: 'noop' });
		expect(classifyPlatformWorkspaceBranch({ sourceDigest: 'next', targetCommit: 'owned', receipt })).toMatchObject({ action: 'update' });
	});

	it('generates the canonical local-managed Codex Platform template', () => {
		const config = parseDeployConfig(platformDeployConfig());

		expect(config.authority).toEqual({ kind: 'customer-platform' });
		expect(config.market).toEqual({
			profile: 'treeseed',
			kind: 'singleton_external',
			baseUrl: 'https://api.treeseed.dev',
			provisioningAuthority: 'forbidden',
		});
		expect(config.controlPlane).toEqual({ mode: 'managed' });
		expect(config.runtime).toEqual({ mode: 'none', registration: 'none' });
		expect(config.processing).toEqual({ mode: 'local', providerRef: 'codex-sub' });
		expect(config.surfaces?.web?.enabled).toBe(true);
		expect(config.services.api).toMatchObject({ enabled: true, provider: 'local' });
		expect(config.services.treedx).toMatchObject({ enabled: true, provider: 'local' });
	});

	it('materializes byte-identical configuration assets into templates and the Platform root', () => {
		const seed = 'name: platform\n';
		const scene = 'kind: scene\n';
		const assets = platformConfigurationAssets(seed, scene, ['platform-local-managed-codex']);

		expect(assets).toContainEqual({ path: 'scenes/team-project-portfolio-demo.yaml', content: scene });
		expect(assets).toContainEqual({ path: 'templates/platform-local-managed-codex/template/scenes/team-project-portfolio-demo.yaml', content: scene });
		expect(assets).toContainEqual({ path: 'templates/platform-local-managed-codex/template/seeds/platform.yaml', content: seed });
		expect(assets.every((asset) => asset.content.endsWith('\n'))).toBe(true);
	});

	it('verifies the canonical inline Platform authority and Market configuration', () => {
		const normalized = normalizePlatformBoundaryVerifier('/^\\s*kind: customer-platform\\s*$/mu /^\\s*profile: treeseed\\s*$/mu');
		expect(normalized).toContain('^authority: \\{ kind: customer-platform \\}\\s*$');
		expect(normalized).toContain('^market: \\{ profile: treeseed \\}\\s*$');
	});

	it('carries the complete Market-owned agent proof catalog without a Market checkout', () => {
		expect(platformVerificationFiles).toEqual(expect.arrayContaining([
			'guarantees/agent/system/source-golden.guarantee.yaml',
			'guarantees/capacity/research/verify-autonomous-cited-research-starter.guarantee.yaml',
			'guarantees/agent/system/guide-golden.guarantee.yaml',
			'guarantees/verifiers/service-workflows.verifiers.yaml',
			'scripts/guarantees/verify-agent-capability.ts',
		]));
		expect(new Set(platformVerificationFiles).size).toBe(platformVerificationFiles.length);
	});

});
