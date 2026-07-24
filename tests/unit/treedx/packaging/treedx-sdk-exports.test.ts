import { describe, expect, it } from 'vitest';
import {
	TreeDxApiError,
	TreeDxArtifactPort,
	TreeDxClient,
	TreeDxFederatedClient,
	TreeDxFederatedPort,
	TreeDxGraphAdapter,
	TreeDxGraphPort,
	LocalGraphPort,
	LocalRepositoryPort,
	LocalRepositoryQueryPort,
	TreeDxQueryAdapter,
	TreeDxRegistryClient,
	TreeDxRegistryPort,
	TreeDxRepositoryAdapter,
	TreeDxRepositoryPort,
	TreeDxRepositoryQueryPort,
	TreeDxExecPort,
	TreeDxWorkspaceAdapter,
} from '../../../../src/treedx/index.ts';
import { TreeDxClient as TreeDxClientSubpath } from '../../../../src/treedx/support/client.ts';
import {
	LocalRepositoryPort as LocalRepositoryPortSubpath,
	TreeDxRepositoryAdapter as TreeDxRepositoryAdapterSubpath,
} from '../../../../src/treedx/reconciliation/adapters.ts';
import packageJson from '../../../../package.json' with { type: 'json' };

describe('TreeDX SDK public exports', () => {
	it('keeps the TreeDX export surface available', () => {
		expect(TreeDxClient).toBeTypeOf('function');
		expect(TreeDxRegistryClient).toBeTypeOf('function');
		expect(TreeDxFederatedClient).toBeTypeOf('function');
		expect(TreeDxApiError).toBeTypeOf('function');
		expect(TreeDxRepositoryAdapter).toBeTypeOf('function');
		expect(TreeDxQueryAdapter).toBeTypeOf('function');
		expect(TreeDxGraphAdapter).toBeTypeOf('function');
		expect(TreeDxWorkspaceAdapter).toBeTypeOf('function');
		expect(TreeDxRepositoryPort).toBeTypeOf('function');
		expect(TreeDxRepositoryQueryPort).toBeTypeOf('function');
		expect(TreeDxGraphPort).toBeTypeOf('function');
		expect(LocalRepositoryPort).toBeTypeOf('function');
		expect(LocalRepositoryQueryPort).toBeTypeOf('function');
		expect(LocalGraphPort).toBeTypeOf('function');
		expect(TreeDxRegistryPort).toBeTypeOf('function');
		expect(TreeDxFederatedPort).toBeTypeOf('function');
		expect(TreeDxExecPort).toBeTypeOf('function');
		expect(TreeDxArtifactPort).toBeTypeOf('function');
		expect(TreeDxClientSubpath).toBe(TreeDxClient);
		expect(TreeDxRepositoryAdapterSubpath).toBe(TreeDxRepositoryAdapter);
		expect(LocalRepositoryPortSubpath).toBe(LocalRepositoryPort);
		expect(packageJson.exports).toHaveProperty('./treedx');
		expect(packageJson.exports).toHaveProperty('./treedx/client');
		expect(packageJson.exports).toHaveProperty('./treedx/types');
		expect(packageJson.exports).toHaveProperty('./treedx/adapters');
	});

	it('preserves TreeDxApiError diagnostic fields', () => {
		const payload = { ok: false, error: { code: 'permission_denied', message: 'Denied.' } };
		const error = new TreeDxApiError('Denied.', {
			status: 403,
			code: 'permission_denied',
			details: { capability: 'files:read' },
			payload,
		});

		expect(error).toMatchObject({
			name: 'TreeDxApiError',
			code: 'permission_denied',
			status: 403,
			details: { capability: 'files:read' },
			payload,
		});
	});
});
