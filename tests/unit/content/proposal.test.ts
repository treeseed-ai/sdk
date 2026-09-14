import { describe, expect, it } from 'vitest';
import { validatePortableContentData } from '../../../src/content/validation/portable-content-data.ts';

describe('proposal content', () => {
	it('accepts a draft only when its executable plan is structurally complete', () => {
		const result = validatePortableContentData('proposal', {
			schemaVersion: 'treeseed.proposal/v1', id: 'repair-admission', projectId: 'sdk',
			title: 'Repair assignment admission', request: 'Repair assignment admission.',
			summary: 'Use the living graph.', status: 'draft', executionPlan: { workItems: [{
				id: 'repair', activity: 'acting', agentClass: 'engineer', workspace: 'read-only', review: 'none',
				objective: 'Repair admission.', estimate: { minimumSeconds: 60, expectedSeconds: 120, maximumSeconds: 240 },
				dependsOn: [], requestedPermissions: { content: { read: ['proposal'], write: [] }, tools: ['source.read'] },
				acceptanceCriteria: ['Focused tests pass.'],
			}] },
		});
		expect(result.ok).toBe(true);
	});

	it('does not accept an incomplete proposal as complete content', () => {
		const result = validatePortableContentData('proposal', {
			schemaVersion: 'treeseed.proposal/v1', id: 'repair-admission', projectId: 'sdk',
			title: 'Repair assignment admission', request: 'Repair assignment admission.', status: 'ready',
		});
		expect(result.ok).toBe(false);
	});
});
