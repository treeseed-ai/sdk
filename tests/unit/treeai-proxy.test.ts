import { describe, expect, it, vi } from 'vitest';
import { TREEAI_CONTROL_PLANE_OPERATION_LIST } from '../../src/treeai/catalog.ts';
import { TreeSeedTreeAiClient } from '../../src/treeai/client.ts';
import { createTreeAiServiceContractReceipt, validateTreeAiOperationMapping } from '../../src/treeai/contract.ts';
import { TREEAI_UPSTREAM_OPERATIONS } from '../../src/treeai/generated/upstream.ts';

describe('TreeAI SDK adoption', () => {
	it('maps every authoritative operation exactly once', () => {
		expect(validateTreeAiOperationMapping()).toEqual([]);
		expect(TREEAI_CONTROL_PLANE_OPERATION_LIST).toHaveLength(TREEAI_UPSTREAM_OPERATIONS.length);
		expect(new Set(TREEAI_CONTROL_PLANE_OPERATION_LIST.map(({ descriptor }) => descriptor.operationId)).size).toBe(TREEAI_UPSTREAM_OPERATIONS.length);
	});

	it('binds every operation to a node-scoped route and its exact upstream digest', () => {
		for (const operation of TREEAI_CONTROL_PLANE_OPERATION_LIST) {
			expect(operation.descriptor.rest.path).toMatch(/^\/v1\/ai\/nodes\/\{nodeId\}\/(inference|training|lab|qualification)\//u);
			expect(operation.descriptor.upstream).toMatchObject({ service: 'treeai', contractVersion: '3.1.1' });
		}
	});

	it('supports the generic direct transport without TreeSeed implementation coupling', async () => {
		const request = vi.fn(async () => new Response(JSON.stringify({ mode: 'awake' }), { status: 200, headers: { 'content-type': 'application/json' } }));
		const client = TreeSeedTreeAiClient.direct({ endpoints: { inference: 'https://inference.test', training: 'https://training.test', lab: 'https://lab.test', qualification: 'https://manager.test' }, token: 'secret', fetch: request });
		await expect(client.invoke('qualification.get.mode')).resolves.toEqual({ mode: 'awake' });
		expect(request.mock.calls[0]?.[0].toString()).toBe('https://manager.test/v1/mode');
		expect((request.mock.calls[0]?.[1]?.headers as Headers).get('authorization')).toBe('Bearer secret');
	});

	it('emits an immutable adoption receipt', async () => {
		const receipt = await createTreeAiServiceContractReceipt();
		expect(receipt).toMatchObject({ schema: 'treeseed.treeai-service-contract/v1', release: '0.11.0-rc2', openapiVersion: '3.1.1' });
		expect(receipt.operationMapping).toHaveLength(TREEAI_UPSTREAM_OPERATIONS.length);
		expect(receipt.operationMappingDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
	});
});
