import { describe, expect, it } from 'vitest';
import { classifySourceHistoryBranch } from '../../../src/seeds/repositories/source-repository-history.ts';

describe('source repository history migration recovery', () => {
	it('creates only into an empty branch', () => {
		expect(classifySourceHistoryBranch({ sourceCommit: 'source', targetCommit: null })).toMatchObject({ action: 'create' });
		expect(classifySourceHistoryBranch({ sourceCommit: null, targetCommit: null })).toMatchObject({ action: 'blocked' });
	});

	it('requires an exact verified receipt for replay', () => {
		const receipt = { sourceCommit: 'source', targetCommit: 'target', verified: true };
		expect(classifySourceHistoryBranch({ sourceCommit: 'source', targetCommit: 'target', workflow: null, receipt })).toMatchObject({ action: 'noop' });
		expect(classifySourceHistoryBranch({ sourceCommit: 'moved', targetCommit: 'target', receipt })).toMatchObject({ action: 'blocked' });
		expect(classifySourceHistoryBranch({ sourceCommit: 'source', targetCommit: 'other', receipt })).toMatchObject({ action: 'blocked' });
	});

	it('fast-forwards a prior exact-history receipt when the desired workflow is introduced', () => {
		const receipt = { sourceCommit: 'source', targetCommit: 'source', verified: true };
		expect(classifySourceHistoryBranch({ sourceCommit: 'source', targetCommit: 'source', workflow: 'verify.yml', receipt })).toMatchObject({ action: 'update' });
	});
});
