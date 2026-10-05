import { describe, expect, it } from 'vitest';
import { graphRevisionSchema, validateExecutionGraph, type ExecutionEdge, type ExecutionNode } from '../../../../src/capacity/agents/agent-capacity.ts';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
