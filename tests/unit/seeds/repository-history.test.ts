import { describe, expect, it } from 'vitest';
import { classifyContentHistoryBranch } from '../../../src/seeds/repositories/repository-history.ts';

describe('content repository history migration recovery', () => {
	it('creates only when the source exists and the target is empty', () => {
		expect(classifyContentHistoryBranch({ sourceCommit: 'source', contentPath: 'docs/src/content', targetCommit: null })).toMatchObject({ action: 'create' });
		expect(classifyContentHistoryBranch({ sourceCommit: null, contentPath: null, targetCommit: null })).toMatchObject({ action: 'blocked' });
	});

	it('replays as noop only when all live commits and the verified receipt match', () => {
		const receipt = { sourceCommit: 'source', contentPath: 'docs/src/content', targetCommit: 'target', verified: true };
		expect(classifyContentHistoryBranch({ sourceCommit: 'source', contentPath: 'docs/src/content', targetCommit: 'target', receipt })).toMatchObject({ action: 'noop' });
		expect(classifyContentHistoryBranch({ sourceCommit: 'moved', contentPath: 'docs/src/content', targetCommit: 'target', receipt })).toMatchObject({ action: 'update' });
		expect(classifyContentHistoryBranch({ sourceCommit: 'source', contentPath: 'docs/src/content', targetCommit: 'unexpected', receipt })).toMatchObject({ action: 'blocked' });
	});
});
