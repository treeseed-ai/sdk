import { describe, expect, it } from 'vitest';
import { classifySupportWorkflow } from '../../../src/seeds/repositories/support-repository-workflow.ts';

describe('support repository workflow recovery', () => {
	it('adds a missing workflow and accepts an observed workflow', () => {
		expect(classifySupportWorkflow({ workflowPresent: false, sourceCommit: 'source', workflowDigest: 'workflow' })).toMatchObject({ action: 'update' });
		expect(classifySupportWorkflow({ workflowPresent: true, sourceCommit: 'source', workflowDigest: 'workflow' })).toMatchObject({ action: 'noop' });
	});

	it('blocks removal after a verified workflow commit', () => {
		expect(classifySupportWorkflow({ workflowPresent: false, sourceCommit: 'target', workflowDigest: 'workflow', receipt: { targetCommit: 'target', verified: true } })).toMatchObject({ action: 'blocked' });
	});
});
