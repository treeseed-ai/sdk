import { z } from 'zod';
import { AGENT_WORK_EXECUTION_MODES, type AgentWorkExecutionMode } from '../../support/authority/execution-mode.ts';

const identifier = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const positiveWeights = z.record(z.number().positive());

export const workdayPolicySchema = z.object({
	durationSeconds: z.number().int().positive(),
	maximumConcurrency: z.number().int().positive(),
	planningSecondsPerAgent: z.number().int().positive(),
	communicationConcurrency: z.number().int().positive(),
	projectWeights: positiveWeights,
	agentClassWeights: positiveWeights,
}).strict();

export const appliedWorkdaySchema = z.object({
	schemaVersion: z.literal('treeseed.workday/v1'), id: identifier, teamId: identifier,
	executionMode: z.enum(AGENT_WORK_EXECUTION_MODES),
	policyId: identifier, policyRevision: z.number().int().positive(), policySnapshot: workdayPolicySchema,
	state: z.enum(['planned', 'active', 'closing', 'ended']), startsAt: z.string().datetime({ offset: true }),
	endsAt: z.string().datetime({ offset: true }),
	planningRounds: z.array(z.object({ round: z.union([z.literal(1), z.literal(2)]),
		state: z.enum(['pending', 'active', 'complete']), assignmentIds: z.array(identifier),
		startedAt: z.string().datetime({ offset: true }).optional(), completedAt: z.string().datetime({ offset: true }).optional() }).strict()).length(2),
	admittedSecondsByProject: z.record(z.number().int().nonnegative()),
	admittedSecondsByAgentClass: z.record(z.number().int().nonnegative()),
	activatedAt: z.string().datetime({ offset: true }).optional(), closingAt: z.string().datetime({ offset: true }).optional(),
	endedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export interface FairReadyNode {
	id: string;
	projectId: string;
	agentClass: string;
	graphPriority: number;
	readyAt: string;
}

export interface FairUsage {
	projectId: string;
	agentClass: string;
	seconds: number;
}

function shareDebt(id: string, weights: Record<string, number>, actual: Map<string, number>): number {
	const weight = weights[id] ?? 1;
	const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
	const totalActual = [...actual.values()].reduce((sum, value) => sum + value, 0);
	return (totalActual * weight / totalWeight) - (actual.get(id) ?? 0);
}

/** Select work only; provider selection is a later hard-gated admission step. */
export function selectFairReadyNode(nodes: FairReadyNode[], usage: FairUsage[], policy: z.infer<typeof workdayPolicySchema>) {
	if (!nodes.length) return null;
	const projectActual = new Map<string, number>();
	const classActual = new Map<string, number>();
	for (const entry of usage) {
		projectActual.set(entry.projectId, (projectActual.get(entry.projectId) ?? 0) + entry.seconds);
		classActual.set(`${entry.projectId}:${entry.agentClass}`, (classActual.get(`${entry.projectId}:${entry.agentClass}`) ?? 0) + entry.seconds);
	}
	const projects = [...new Set(nodes.map((node) => node.projectId))].sort((left, right) =>
		shareDebt(right, policy.projectWeights, projectActual) - shareDebt(left, policy.projectWeights, projectActual)
		|| left.localeCompare(right));
	const projectId = projects[0]!;
	const projectNodes = nodes.filter((node) => node.projectId === projectId);
	const classWeights = Object.fromEntries([...new Set(projectNodes.map((node) => node.agentClass))]
		.map((agentClass) => [agentClass, policy.agentClassWeights[agentClass] ?? 1]));
	const projectClassActual = new Map([...classActual].filter(([key]) => key.startsWith(`${projectId}:`))
		.map(([key, value]) => [key.slice(projectId.length + 1), value]));
	const classes = [...new Set(projectNodes.map((node) => node.agentClass))].sort((left, right) =>
		shareDebt(right, classWeights, projectClassActual) - shareDebt(left, classWeights, projectClassActual)
		|| left.localeCompare(right));
	return projectNodes.filter((node) => node.agentClass === classes[0]).sort((left, right) =>
		right.graphPriority - left.graphPriority || Date.parse(left.readyAt) - Date.parse(right.readyAt)
		|| left.id.localeCompare(right))[0] ?? null;
}

export function compilePlanningRounds(workdayId: string, agentIds: string[], planningSecondsPerAgent: number) {
	const agents = [...new Set(agentIds)].sort();
	return [1, 2].flatMap((round) => agents.map((agentId) => ({
		id: `planning:${workdayId}:${round}:${agentId}`, agentId, round, maximumSeconds: planningSecondsPerAgent,
		dependsOn: round === 1 ? [] : agents.map((candidate) => `planning:${workdayId}:1:${candidate}`),
	})));
}

/** Shared by read-only plan and mutating start; callers persist this exact value. */
export function compileWorkday(input: { id: string; teamId: string; policyId: string; policyRevision: number;
	executionMode: AgentWorkExecutionMode; policy: z.input<typeof workdayPolicySchema>; agentIds: string[]; startsAt: string }) {
	const policy = workdayPolicySchema.parse(input.policy);
	const assignments = compilePlanningRounds(input.id, input.agentIds, policy.planningSecondsPerAgent);
	const startsAt = new Date(input.startsAt).toISOString();
	return appliedWorkdaySchema.parse({ schemaVersion: 'treeseed.workday/v1', id: input.id, teamId: input.teamId,
		executionMode: input.executionMode,
		policyId: input.policyId, policyRevision: input.policyRevision, policySnapshot: policy, state: 'planned', startsAt,
		endsAt: new Date(Date.parse(startsAt) + policy.durationSeconds * 1_000).toISOString(),
		planningRounds: [1, 2].map((round) => ({ round, state: 'pending',
			assignmentIds: assignments.filter((assignment) => assignment.round === round).map((assignment) => assignment.id) })),
		admittedSecondsByProject: {}, admittedSecondsByAgentClass: {},
	});
}

export type WorkdayPolicy = z.infer<typeof workdayPolicySchema>;
export type AppliedWorkday = z.infer<typeof appliedWorkdaySchema>;
