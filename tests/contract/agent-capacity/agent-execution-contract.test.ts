import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WORKDAY_POLICY } from '../../../src/capacity/agents/agent-capacity.ts';
import {
	assignmentContextSchema,
	assignmentResultSchema,
	assignmentWorkspaceSchema,
	exactEntityReferenceSchema,
} from '../../../src/agent-capacity/contracts/capacity/assignments/agent-execution.ts';

const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const timingAwareness = {
	schemaVersion: 'treeseed.assignment-timing-awareness/v1', requiredChecks: 2, completedChecks: 2,
	firstTool: 'treedx:treeseed_time_status', firstToolSucceeded: true,
	lastTool: 'treedx:treeseed_time_status', lastToolSucceeded: true,
	firstToolCompliant: true, finalToolCompliant: true,
};

describe('canonical agent execution contract', () => {
	it('native public fairness selection preserves finite proportional project and class weights without concealing overflow in JSON', () => {
		const input = (['project', 'class'] as const).flatMap(layer =>
			[1, Number.MAX_VALUE / 4, Number.MAX_VALUE / 2, Number.MIN_VALUE].map(weight => ({ layer,
				policy: { ...DEFAULT_WORKDAY_POLICY, projectPercentages: layer === 'project' ? { a: weight, b: weight * 2 } : { a: 1 },
					agentClassPercentages: layer === 'class' ? { a: { a: weight, b: weight * 2 } } : {} },
			})));
		const held = structuredClone(input), path = fileURLToPath(new URL('../../unit/content/architecture/closeout-native.ts', import.meta.url));
		const bytes = readFileSync(path), child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'fair-ready-weights'], {
			input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const observations: unknown = JSON.parse(child.stdout); if (!Array.isArray(observations)) throw new Error('Native fair selection observations required.');
		expect(observations).toHaveLength(input.length);
		for (const [index, entry] of input.entries()) {
			expect(observations[index]).toMatchObject({ id: 'second', explanation: entry.layer === 'project'
				? { projectTargetPercent: 100 * 2 / 3, projectDeficitSeconds: 2 }
				: { classTargetPercent: 100 * 2 / 3, classDeficitSeconds: 2 } });
			for (const value of Object.values(observations[index].explanation)) { expect(typeof value).toBe('number'); expect(Number.isFinite(value)).toBe(true); }
		}
		expect(input).toEqual(held); expect(readFileSync(path)).toEqual(bytes);
	});
	it('native public result validation retains measured provider fractions and rejects nonfinite usage before serialization can conceal it', () => {
		const record = { schemaVersion: 'treeseed.assignment-result/v1', id: 'result', assignmentId: 'attempt', status: 'completed',
			summary: 'Controlled native validation input, not measured provider evidence.', references: [], verification: [],
			usage: { elapsedSeconds: 1 }, diagnostics: [], completedAt: '2026-10-03T00:00:01.000Z' };
		const valid = [0, 0.125, 1, Number.MAX_VALUE], invalid = ['nan', 'positive-infinity', 'negative-infinity', -1, '1', null, true];
		const input = [...valid, ...invalid].map(value => ({ record, value })), held = structuredClone(input);
		const path = fileURLToPath(new URL('../../unit/content/architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'result-native-usage'], {
			input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const observations: unknown = JSON.parse(child.stdout); if (!Array.isArray(observations)) throw new Error('Native usage observations required.');
		expect(observations).toHaveLength(input.length);
		expect(observations.slice(0, valid.length)).toEqual(valid.map(value => ({ success: true,
			data: { ...record, usage: { elapsedSeconds: 1, native: { providerUnit: value } } } })));
		for (const observation of observations.slice(valid.length)) expect(observation).toMatchObject({ success: false });
		expect(input).toEqual(held); expect(readFileSync(path)).toEqual(bytes);
	});
	it('native public workday resource derivation rejects absent and mutating REST authority with the owning error and retains exact inputs', () => {
		const input = [{}, { rest: null }, { kind: 'mutation' }, { rest: { method: 'POST', path: '/v1/teams/{teamId}/workday-runs/{runId}' } },
			{ rest: null, surfaces: ['cli'] }], held = structuredClone(input);
		const path = fileURLToPath(new URL('../../unit/content/architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'workday-resource'], {
			input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const observations: unknown = JSON.parse(child.stdout);
		if (!Array.isArray(observations)) throw new Error('Native workday resource observations required.');
		expect(observations).toHaveLength(input.length);
		expect(observations[0]).toMatchObject({ resources: [{ operationId: 'workdays.show', uriTemplate: 'treeseed://teams/{teamId}/workdays/{runId}', subscribable: true }] });
		expect(observations.slice(1, 4)).toEqual(Array.from({ length: 3 }, () => ({ error: { name: 'Error',
			message: 'MCP resource operation workdays.show must be a read-only GET operation.' } })));
		expect(observations[4]).toEqual({ resources: [] }); expect(input).toEqual(held); expect(readFileSync(path)).toEqual(bytes);
	});
	it('native public SDK policy validation retains complete snapshots and denies every missing field without synthesizing authority', () => {
		const original = { id: 'default', teamId: 'team', revision: 1, policy: structuredClone(DEFAULT_WORKDAY_POLICY) };
		const invalid = Object.keys(original.policy).map(field => ({ ...original,
			policy: Object.fromEntries(Object.entries(original.policy).filter(([key]) => key !== field)) }));
		const input = [original, ...invalid], held = structuredClone(input);
		const path = fileURLToPath(new URL('../../unit/content/architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'policy'], {
			input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const observations: unknown = JSON.parse(child.stdout);
		if (!Array.isArray(observations)) throw new Error('Actual native policy inventory required');
		expect(observations).toHaveLength(input.length); expect(observations[0]).toEqual({ success: true, data: original });
		expect(observations.slice(1).map(value => value.success)).toEqual(invalid.map(() => false));
		expect(input).toEqual(held); expect(readFileSync(path)).toEqual(bytes);
	});
	it('native public SDK context item validation requires the payload field without inventing content or another authority', () => {
		const original = { ref: { store: 'git', model: 'source', id: 'source', repository: 'source', commit: sha },
			mediaType: 'application/json', digest };
		const valid = [null, false, 0, '', [], {}, { evidence: ['exact', 1] }].map(value => ({ ...original, value }));
		const input = [...valid, original, { ...original, value: {}, grant: {} }], before = structuredClone(input);
		const path = fileURLToPath(new URL('../../unit/content/architecture/closeout-native.ts', import.meta.url)), source = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'context-item'], {
			input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const observations: unknown = JSON.parse(child.stdout);
		if (!Array.isArray(observations)) throw new Error('Actual native context item observations required.');
		expect(observations).toHaveLength(input.length);
		expect(observations.slice(0, valid.length)).toEqual(valid.map(data => ({ success: true, data })));
		for (const observation of observations.slice(valid.length)) expect(observation).toMatchObject({ success: false });
		expect(input).toEqual(before); expect(readFileSync(path)).toEqual(source);
	});
	function nativeRecord(kind: 'lease' | 'reservation') {
		const clock = '2026-10-03T00:00:00.000Z', optional = kind === 'lease' ? 'releasedAt' : 'closedAt';
		const original = kind === 'lease'
			? { schemaVersion: 'treeseed.lease/v1', id: 'lease', assignmentId: 'attempt', providerId: 'provider', state: 'active', acquiredAt: clock, expiresAt: clock, revision: 1 }
			: { schemaVersion: 'treeseed.reservation/v1', id: 'reservation', assignmentId: 'attempt', providerId: 'provider', workdayId: 'workday', estimatedSeconds: 1, state: 'held', reservedAt: clock };
		const valid = (kind === 'lease' ? ['active', 'released', 'expired', 'revoked'] : ['held', 'consumed', 'released', 'expired'])
			.flatMap(state => [{ ...original, state }, { ...original, state, [optional]: clock }]);
		const invalid = Object.keys(original).flatMap(field => [
			Object.fromEntries(Object.entries(original).filter(([key]) => key !== field)),
			...[null, '', [], {}].map(value => ({ ...original, [field]: value })),
		]);
		invalid.push(...[{ state: 'unknown' }, { schemaVersion: 'legacy/v1' }, { id: ' padded ' }, { id: 'a'.repeat(201) },
			{ [optional]: null }, { [optional]: 'not-a-clock' }, { token: 'forbidden' }, { leaseSeconds: 1 },
			...[0, -1, 0.5, '1', true].map(value => ({ [kind === 'lease' ? 'revision' : 'estimatedSeconds']: value }))]
			.map(patch => ({ ...original, ...patch })));
		const input = [...valid, ...invalid], before = structuredClone(input);
		const path = fileURLToPath(new URL('../../unit/content/architecture/closeout-native.ts', import.meta.url));
		const bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, kind], {
			input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const observations: unknown = JSON.parse(child.stdout);
		expect(Array.isArray(observations)).toBe(true);
		if (!Array.isArray(observations)) throw new Error('Native public SDK record inventory missing.');
		expect(observations).toHaveLength(input.length);
		expect(observations.slice(0, valid.length)).toEqual(valid.map(data => ({ success: true, data })));
		for (const observation of observations.slice(valid.length)) expect(observation).toMatchObject({ success: false });
		expect(input).toEqual(before); expect(readFileSync(path)).toEqual(bytes);
	}
	it('native public SDK lease validation retains complete records and denies every missing field malformed value and unknown authority', () => nativeRecord('lease'));
	it('native public SDK reservation validation retains complete records and denies every missing field malformed value and unknown authority', () => nativeRecord('reservation'));
	it('accepts exactly the three workspace modes and one mutable workspace', () => {
		expect(assignmentWorkspaceSchema.parse({ mode: 'read-only' })).toEqual({ mode: 'read-only' });
		expect(assignmentWorkspaceSchema.parse({ mode: 'git', repository: 'treeseed-ai/sdk', baseCommit: sha, branch: 'assignment/one', writablePaths: ['src'] }).mode).toBe('git');
		expect(assignmentWorkspaceSchema.parse({ mode: 'treedx', workspaceId: 'workspace-1', repository: 'treeseed-ai/sdk-library', baseCommit: sha, writablePaths: ['knowledge'] }).mode).toBe('treedx');
		expect(() => assignmentWorkspaceSchema.parse({ mode: 'git', repository: 'sdk', baseCommit: sha, branch: 'work', writablePaths: ['src'], treeDxWorkspaceId: 'also-write' })).toThrow();
	});

	it('requires exact store-specific entity references', () => {
		expect(exactEntityReferenceSchema.safeParse({ store: 'git', model: 'source', id: 'sdk', repository: 'treeseed-ai/sdk', commit: sha, path: 'src' }).success).toBe(true);
		expect(exactEntityReferenceSchema.safeParse({ store: 'git', model: 'source', id: 'sdk' }).success).toBe(false);
		expect(exactEntityReferenceSchema.safeParse({ store: 'treedx', model: 'knowledge', id: 'architecture', revision: 2, digest }).success).toBe(true);
	});

	it('rejects handler-specific output taxonomies from the one shared result', () => {
		const result = {
			schemaVersion: 'treeseed.assignment-result/v1', id: 'result-1', assignmentId: 'assignment-1', status: 'completed',
			summary: 'Completed the assignment.', references: [], verification: [], usage: { elapsedSeconds: 1 }, diagnostics: [],
			timingAwareness, completedAt: '2026-09-13T12:00:00.000Z', specializedOutput: { commit: sha },
		};
		expect(assignmentResultSchema.safeParse(result).success).toBe(false);
		delete (result as { specializedOutput?: unknown }).specializedOutput;
		expect(assignmentResultSchema.safeParse(result).success).toBe(true);
	});

	it('accepts timing evidence without requiring it from deterministic handlers', () => {
		const result = {
			schemaVersion: 'treeseed.assignment-result/v1', id: 'result-1', assignmentId: 'assignment-1', status: 'completed',
			summary: 'Completed the assignment.', references: [], verification: [], usage: { elapsedSeconds: 1 }, diagnostics: [],
			completedAt: '2026-09-13T12:00:00.000Z',
		};
		expect(assignmentResultSchema.safeParse(result).success).toBe(true);
		expect(assignmentResultSchema.safeParse({ ...result, timingAwareness }).success).toBe(true);
	});

	it('does not allow context to restate assignment authority', () => {
		const parsed = assignmentContextSchema.safeParse({ assignment: {}, context: [], predecessorResults: [], grant: {} });
		expect(parsed.success).toBe(false);
		if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
	});
});
