import { describe, expect, it } from 'vitest';
import { parseDeployConfig } from '../../../src/platform/deploy-config/parse-deploy-config.ts';
import {
	classifyPlatformWorkspaceBranch,
	platformDeployConfig,
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

	it('generates a non-hosted customer Platform bound to the singleton Market', () => {
		const config = parseDeployConfig(platformDeployConfig());

		expect(config.authority).toEqual({ kind: 'customer-platform' });
		expect(config.market).toEqual({
			profile: 'treeseed',
			kind: 'singleton_external',
			baseUrl: 'https://api.treeseed.dev',
			provisioningAuthority: 'forbidden',
		});
		expect(config.controlPlane).toEqual({
			mode: 'market-passthrough',
			baseUrl: 'https://api.treeseed.dev',
		});
		expect(config.runtime).toEqual({ mode: 'none', registration: 'none' });
		expect(config.processing).toEqual({ mode: 'none' });
		expect(config.surfaces?.web?.enabled).toBe(false);
		expect(config.services).toEqual({});
	});
});
