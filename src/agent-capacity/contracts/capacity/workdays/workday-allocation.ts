import { z } from 'zod';
import { AGENT_WORK_EXECUTION_MODES, type AgentWorkExecutionMode } from '../../support/authority/execution-mode.ts';

const identifier = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const positiveWeights = z.record(z.number().positive());

export const workdayPolicySchema = z.object({
	durationSeconds: z.number().int().positive(),
	maximumConcurrency: z.number().int().positive(),
	planningPercent: z.number().min(0).max(100).default(20),
	allocationWeight: z.number().positive().default(1),
	planningTurnMaximumSeconds: z.number().int().positive().default(180),
	communicationConcurrency: z.number().int().positive(),
	projectPercentages: positiveWeights.default({}),
	agentClassPercentages: z.record(positiveWeights).default({}),
}).strict();

export const workdayAllocationOverridesSchema = workdayPolicySchema.pick({ planningPercent: true, allocationWeight: true,
	planningTurnMaximumSeconds: true, projectPercentages: true, agentClassPercentages: true }).partial();

/** One canonical default; team-owned overrides use this same policy contract. */
export const DEFAULT_WORKDAY_POLICY = Object.freeze(workdayPolicySchema.parse({
	durationSeconds: 28_800, maximumConcurrency: 1, communicationConcurrency: 1,
}));
export const workdayProfileSchema = z.object({
	id: z.literal('default'), teamId: identifier, revision: z.number().int().positive(), policy: workdayPolicySchema,
}).strict();
export type WorkdayProfile = z.infer<typeof workdayProfileSchema>;

export const appliedWorkdaySchema = z.object({
	schemaVersion: z.literal('treeseed.workday/v1'), id: identifier, teamId: identifier,
	executionMode: z.enum(AGENT_WORK_EXECUTION_MODES),
	policyId: identifier, policyRevision: z.number().int().positive(), policySnapshot: workdayPolicySchema,
	state: z.enum(['planned', 'active', 'closing', 'ended']), startsAt: z.string().datetime({ offset: true }),
	endsAt: z.string().datetime({ offset: true }),
	planningRounds: z.array(z.object({ round: z.number().int().positive(),
		state: z.enum(['pending', 'active', 'complete']), assignmentIds: z.array(identifier),
		startedAt: z.string().datetime({ offset: true }).optional(), completedAt: z.string().datetime({ offset: true }).optional() }).strict()),
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
		right.graphPriority - left.graphPriority || Date.parse(left.readyAt) - Date.parse(right.readyAt)
		|| left.id.localeCompare(right.id))[0] ?? null;
	return selected ? { ...selected, explanation: {
		projectTargetPercent: 100 * projectWeights[projectId]! / Object.values(projectWeights).reduce((sum, weight) => sum + weight, 0),
		projectDeficitSeconds: shareDebt(projectId, projectWeights, projectActual),
		classTargetPercent: 100 * classWeights[selected.agentClass]! / Object.values(classWeights).reduce((sum, weight) => sum + weight, 0),
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

export function workdayPhase(plan: Pick<AppliedWorkday, 'startsAt' | 'endsAt' | 'policySnapshot'>, now: string): 'planning' | 'acting' | 'ended' {
	if (Date.parse(now) >= Date.parse(plan.endsAt)) return 'ended';
	return Date.parse(now) < Date.parse(workdayPlanningEndsAt(plan)) ? 'planning' : 'acting';
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
