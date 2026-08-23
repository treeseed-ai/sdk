import { describe, expect, it, vi } from 'vitest';
import { TREEDX_OPENAPI_CONTRACT } from '@treeseed/treedx/openapi';
import { ControlPlaneClient } from '../../src/entrypoints/clients/control-plane-client.ts';
import { CONTROL_PLANE_OPERATIONS } from '../../src/operator-contracts/control-plane-operations.ts';
import {
	createTreeDxServiceContractReceipt,
	TreeSeedTreeDxClient,
	TREESEED_TREEDX_OPERATIONS,
	validateTreeDxProxyOperationMapping,
} from '../../src/treedx/index.ts';

describe('TreeSeed TreeDX proxy facade', () => {
	it('maps every public proxy operation to the accepted TreeDX contract', async () => {
		expect(validateTreeDxProxyOperationMapping()).toEqual([]);
		const treedxSourceCommit = '52cde66008195c329a9231cf5c58506645fe6eb7';
		const receipt = await createTreeDxServiceContractReceipt(`sha256:${'a'.repeat(64)}`, {
			treedxSourceCommit,
			treedxPackageArtifactDigest: `sha256:${'b'.repeat(64)}`,
		});
		expect(receipt).toMatchObject({
			schema: 'treeseed.treedx-service-contract/v1',
			treedxPackageVersion: TREEDX_OPENAPI_CONTRACT.packageVersion,
			treedxOpenapiVersion: TREEDX_OPENAPI_CONTRACT.openapiVersion,
			treedxOpenapiDigest: TREEDX_OPENAPI_CONTRACT.openapiSha256,
			treedxSourceCommit,
		});
		expect(receipt.operationMapping.length).toBeGreaterThan(50);
		expect(receipt.operationMappingDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
	});

	it('invokes only project-scoped control-plane operations', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}));
		const controlPlane = new ControlPlaneClient({
			profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' },
			accessToken: 'token',
			fetchImpl,
		});
		const client = new TreeSeedTreeDxClient(controlPlane);
		await expect(client.proxy.health({
			path: { projectId: 'project one' }, query: {}, body: undefined,
		})).resolves.toEqual({ data: { ok: true } });
		expect(String(fetchImpl.mock.calls[0]![0])).toBe('http://127.0.0.1:3002/v1/dx/projects/project%20one/health');
		await expect(client.invoke(CONTROL_PLANE_OPERATIONS.projects.list, {
			path: {}, query: {}, body: undefined,
		})).rejects.toThrow(/not part of the TreeSeed TreeDX proxy catalog/u);
	});
});
