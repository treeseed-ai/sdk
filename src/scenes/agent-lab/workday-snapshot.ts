import type { MarketClient } from '../../entrypoints/clients/market-client.ts';
import type { AgentLabWorkdaySnapshot } from '../types.ts';
import {
	applyAgentLabAccounting,
	collectAgentLabExecutions,
	readAgentLabAccounting,
	readAgentLabActivity,
	readAgentLabAssignments,
	readAgentLabProviderExecutions,
} from './activity-collector.ts';
import { hasFailedAgentLabContentTool } from './report-model.ts';
import { retryAgentLabControlPlaneOperation } from './terminal-verification.ts';
import { verifyAgentLabTerminal } from './terminal-verification.ts';

type Row = Record<string, unknown>;
const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'degraded']);
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (...values: unknown[]): string => {
	for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
	return '';
};

export function assertionsFor(day: AgentLabWorkdaySnapshot, expectedAgents: string[], expectedProfiles: string[], verifiedAssignments: Set<string>) {
	const completed = day.executions.filter((entry) => entry.status === 'completed');
	const completedProfiles = new Set(completed.filter((entry) => verifiedAssignments.has(entry.assignmentId)).map((entry) => `${entry.agentId}:${entry.activityType}`));
	const completedAgents = new Set(completed.filter((entry) => verifiedAssignments.has(entry.assignmentId)).map((entry) => entry.agentId).filter((value): value is string => Boolean(value)));
	const result = (passed: boolean) => passed ? 'passed' as const : TERMINAL.has(day.status) ? 'failed' as const : 'pending' as const;
	const failedContentTool = hasFailedAgentLabContentTool(day);
	const governanceRequired = expectedProfiles.some((profile) => profile.endsWith(':acting'));
	const acceptedGovernance = day.governance.some((proposal) => text(proposal.status) === 'accepted' && text(record(proposal.decision).id));
	return [
		{ id: 'signed-provider', label: 'Signed provider onboarding and approved membership', status: day.activity.some((entry) => entry.capacityProviderId) ? 'passed' as const : 'pending' as const },
		{ id: 'agent-coverage', label: 'Every selected production agent completed', status: result(expectedAgents.every((agent) => completedAgents.has(agent))), detail: `${completedAgents.size}/${expectedAgents.length} agents completed and verified` },
		{ id: 'profile-coverage', label: 'Every required activity profile completed', status: result(expectedProfiles.every((profile) => completedProfiles.has(profile))), detail: `${expectedProfiles.filter((profile) => completedProfiles.has(profile)).length}/${expectedProfiles.length} profiles completed and verified` },
		{ id: 'kernel', label: 'AgentKernel produced durable mode-run evidence', status: day.activity.some((entry) => entry.modeRunId) ? 'passed' as const : 'pending' as const },
		{ id: 'treedx', label: 'TreeDX evidence captured without failed content operations', status: result(!failedContentTool && completed.some((entry) => entry.artifacts.length > 0 || entry.transcript.some((item) => JSON.stringify(item.payload).includes('treedx')))) },
		...(governanceRequired ? [{ id: 'governance', label: 'A real proposal vote authorized acting', status: result(acceptedGovernance), detail: acceptedGovernance ? 'Accepted decision provenance is attached to acting assignments.' : 'No accepted proposal vote is recorded.' }] : []),
		{ id: 'settlement', label: 'Every required profile settled exactly once', status: result(expectedProfiles.every((profile) => completedProfiles.has(profile))), detail: `${verifiedAssignments.size} assignment settlement(s) verified` },
	];
}

async function hydrateArtifacts(client: MarketClient, projectId: string, repositoryId: string, executions: AgentLabWorkdaySnapshot['executions']) {
	return Promise.all(executions.map(async (execution) => {
		const lifecycle = record(execution.assignment.lifecycleOutput ?? execution.assignment.lifecycle_output_json);
		const manifest = record(lifecycle.artifactManifest);
		const references = [...execution.artifacts, ...(Array.isArray(manifest.contentReferences) ? manifest.contentReferences.map(record) : [])];
		const unique = [...new Map(references.map((entry) => {
			const ref = record(entry); return [`${text(ref.contentPath ?? ref.path)}:${text(ref.ref ?? ref.commitSha)}`, ref];
		})).values()].filter((entry) => text(entry.contentPath ?? entry.path));
		const artifacts = await Promise.all(unique.map(async (reference) => {
			const path = text(reference.contentPath ?? reference.path); const ref = text(reference.ref ?? reference.commitSha);
			try {
				const response = await client.treeDxReadRepositoryFiles(projectId, repositoryId, { paths: [path], ref, encoding: 'utf8', parseFrontmatter: true });
				const file = (Array.isArray(record(response.payload).files) ? record(response.payload).files : []).map(record).find((entry) => text(entry.path) === path) ?? {};
				const content = text(file.content ?? file.text);
				return { ...reference, ...file, content, bytes: new TextEncoder().encode(content).byteLength, characters: content.length, sourceMap: record(reference.sourceMap), relationReceipt: record(reference.relationReceipt) };
			} catch (error) {
				return { ...reference, inspectionError: error instanceof Error ? error.message : String(error) };
			}
		}));
		return { ...execution, artifacts };
	}));
}

export async function refreshAgentLabWorkday(input: {
	client: MarketClient; teamId: string; projectId: string; repositoryId: string; day: AgentLabWorkdaySnapshot;
	expectedAgents: string[]; expectedProfiles: string[]; verifiedAssignments: Set<string>;
}) {
	return retryAgentLabControlPlaneOperation(async () => {
		const activity = await readAgentLabActivity({ client: input.client, teamId: input.teamId, workdayRunId: input.day.workdayRunId! });
		const byId = new Map(input.day.activity.map((entry) => [entry.id, entry]));
		for (const event of activity.items) byId.set(event.id, event);
		const events = [...byId.values()].sort((left, right) => left.sequence - right.sequence);
		const assignments = await readAgentLabAssignments({
			client: input.client,
			teamId: input.teamId,
			workdayRunId: input.day.workdayRunId!,
			assignmentIds: new Set(events.map((entry) => entry.assignmentId).filter((value): value is string => Boolean(value))),
		});
		const providerExecutions = await readAgentLabProviderExecutions({ client: input.client, teamId: input.teamId, assignmentIds: new Set(assignments.map((entry) => text(entry.id))) });
		const durableWorkdayId = assignments.map((assignment) => text(record(assignment.capacityEnvelope ?? assignment.capacity_envelope_json).workDayId)).find(Boolean);
		const accounting = durableWorkdayId
			? await readAgentLabAccounting(input.client, durableWorkdayId).catch((error) => ({ collectionError: error instanceof Error ? error.message : String(error) }))
			: { collectionError: 'No durable capacity workday identity is available yet.' };
		const observed = await input.client.workdayRun(input.teamId, input.day.workdayRunId!);
		const run = record(observed.payload.run); const status = text(run.status) as AgentLabWorkdaySnapshot['status'];
		const executions = await hydrateArtifacts(input.client, input.projectId, input.repositoryId, applyAgentLabAccounting(await collectAgentLabExecutions(input.client, events, assignments), accounting));
		return {
			...input.day, status: status || input.day.status, startedAt: text(run.startedAt) || input.day.startedAt,
			finishedAt: text(run.completedAt) || (TERMINAL.has(status) ? new Date().toISOString() : null), activity: events,
			executions, providerExecutions, assignments, accounting,
			assertions: assertionsFor({ ...input.day, activity: events, executions }, input.expectedAgents, input.expectedProfiles, input.verifiedAssignments),
		};
	});
}

export async function verifyCompletedAgentLabAssignments(input: {
	client: MarketClient; teamId: string; projectId: string; day: AgentLabWorkdaySnapshot; verifiedAssignments: Set<string>;
}) {
	let day = input.day;
	for (const completed of day.assignments.filter((entry) => text(entry.status) === 'completed')) {
		const assignmentId = text(completed.id);
		if (!assignmentId || input.verifiedAssignments.has(assignmentId)) continue;
		try {
			await verifyAgentLabTerminal({ adminClient: input.client, teamId: input.teamId, projectId: input.projectId, assignmentId });
			input.verifiedAssignments.add(assignmentId);
		} catch (error) {
			day = { ...day, diagnostics: [...day.diagnostics, `Terminal verification ${assignmentId}: ${error instanceof Error ? error.message : String(error)}`] };
		}
	}
	return day;
}
