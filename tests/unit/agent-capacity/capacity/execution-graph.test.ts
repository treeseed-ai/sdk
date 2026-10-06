import { describe, expect, it } from 'vitest';
import { executionNodeSchema, graphRevisionSchema, validateExecutionGraph, type ExecutionEdge, type ExecutionNode } from '../../../../src/capacity/agents/agent-capacity.ts';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { exportSchemaConstraints } from '../../../../src/content/validation/schema-constraints.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const sourceRef = { store: 'treedx' as const, model: 'proposal', id: 'proposal-1', revision: 1, digest };
const permissions = { content: { read: ['proposal' as const, 'decision' as const], write: [] }, tools: ['source.read' as const] };

function node(id: string): ExecutionNode {
	return {
		schemaVersion: 'treeseed.execution-node/v1', id, teamId: 'team-1', projectId: 'project-1', workItemId: id,
		kind: 'acting', pairRole: 'actor', sourceRef, authorityRefs: [], ruleRevision: 1, nodeRevision: 1, agentClass: 'engineer',
		status: 'ready', estimate: { expectedSeconds: 20, maximumSeconds: 30 }, requiredCapabilities: [],
		requestedPermissions: permissions, workspace: 'git', acceptanceCriteria: ['Tests pass.'], maximumReviewCycles: 2,
		graphRevisionCreated: 1, graphRevisionUpdated: 1,
	};
}

function edge(fromNodeId: string, toNodeId: string): ExecutionEdge {
	return { schemaVersion: 'treeseed.execution-edge/v1', id: `${fromNodeId}-to-${toNodeId}`, teamId: 'team-1', fromNodeId, toNodeId, provenance: 'work-item', graphRevisionCreated: 1 };
}

describe('living execution graph contracts', () => {
	function conditionalNodeInputs() {
		const base = node('bounded-node'), fields = ['agentClass', 'estimate', 'requiredCapabilities', 'requestedPermissions', 'workspace'];
		const condition = { ...Object.fromEntries(Object.entries(base).filter(([key]) => !fields.includes(key))), kind: 'condition', pairRole: null,
			condition: { conditionType: 'lifecycle', subjectRef: sourceRef, expectedState: 'workday-closing' } };
		return [
			{ valid: true, input: base }, { valid: true, input: { ...base, pairRole: 'reviewer' } },
			{ valid: true, input: condition }, { valid: true, input: { ...base, pairRole: null, workItemId: undefined, maximumReviewCycles: undefined } },
			{ valid: false, input: { ...condition, condition: undefined } },
			...fields.map(field => ({ valid: false, input: { ...condition, [field]: Object.getOwnPropertyDescriptor(base, field)?.value } })),
			...['planning', 'estimating', 'acting', 'reviewing', 'reporting', 'communication'].flatMap(kind => [
				{ valid: true, input: { ...base, kind } },
				{ valid: false, input: { ...base, kind, condition: condition.condition } },
				...fields.map(field => ({ valid: false, input: Object.fromEntries(Object.entries({ ...base, kind }).filter(([key]) => key !== field)) })),
			]),
			...['actor', 'reviewer'].flatMap(pairRole => ['workItemId', 'maximumReviewCycles'].map(field => ({ valid: false,
				input: Object.fromEntries(Object.entries({ ...base, pairRole }).filter(([key]) => key !== field)) }))),
		];
	}
	function observeNodeConditions(native: boolean) {
		const entries = conditionalNodeInputs(), held = structuredClone(entries);
		const assignable = ['agentClass', 'estimate', 'requiredCapabilities', 'requestedPermissions', 'workspace'];
		const expected = { allOf: [
			{ if: { type: 'object', required: ['kind'], properties: { kind: { const: 'condition' } } }, then: { type: 'object', required: ['condition'] } },
			...assignable.map(field => ({ if: { type: 'object', required: ['kind'], properties: { kind: { const: 'condition' } } }, then: { type: 'object', not: { type: 'object', anyOf: [{ type: 'object', required: [field] }] } } })),
			...assignable.map(field => ({ if: { type: 'object', required: ['kind'], properties: { kind: { not: { const: 'condition' } } } }, then: { type: 'object', required: [field] } })),
			{ if: { type: 'object', required: ['kind'], properties: { kind: { not: { const: 'condition' } } } }, then: { type: 'object', not: { type: 'object', anyOf: [{ type: 'object', required: ['condition'] }] } } },
			{ if: { type: 'object', required: ['pairRole'], properties: { pairRole: { enum: ['actor', 'reviewer'] } } }, then: { type: 'object', required: ['workItemId', 'maximumReviewCycles'] } },
		] };
		if (native) {
			const path = fileURLToPath(new URL('../../content/architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
			const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'node-inventory'], {
				input: JSON.stringify(entries.map(entry => entry.input)), encoding: 'utf8', timeout: 15_000,
			});
			expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
			const output: unknown = JSON.parse(child.stdout);
			if (!output || typeof output !== 'object' || !('schema' in output) || !('observations' in output) || !Array.isArray(output.observations))
				throw new Error('Native public node schema and validation observations required.');
			expect(output.observations).toHaveLength(entries.length);
			for (const [index, entry] of entries.entries()) expect(output.observations[index]).toMatchObject(entry.valid ? { success: true,
				data: JSON.parse(JSON.stringify(entry.input)) } : { success: false });
			expect(output.schema).toMatchObject(expected); expect(readFileSync(path)).toEqual(bytes);
		} else {
			const observations = entries.map(entry => executionNodeSchema.safeParse(entry.input));
			expect(observations.map(value => value.success)).toEqual(entries.map(entry => entry.valid));
			expect(zodToJsonSchema(executionNodeSchema, { $refStrategy: 'none', postProcess: exportSchemaConstraints })).toMatchObject(expected);
		}
		expect(entries).toEqual(held);
	}
	it('exports the exact condition assignable and review-pair field requirements enforced by the owning execution node validator', () => observeNodeConditions(false));
	it('native public execution node schema and validation retain all valid kinds and reject missing or contradictory scheduling authority without repairing inputs', () => observeNodeConditions(true));
	function nodeAuthorityInputs() {
		const base = node('bounded-node'), second = { ...sourceRef, id: 'second-proposal' };
		return [{ valid: true, input: base }, { valid: true, input: { ...base, agentClass: 'a'.repeat(100), authorityRefs: [sourceRef, second] } },
			{ valid: true, input: { ...base, authorityRefs: [second, sourceRef] } },
			...[{ agentClass: 'a'.repeat(101) }, { agentClass: ' padded' }, { agentClass: 'padded ' },
				{ authorityRefs: [sourceRef, structuredClone(sourceRef)] },
				{ authorityRefs: [sourceRef, Object.fromEntries(Object.entries(sourceRef).reverse())] },
				{ authorityRefs: [sourceRef, null] }]
				.map(patch => ({ valid: false, input: Object.assign({}, base, patch) }))];
	}
	it('bounds execution node class authority and denies duplicate or malformed exact refs while retaining distinct ordered source inputs', () => {
		const entries = nodeAuthorityInputs(), held = structuredClone(entries);
		const results = entries.map(({ valid, input }) => {
			const parsed = executionNodeSchema.safeParse(input); if (valid) expect(parsed).toEqual({ success: true, data: input });
			return parsed.success;
		});
		expect(results).toEqual(entries.map(entry => entry.valid)); expect(entries).toEqual(held);
	});
	it('native public execution node validation retains bounded class and exact distinct authority while rejecting duplicated observations', () => {
		const entries = nodeAuthorityInputs(), held = structuredClone(entries);
		const path = fileURLToPath(new URL('../../content/architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'node'], {
			input: JSON.stringify(entries.map(entry => entry.input)), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const result: unknown = JSON.parse(child.stdout); if (!Array.isArray(result)) throw new Error('Native node observations required.');
		expect(result).toHaveLength(entries.length);
		for (const [index, entry] of entries.entries()) expect(result[index]).toMatchObject(entry.valid ? { success: true, data: entry.input } : { success: false });
		expect(entries).toEqual(held); expect(readFileSync(path)).toEqual(bytes);
	});
	function revisionInputs() {
		const original = { schemaVersion: 'treeseed.graph-revision/v1', teamId: 'team-1', revision: 1, ruleRevision: 1,
			changedSourceRefs: [sourceRef], graphDigest: digest,
			changes: { added: [], changed: [], completed: [], blocked: [], stale: [], removedEdges: [], addedEdges: [] },
			createdAt: '2026-10-03T00:00:00.000Z' };
		const second = { ...sourceRef, id: 'proposal-2' }, reordered = { digest: sourceRef.digest, revision: sourceRef.revision,
			id: sourceRef.id, model: sourceRef.model, store: sourceRef.store };
		return [
			{ valid: true, input: original }, { valid: true, input: { ...original, changedSourceRefs: [sourceRef, second] } },
			{ valid: true, input: { ...original, changedSourceRefs: [second, sourceRef] } },
			...[[], [sourceRef, structuredClone(sourceRef)], [sourceRef, reordered], [sourceRef, null], [{ ...sourceRef, revision: 0 }]]
				.map(changedSourceRefs => ({ valid: false, input: { ...original, changedSourceRefs } })),
			{ valid: false, input: Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'changedSourceRefs')) },
		];
	}
	it('retains ordered distinct changed-source references and rejects empty malformed missing and semantic duplicates without normalizing revisions', () => {
		const entries = revisionInputs(), held = structuredClone(entries);
		const observed = entries.map(({ valid, input }) => {
			const result = graphRevisionSchema.safeParse(input); if (valid) expect(result).toEqual({ success: true, data: input });
			return result.success;
		});
		expect(observed).toEqual(entries.map(entry => entry.valid)); expect(entries).toEqual(held);
	});
	it('native public graph revision validation preserves exact distinct source order and denies duplicate or incomplete change authority', () => {
		const entries = revisionInputs(), input = entries.map(entry => entry.input), held = structuredClone(input);
		const path = fileURLToPath(new URL('../../content/architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'graph-revision'], {
			input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const observed: unknown = JSON.parse(child.stdout); if (!Array.isArray(observed)) throw new Error('Native graph revision observations required.');
		expect(observed).toHaveLength(entries.length);
		for (const [index, entry] of entries.entries()) expect(observed[index]).toMatchObject(entry.valid
			? { success: true, data: entry.input } : { success: false });
		expect(input).toEqual(held); expect(readFileSync(path)).toEqual(bytes);
	});
	it('accepts normalized nodes and edges without embedded output or assignment state', () => {
		expect(validateExecutionGraph([node('actor-a'), node('actor-b')], [edge('actor-a', 'actor-b')])).toEqual({ ok: true, diagnostics: [] });
	});
	function observeRetiredOutput(native: boolean) {
		const base = { ...node('exact-context'), workspace: 'treedx', requestedPermissions: { ...permissions, content: { read: ['proposal'], write: ['knowledge'] } } };
		const entries = [base, ...[null, '', {}, [], 'knowledge', { model: 'knowledge', id: 'sdk-workday-contract-inventory-v1' }].map(output => Object.assign({}, base, { output }))], held = structuredClone(entries);
		if (native) {
			const path = fileURLToPath(new URL('../../content/architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
			const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'node-inventory'], { input: JSON.stringify(entries), encoding: 'utf8', timeout: 15_000 });
			expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
			const result: unknown = JSON.parse(child.stdout);
			if (!result || typeof result !== 'object' || !('observations' in result) || !Array.isArray(result.observations) || !('schema' in result)) throw new Error('Native node observations required.');
			expect(result.observations).toHaveLength(entries.length); expect(result.observations[0]).toEqual({ success: true, data: base });
			for (const observed of result.observations.slice(1)) expect(observed).toMatchObject({ success: false });
			expect(result.schema).toMatchObject({ additionalProperties: false }); expect(readFileSync(path)).toEqual(bytes);
		} else {
			expect(executionNodeSchema.safeParse(base)).toEqual({ success: true, data: base });
			for (const supplied of [...entries.slice(1), Object.assign({}, base, { output: undefined })]) {
				const before = structuredClone(supplied); expect(executionNodeSchema.safeParse(supplied).success).toBe(false); expect(supplied).toEqual(before);
			}
		}
		expect(entries).toEqual(held);
	}
	it('retains exact node permission authority and rejects every represented retired output selector', () => observeRetiredOutput(false));
	it('native public execution nodes reject retired output selectors without changing exact permission authority', () => observeRetiredOutput(true));

	it('rejects cycles, missing endpoints, and duplicate identities', () => {
		const nodes = [node('actor-a'), node('actor-b'), node('actor-b')];
		const result = validateExecutionGraph(nodes, [edge('actor-a', 'actor-b'), edge('actor-b', 'actor-a'), edge('missing', 'actor-a')]);
		expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(['execution_node_duplicate', 'execution_edge_endpoint_missing', 'execution_graph_cycle']));
	});

	it('requires condition-only and assignable-only fields', () => {
		const condition = { ...node('condition'), kind: 'condition' as const, pairRole: null, condition: { conditionType: 'lifecycle' as const, subjectRef: sourceRef, expectedState: 'workday-closing' } };
		expect(validateExecutionGraph([condition], []).ok).toBe(false);
		for (const key of ['agentClass', 'estimate', 'requiredCapabilities', 'requestedPermissions', 'workspace'] as const) delete condition[key];
		expect(validateExecutionGraph([condition], []).ok).toBe(true);
	});

	it('rejects retired graph duplication fields', () => {
		const legacy = { ...node('legacy'), activeAssignmentId: 'assignment-1', blockingReasons: ['waiting'], produces: [] };
		expect(validateExecutionGraph([legacy], []).ok).toBe(false);
	});
});
