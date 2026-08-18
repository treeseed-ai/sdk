import type { MarketClient } from '../../entrypoints/clients/market-client.ts';

type Row = Record<string, unknown>;

function record(value: unknown): Row {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string {
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function agentLabProfileInputs(tests: Array<{ frontmatter: Row }>, configured: Row = {}) {
	const inputs: Array<{ agentId: string; activityType: string; input: Row }> = [];
	for (const source of [...tests.map((test) => record(test.frontmatter.profileInputs)), configured]) for (const [agentId, profilesValue] of Object.entries(source)) {
		for (const [activityType, inputValue] of Object.entries(record(profilesValue))) {
			const input = record(inputValue);
			if (Object.keys(input).length) inputs.push({ agentId, activityType, input });
		}
	}
	return inputs;
}

export async function seedAgentLabPlanningProfileInputs(input: {
	client: MarketClient;
	projectId: string;
	runId: string;
	workdayId: string;
	resolvedRef: string;
	tests: Array<{ frontmatter: Row }>;
	profileInputs?: Row;
	agentClassIds: Record<string, string>;
	selectedAgents: string[];
}) {
	for (const configured of agentLabProfileInputs(input.tests, input.profileInputs).filter((entry) => input.selectedAgents.includes(entry.agentId))) {
		const classId = input.agentClassIds[configured.agentId];
		if (!classId) throw new Error(`Agent Lab profile input has no synchronized class for ${configured.agentId}.`);
		const relatedArtifact = record(configured.input.relatedArtifact);
		const assignmentInput = {
			...configured.input,
			subjectRef: text(configured.input.subjectRef) || input.resolvedRef,
			...(Object.keys(relatedArtifact).length ? { relatedArtifact: { ...relatedArtifact, commitSha: text(relatedArtifact.commitSha) || input.resolvedRef } } : {}),
		};
		const requestId = `agent-lab:${input.runId}:${input.workdayId}:${configured.agentId}:${configured.activityType}:input`;
		await input.client.createPlanningInputRequest(requestId, {
			id: requestId, projectId: input.projectId, projectAgentClassId: classId, mode: 'planning',
			prompt: text(configured.input.prompt) || `Execute the configured ${configured.activityType} profile input.`,
			metadata: { agentId: configured.agentId, activityType: configured.activityType, planningSource: 'agent-lab-profile-input', priority: 100, assignmentInput },
		});
	}
}
