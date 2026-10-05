import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_WORKDAY_POLICY, appliedWorkdaySchema, compileWorkday } from '../../../../src/agent-capacity/contracts/capacity/workdays/workday-allocation.ts';
import { estimateSchema } from '../../../../src/agent-capacity/contracts/capacity/assignments/agent-execution.ts';
import { assertCanonicalAuthorityUnchanged, canonicalAuthority, schemaRecord } from './canonical-schema-fixture.ts';

afterAll(assertCanonicalAuthorityUnchanged);
const report = { kind: 'treedx', projectId: 'project-test', repository: 'test-library',
	commit: 'a'.repeat(40), path: 'notes/closeout.mdx' };
function workday(state = 'planned') {
	return { ...compileWorkday({ id: 'workday-test', teamId: 'team-test', policyId: 'default', policyRevision: 1,
		executionMode: 'simulation', policy: { ...DEFAULT_WORKDAY_POLICY, durationSeconds: 3600, maximumConcurrency: 5, communicationConcurrency: 5 },
		agentIds: ['project-test/arbitrary-agent'], startsAt: '2026-10-02T00:00:00Z' }), state };
}
function native(input: unknown, kind = 'workday') {
	const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'),
		fileURLToPath(new URL('./closeout-native.ts', import.meta.url)), kind], {
		input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000,
	});
	expect(result.error).toBeUndefined();
	expect(result.status, result.stderr).toBe(0);
	return JSON.parse(result.stdout) as { success: boolean; data?: unknown };
}

describe('canonical single workday closeout and expected maximum estimates', () => {
	it('retains one exact TreeDX closeout reference and ended-only requirement in the canonical target', () => {
		const definition = schemaRecord(canonicalAuthority().document.$defs.Workday);
		expect(schemaRecord(definition.properties).reportRef).toEqual({ $ref: '#/$defs/TreeDxReference' });
		expect(definition.allOf).toContainEqual({ if: { required: ['state'], properties: { state: { const: 'ended' } } }, then: { required: ['reportRef'] } });
		expect(definition.additionalProperties).toBe(false);
	});
	it('permits planned active and closing workdays without inventing premature report authority', () => {
		for (const state of ['planned', 'active', 'closing']) {
			const input = workday(state), before = structuredClone(input);
			expect(appliedWorkdaySchema.safeParse(input).success).toBe(true);
			expect(input).toEqual(before);
		}
	});
	it('accepts an ended workday with exactly one immutable report reference without modifying input', () => {
		const input = { ...workday('ended'), reportRef: report }, before = structuredClone(input);
		const result = appliedWorkdaySchema.safeParse(input);
		expect(input).toEqual(before);
		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toEqual(input);
	});
	it('denies ended workdays missing the required closeout report rather than accepting silent closure', () => {
		expect(appliedWorkdaySchema.safeParse(workday('ended')).success).toBe(false);
	});
	it('denies malformed moving duplicate map and retired plural report authorities', () => {
		for (const reportRef of [null, {}, [], [report], { project: report }, { ...report, commit: 'staging' },
			{ ...report, repository: '' }, { ...report, path: '' }, { ...report, projectId: '' }, { ...report, extra: true }]) {
			const input = { ...workday('ended'), reportRef }, before = structuredClone(input);
			expect(appliedWorkdaySchema.safeParse(input).success).toBe(false);
			expect(input).toEqual(before);
		}
		expect(appliedWorkdaySchema.safeParse({ ...workday('ended'), reportRefs: { project: report } }).success).toBe(false);
	});
	it('keeps expected maximum bounds and rejects caller authored minimum authority', () => {
		for (const input of [{ expectedSeconds: 10, maximumSeconds: 20 }, { expectedSeconds: 20, maximumSeconds: 20, rationale: 'Exact equal bounds.' }]) {
			expect(estimateSchema.parse(input)).toEqual(input);
		}
		for (const input of [{ expectedSeconds: 21, maximumSeconds: 20 }, { expectedSeconds: 0, maximumSeconds: 20 },
			{ expectedSeconds: 10, maximumSeconds: 20, minimumSeconds: 1 }, { expectedSeconds: 10, maximumSeconds: 20, minimum: 1 },
			{ minimumSeconds: 1, maximumSeconds: 20 }, { expectedSeconds: 10 }]) expect(estimateSchema.safeParse(input).success).toBe(false);
	});
	it('admits exact single closeout report through the independent native public SDK boundary', () => {
		const input = { ...workday('ended'), reportRef: report };
		expect(native(input)).toEqual({ success: true, data: input });
	});
	it('denies missing ended report through the independent native public SDK boundary', () => {
		expect(native(workday('ended')).success).toBe(false);
	});
	it('rejects minimum estimate authority through the independent native public SDK boundary', () => {
		expect(native({ expectedSeconds: 10, maximumSeconds: 20, minimumSeconds: 1 }, 'estimate').success).toBe(false);
	});
});
