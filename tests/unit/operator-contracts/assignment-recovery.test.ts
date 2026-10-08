import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_OPERATIONS, TREESEED_COMMAND_TREE_V1 } from '../../../src/operator-contracts/index.ts';

describe('explicit unresolved assignment recovery contract', () => {
	it('declares authenticated destructive recovery with exact version and reason and prohibits supplied measurements', () => {
		const binding = CONTROL_PLANE_OPERATIONS.assignments.recover;
		expect(binding.descriptor).toMatchObject({ operationId: 'assignments.recover', authentication: 'oauth',
			rest: { method: 'POST', path: '/v1/teams/{teamId}/capacity/assignments/{assignmentId}/recover' },
			oauthScopes: ['treeseed:execution'], riskClass: 'destructive', confirmation: 'input_required',
			idempotency: { required: true, header: 'Idempotency-Key' }, surfaces: ['rest', 'cli', 'mcp_tool'] });
		const valid = { expectedStateVersion: 7, reason: 'Cannot reconstruct original active measurement' };
		expect(binding.schema.body.parse(valid)).toEqual(valid);
		for (const invalid of [null, {}, ...[null, '', '7', false, 0, -1, 0.5, NaN, Infinity].map(expectedStateVersion => ({ ...valid, expectedStateVersion })),
			...[undefined, null, '', ' ', 7].map(reason => ({ ...valid, reason })),
			...['actorId', 'activeSeconds', 'elapsedSeconds', 'usageActual', 'nativeUsage', 'usd', 'leaseToken', 'settled', 'usageStatus']
				.map(field => ({ ...valid, [field]: undefined }))]) {
			const held = structuredClone(invalid); expect(binding.schema.body.safeParse(invalid).success).toBe(false); expect(invalid).toEqual(held);
		}
	});
	it('publishes exactly one generated recovery command with required integer state version and reason without measured usage options', () => {
		const serialized = JSON.stringify(TREESEED_COMMAND_TREE_V1);
		expect(serialized.match(/"operationId":"assignments.recover"/gu)).toHaveLength(1);
		const visit = (value: unknown): unknown[] => {
			if (!value || typeof value !== 'object') return [];
			if ('segment' in value && value.segment === 'recover' && 'execution' in value) return [value];
			return Object.values(value).flatMap(visit);
		};
		expect(visit(TREESEED_COMMAND_TREE_V1)).toContainEqual(expect.objectContaining({ segment: 'recover', kind: 'mutation',
			options: expect.arrayContaining([expect.objectContaining({ name: '--state-version', type: 'number', required: true }),
				expect.objectContaining({ name: '--reason', type: 'string', required: true })]) }));
	});
});
