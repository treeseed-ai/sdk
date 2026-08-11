import { describe,expect,it } from 'vitest';
import { resolveContentKeyTemplate } from '../../../src/operations/services/deploy/hosting/configured-surface-hosts.ts';

describe('content manifest key resolution', () => {
	const identity = { teamId: 'treeseed', projectId: 'admin' };
	const template = 'content/{teamId}/{projectId}/{environment}/channels/current.json';

	it('resolves staging and production to the publisher channel keys', () => {
		expect(resolveContentKeyTemplate(template, identity, { kind: 'persistent', scope: 'staging' }))
			.toBe('content/treeseed/admin/staging/channels/current.json');
		expect(resolveContentKeyTemplate(template, identity, { kind: 'persistent', scope: 'prod' }))
			.toBe('content/treeseed/admin/production/channels/current.json');
	});

	it('keeps local and branch runtime reads on non-production content', () => {
		expect(resolveContentKeyTemplate(template, identity, { kind: 'persistent', scope: 'local' }))
			.toBe('content/treeseed/admin/staging/channels/current.json');
		expect(resolveContentKeyTemplate(template, identity, { kind: 'branch', branchName: 'feature/content' }))
			.toBe('content/treeseed/admin/staging/channels/current.json');
	});
});
