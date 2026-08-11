import { describe, expect, it } from 'vitest';
import { classifyPlatformWorkspaceBranch } from '../../../src/seeds/workspaces/platform-workspace-history.ts';

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
});
