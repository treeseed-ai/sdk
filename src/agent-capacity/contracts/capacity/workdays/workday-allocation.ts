import { z } from 'zod';
import { conditionalFields, uniqueArray } from '../../../../content/validation/schema-constraints.ts';
import { AGENT_WORK_EXECUTION_MODES, type AgentWorkExecutionMode } from '../../support/authority/execution-mode.ts';
import { assignmentReferenceSchema } from '../assignments/agent-execution.ts';

const identifier = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const positiveWeights = z.record(z.number().finite().positive());

export const workdayPolicySchema = z.object({
	durationSeconds: z.number().int().positive(),
	maximumConcurrency: z.number().int().positive(),
	planningPercent: z.number().min(0).max(100),
	allocationWeight: z.number().finite().positive(),
	planningTurnMaximumSeconds: z.number().int().positive(),
	communicationConcurrency: z.number().int().positive(),
	projectPercentages: positiveWeights,
	agentClassPercentages: z.record(positiveWeights),
}).strict();

export const workdayAllocationOverridesSchema = workdayPolicySchema.pick({ planningPercent: true, allocationWeight: true,
	planningTurnMaximumSeconds: true, projectPercentages: true, agentClassPercentages: true }).partial();

/** One canonical default; team-owned overrides use this same policy contract. */
export const DEFAULT_WORKDAY_POLICY = Object.freeze(workdayPolicySchema.parse({
	durationSeconds: 28_800, maximumConcurrency: 1, communicationConcurrency: 1,
	planningPercent: 20, allocationWeight: 1, planningTurnMaximumSeconds: 180,
	projectPercentages: {}, agentClassPercentages: {},
}));
export const workdayProfileSchema = z.object({
	id: z.literal('default'), teamId: identifier, revision: z.number().int().positive(), policy: workdayPolicySchema,
}).strict();
export type WorkdayProfile = z.infer<typeof workdayProfileSchema>;

export const appliedWorkdaySchema = conditionalFields(z.object({
	schemaVersion: z.literal('treeseed.workday/v1'), id: identifier, teamId: identifier,
	executionMode: z.enum(AGENT_WORK_EXECUTION_MODES),
	policyId: identifier, policyRevision: z.number().int().positive(), policySnapshot: workdayPolicySchema,
	state: z.enum(['planned', 'active', 'closing', 'ended']), startsAt: z.string().datetime({ offset: true }),
	endsAt: z.string().datetime({ offset: true }),
	planningRounds: z.array(z.object({ round: z.number().int().positive(),
		state: z.enum(['pending', 'active', 'complete']), assignmentIds: uniqueArray(z.array(identifier)),
		startedAt: z.string().datetime({ offset: true }).optional(), completedAt: z.string().datetime({ offset: true }).optional() }).strict()),
	admittedSecondsByProject: z.record(z.number().int().nonnegative()),
	admittedSecondsByAgentClass: z.record(z.number().int().nonnegative()),
	activatedAt: z.string().datetime({ offset: true }).optional(), closingAt: z.string().datetime({ offset: true }).optional(),
	endedAt: z.string().datetime({ offset: true }).optional(),
	reportRef: assignmentReferenceSchema.options[1].optional(),
}).strict(), [{ field: 'state', equals: 'ended', alternatives: [['reportRef']], path: ['reportRef'],
	message: 'An ended workday requires its exact TreeDX closeout report.' }]);

export interface FairReadyNode {
	id: string;
	priority?: number;
	projectId: string;
	agentClass: string;
	readyAt: string;
}

export interface FairUsage {
	projectId: string;
	agentClass: string;
	seconds: number;
}

function weightedAmount(amount: number, weight: number, weights: Record<string, number>): number {
	const values = Object.values(weights), total = values.reduce((sum, value) => sum + value, 0) || 1;
	const product = amount * weight;
	if (amount === 0) return 0;
	const minimumNormal = 2 ** -1022;
	if (Number.isFinite(total) && Number.isFinite(product)
		&& total >= minimumNormal && Math.abs(product) >= minimumNormal) return product / total;
	// Finite positive weights express relative shares. Scaling by their largest
	// value preserves those shares when their sum or the intermediate product
	// would overflow or lose precision through subnormal multiplication;
	// neither the policy nor any admitted commitment is changed.
	const scale = Math.max(...values);
	return amount * (weight / scale) / values.reduce((sum, value) => sum + value / scale, 0);
}

function shareDebt(id: string, weights: Record<string, number>, actual: Map<string, number>): number {
	const weight = weights[id] ?? 1;
	const totalActual = [...actual.values()].reduce((sum, value) => sum + value, 0);
	return weightedAmount(totalActual, weight, weights) - (actual.get(id) ?? 0);
}

/** Select work only; provider selection is a later hard-gated admission step. */
export function selectFairReadyNode(nodes: FairReadyNode[], usage: FairUsage[], policy: z.infer<typeof workdayPolicySchema>) {
	if (!nodes.length) return null;
	for (const node of nodes) if (node.priority !== undefined && !Number.isSafeInteger(node.priority)) throw new Error('execution_node_priority_invalid');
	const projectActual = new Map<string, number>();
	const classActual = new Map<string, number>();
	for (const entry of usage) {
		projectActual.set(entry.projectId, (projectActual.get(entry.projectId) ?? 0) + entry.seconds);
		classActual.set(`${entry.projectId}:${entry.agentClass}`, (classActual.get(`${entry.projectId}:${entry.agentClass}`) ?? 0) + entry.seconds);
	}
	const projectWeights = Object.fromEntries([...new Set(nodes.map((node) => node.projectId))]
		.map((projectId) => [projectId, policy.projectPercentages[projectId] ?? 1]));
	const projects = Object.keys(projectWeights).sort((left, right) =>
		shareDebt(right, projectWeights, projectActual) - shareDebt(left, projectWeights, projectActual)
		|| left.localeCompare(right));
	const projectId = projects[0]!;
	const projectNodes = nodes.filter((node) => node.projectId === projectId);
	const classWeights = Object.fromEntries([...new Set(projectNodes.map((node) => node.agentClass))]
		.map((agentClass) => [agentClass, policy.agentClassPercentages[projectId]?.[agentClass] ?? 1]));
	const projectClassActual = new Map([...classActual].filter(([key]) => key.startsWith(`${projectId}:`))
		.map(([key, value]) => [key.slice(projectId.length + 1), value]));
	const classes = [...new Set(projectNodes.map((node) => node.agentClass))].sort((left, right) =>
		shareDebt(right, classWeights, projectClassActual) - shareDebt(left, classWeights, projectClassActual)
		|| left.localeCompare(right));
	const selected = projectNodes.filter((node) => node.agentClass === classes[0]).sort((left, right) =>
		(right.priority ?? 0) - (left.priority ?? 0) || Date.parse(left.readyAt) - Date.parse(right.readyAt)
		|| left.id.localeCompare(right.id))[0] ?? null;
	return selected ? { ...selected, input: structuredClone({
		nodes: [...nodes].sort((left, right) => left.id.localeCompare(right.id)),
		usage: [...usage].sort((left, right) => left.projectId.localeCompare(right.projectId)
			|| left.agentClass.localeCompare(right.agentClass) || left.seconds - right.seconds),
	}), explanation: {
		projectTargetPercent: weightedAmount(100, projectWeights[projectId]!, projectWeights),
		projectDeficitSeconds: shareDebt(projectId, projectWeights, projectActual),
		classTargetPercent: weightedAmount(100, classWeights[selected.agentClass]!, classWeights),
		classDeficitSeconds: shareDebt(selected.agentClass, classWeights, projectClassActual),
		readyNodeCount: nodes.length,
	} } : null;
}

export function compilePlanningRounds(workdayId: string, agentIds: string[], planningTurnMaximumSeconds: number, round = 1) {
	const agents = [...new Set(agentIds)].sort();
	return agents.map((agentId) => ({
		id: `planning:${workdayId}:${round}:${agentId}`, agentId, round, maximumSeconds: planningTurnMaximumSeconds,
		dependsOn: round === 1 ? [] : agents.map((candidate) => `planning:${workdayId}:${round - 1}:${candidate}`),
	}));
}

export function workdayPlanningEndsAt(plan: Pick<AppliedWorkday, 'startsAt' | 'policySnapshot'>): string {
	return new Date(Date.parse(plan.startsAt) + plan.policySnapshot.durationSeconds * plan.policySnapshot.planningPercent * 10).toISOString();
}

/** The percentage reserves an initial planning window; later phase choice follows live graph readiness. */
export function workdayPhase(plan: Pick<AppliedWorkday, 'startsAt' | 'endsAt' | 'policySnapshot'>,
	now: string, actingReady: boolean): 'planning' | 'acting' | 'ended' {
	if (Date.parse(now) >= Date.parse(plan.endsAt)) return 'ended';
	return Date.parse(now) < Date.parse(workdayPlanningEndsAt(plan)) || !actingReady ? 'planning' : 'acting';
}

/** Shared by read-only plan and mutating start; callers persist this exact value. */
export function compileWorkday(input: { id: string; teamId: string; policyId: string; policyRevision: number;
	executionMode: AgentWorkExecutionMode; policy: z.input<typeof workdayPolicySchema>; agentIds: string[]; startsAt: string;
	activityTypes?: string[] }) {
	const policy = workdayPolicySchema.parse(input.policy);
	const assignments = policy.planningPercent > 0 ? compilePlanningRounds(input.id, input.agentIds, policy.planningTurnMaximumSeconds) : [];
	const startsAt = new Date(input.startsAt).toISOString();
	return appliedWorkdaySchema.parse({ schemaVersion: 'treeseed.workday/v1', id: input.id, teamId: input.teamId,
		executionMode: input.executionMode,
		policyId: input.policyId, policyRevision: input.policyRevision, policySnapshot: policy, state: 'planned', startsAt,
		endsAt: new Date(Date.parse(startsAt) + policy.durationSeconds * 1_000).toISOString(),
		planningRounds: assignments.length ? [{ round: 1, state: 'pending', assignmentIds: assignments.map((assignment) => assignment.id) }] : [],
		admittedSecondsByProject: {}, admittedSecondsByAgentClass: {},
	});
}

export type WorkdayPolicy = z.infer<typeof workdayPolicySchema>;
export type AppliedWorkday = z.infer<typeof appliedWorkdaySchema>;
