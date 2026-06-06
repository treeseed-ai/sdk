import { describe, expect, it } from 'vitest';
import {
	TreeDbApiError,
	TreeDbArtifactPort,
	TreeDbClient,
	TreeDbFederatedClient,
	TreeDbFederatedPort,
	TreeDbGraphAdapter,
	TreeDbGraphPort,
	LocalGraphPort,
	LocalRepositoryPort,
	LocalRepositoryQueryPort,
	TreeDbQueryAdapter,
	TreeDbRegistryClient,
	TreeDbRegistryPort,
	TreeDbRepositoryAdapter,
	TreeDbRepositoryPort,
	TreeDbRepositoryQueryPort,
	TreeDbExecPort,
	TreeDbWorkspaceAdapter,
} from '../../src/treedb/index.ts';
import { TreeDbClient as TreeDbClientSubpath } from '../../src/treedb/client.ts';
import {
	LocalRepositoryPort as LocalRepositoryPortSubpath,
	TreeDbRepositoryAdapter as TreeDbRepositoryAdapterSubpath,
} from '../../src/treedb/adapters.ts';
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
		expect(TreeDbRepositoryPort).toBeTypeOf('function');
		expect(TreeDbRepositoryQueryPort).toBeTypeOf('function');
		expect(TreeDbGraphPort).toBeTypeOf('function');
		expect(LocalRepositoryPort).toBeTypeOf('function');
		expect(LocalRepositoryQueryPort).toBeTypeOf('function');
		expect(LocalGraphPort).toBeTypeOf('function');
		expect(TreeDbRegistryPort).toBeTypeOf('function');
		expect(TreeDbFederatedPort).toBeTypeOf('function');
		expect(TreeDbExecPort).toBeTypeOf('function');
		expect(TreeDbArtifactPort).toBeTypeOf('function');
		expect(TreeDbClientSubpath).toBe(TreeDbClient);
		expect(TreeDbRepositoryAdapterSubpath).toBe(TreeDbRepositoryAdapter);
		expect(LocalRepositoryPortSubpath).toBe(LocalRepositoryPort);
		expect(packageJson.exports).toHaveProperty('./treedb');
		expect(packageJson.exports).toHaveProperty('./treedb/client');
		expect(packageJson.exports).toHaveProperty('./treedb/types');
		expect(packageJson.exports).toHaveProperty('./treedb/adapters');
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
