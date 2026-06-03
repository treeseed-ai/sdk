import { describe, expect, it } from 'vitest';
import {
	TreeDbApiError,
	TreeDbClient,
	TreeDbFederatedClient,
	TreeDbGraphAdapter,
	TreeDbQueryAdapter,
	TreeDbRegistryClient,
	TreeDbRepositoryAdapter,
	TreeDbWorkspaceAdapter,
} from '../../src/treedb/index.ts';
import packageJson from '../../package.json' with { type: 'json' };

describe('TreeDB SDK public exports', () => {
	it('keeps the TreeDB export surface available', () => {
		expect(TreeDbClient).toBeTypeOf('function');
		expect(TreeDbRegistryClient).toBeTypeOf('function');
		expect(TreeDbFederatedClient).toBeTypeOf('function');
		expect(TreeDbApiError).toBeTypeOf('function');
		expect(TreeDbRepositoryAdapter).toBeTypeOf('function');
		expect(TreeDbQueryAdapter).toBeTypeOf('function');
		expect(TreeDbGraphAdapter).toBeTypeOf('function');
		expect(TreeDbWorkspaceAdapter).toBeTypeOf('function');
		expect(packageJson.exports).toHaveProperty('./treedb');
	});

	it('preserves TreeDbApiError diagnostic fields', () => {
		const payload = { ok: false, error: { code: 'permission_denied', message: 'Denied.' } };
		const error = new TreeDbApiError('Denied.', {
			status: 403,
			code: 'permission_denied',
			details: { capability: 'files:read' },
			payload,
		});

		expect(error).toMatchObject({
			name: 'TreeDbApiError',
			code: 'permission_denied',
			status: 403,
			details: { capability: 'files:read' },
			payload,
		});
	});
});
