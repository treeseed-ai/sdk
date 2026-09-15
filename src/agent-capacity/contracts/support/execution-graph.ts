import { z } from 'zod';
import { activityProfileSchema } from '../../validation/agent-definition-schema.ts';
import { estimateSchema, exactEntityReferenceSchema } from '../capacity/assignments/agent-execution.ts';

const identifier = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const slug = z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u);
const uniqueIds = z.array(identifier).superRefine((items, context) => {
	if (new Set(items).size !== items.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Values must be unique.' });
});

export const conditionDefinitionSchema = z.object({
	conditionType: z.enum(['question', 'external', 'authority', 'lifecycle']),
	subjectRef: exactEntityReferenceSchema,
	expectedState: identifier,
}).strict();

export const executionNodeSchema = z.object({
	schemaVersion: z.literal('treeseed.execution-node/v1'),
	id: identifier,
	teamId: identifier,
	projectId: identifier,
	workdayId: identifier.optional(),
	workItemId: slug.optional(),
	kind: z.enum(['planning', 'estimating', 'acting', 'reviewing', 'reporting', 'communication', 'condition']),
	pairRole: z.enum(['actor', 'reviewer']).nullable(),
	sourceRef: exactEntityReferenceSchema,
	authorityRefs: z.array(exactEntityReferenceSchema).optional(),
	ruleRevision: z.number().int().positive(),
	nodeRevision: z.number().int().positive(),
	agentClass: z.string().regex(/^[a-z][a-z0-9-]*$/u).optional(),
	status: z.enum(['proposed', 'blocked', 'ready', 'assigned', 'running', 'completed', 'failed', 'cancelled', 'stale']),
	estimate: estimateSchema.optional(),
	requiredCapabilities: uniqueIds.optional(),
	requestedPermissions: activityProfileSchema.shape.permissions.optional(),
	workspace: z.enum(['read-only', 'treedx', 'git']).optional(),
	acceptanceCriteria: z.array(z.string().trim().min(1)).min(1).optional(),
	maximumReviewCycles: z.number().int().positive().optional(),
	condition: conditionDefinitionSchema.optional(),
	graphRevisionCreated: z.number().int().positive(),
	graphRevisionUpdated: z.number().int().positive(),
}).strict().superRefine((node, context) => {
	const assignable = ['agentClass', 'estimate', 'requiredCapabilities', 'requestedPermissions', 'workspace'] as const;
	if (node.kind === 'condition') {
		if (!node.condition) context.addIssue({ code: z.ZodIssueCode.custom, path: ['condition'], message: 'Condition nodes require condition.' });
		for (const key of assignable) if (node[key] !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Condition nodes cannot define ${key}.` });
	} else {
		for (const key of assignable) if (node[key] === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Assignable nodes require ${key}.` });
		if (node.condition) context.addIssue({ code: z.ZodIssueCode.custom, path: ['condition'], message: 'Assignable nodes cannot define condition.' });
	}
	if (node.pairRole && !(node.workItemId && node.maximumReviewCycles)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Actor and Reviewer nodes require workItemId and maximumReviewCycles.' });
	if (node.graphRevisionUpdated < node.graphRevisionCreated) context.addIssue({ code: z.ZodIssueCode.custom, path: ['graphRevisionUpdated'], message: 'Updated revision cannot precede created revision.' });
});

export const executionEdgeSchema = z.object({
	schemaVersion: z.literal('treeseed.execution-edge/v1'),
	id: identifier,
	teamId: identifier,
	fromNodeId: identifier,
	toNodeId: identifier,
	provenance: z.enum(['profile-agent', 'profile-event', 'work-item', 'review-pair', 'governance']),
	sourceRef: exactEntityReferenceSchema.optional(),
	graphRevisionCreated: z.number().int().positive(),
	graphRevisionRemoved: z.number().int().positive().optional(),
}).strict().refine((edge) => edge.fromNodeId !== edge.toNodeId, { message: 'Execution edges cannot be self-referential.' });

export const graphChangeSetSchema = z.object({
	added: uniqueIds,
	changed: uniqueIds,
	completed: uniqueIds,
	blocked: uniqueIds,
	stale: uniqueIds,
	removedEdges: uniqueIds,
	addedEdges: uniqueIds,
}).strict();

export const graphRevisionSchema = z.object({
	schemaVersion: z.literal('treeseed.graph-revision/v1'),
	teamId: identifier,
	revision: z.number().int().positive(),
	ruleRevision: z.number().int().positive(),
	changedSourceRefs: z.array(exactEntityReferenceSchema).min(1),
	graphDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
	changes: graphChangeSetSchema,
	createdAt: z.string().datetime({ offset: true }),
}).strict();

export type ExecutionNode = z.infer<typeof executionNodeSchema>;
export type ExecutionEdge = z.infer<typeof executionEdgeSchema>;
export type GraphRevision = z.infer<typeof graphRevisionSchema>;

export function validateExecutionGraph(nodes: ExecutionNode[], edges: ExecutionEdge[]) {
	const diagnostics: Array<{ code: string; path: string; message: string }> = [];
	const nodeIds = new Set<string>();
	for (const [index, candidate] of nodes.entries()) {
		const parsed = executionNodeSchema.safeParse(candidate);
		if (!parsed.success) diagnostics.push(...parsed.error.issues.map((issue) => ({ code: `execution_node_${issue.code}`, path: `nodes.${index}.${issue.path.join('.')}`, message: issue.message })));
		if (nodeIds.has(candidate.id)) diagnostics.push({ code: 'execution_node_duplicate', path: `nodes.${index}.id`, message: `Node ${candidate.id} is duplicated.` });
		nodeIds.add(candidate.id);
	}
	const activeEdges = edges.filter((edge) => edge.graphRevisionRemoved === undefined);
	const edgeIds = new Set<string>();
	for (const [index, candidate] of edges.entries()) {
		const parsed = executionEdgeSchema.safeParse(candidate);
		if (!parsed.success) diagnostics.push(...parsed.error.issues.map((issue) => ({ code: `execution_edge_${issue.code}`, path: `edges.${index}.${issue.path.join('.')}`, message: issue.message })));
		if (!nodeIds.has(candidate.fromNodeId) || !nodeIds.has(candidate.toNodeId)) diagnostics.push({ code: 'execution_edge_endpoint_missing', path: `edges.${index}`, message: 'Both edge endpoints must exist.' });
		if (edgeIds.has(candidate.id)) diagnostics.push({ code: 'execution_edge_duplicate', path: `edges.${index}.id`, message: `Edge ${candidate.id} is duplicated.` });
		edgeIds.add(candidate.id);
	}
	const outgoing = new Map([...nodeIds].map((id) => [id, [] as string[]]));
	for (const edge of activeEdges) outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
	const visiting = new Set<string>(), visited = new Set<string>();
	const cyclic = (id: string): boolean => {
		if (visiting.has(id)) return true;
		if (visited.has(id)) return false;
		visiting.add(id);
		if ((outgoing.get(id) ?? []).some(cyclic)) return true;
		visiting.delete(id); visited.add(id); return false;
	};
	if ([...nodeIds].some(cyclic)) diagnostics.push({ code: 'execution_graph_cycle', path: 'edges', message: 'Execution graph must be acyclic.' });
	return { ok: diagnostics.length === 0, diagnostics };
}
