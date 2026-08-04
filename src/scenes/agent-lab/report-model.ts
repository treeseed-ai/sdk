import type { AgentLabSnapshot } from '../types.ts';

const SENSITIVE = /(?:api.?key|authorization|credential|membershipcredential|password|private.?key|secret|token)/iu;

export function sanitizeAgentLabValue(value: unknown, key = ''): unknown {
	const normalizedKey = key.replaceAll('_', '').toLowerCase();
	const usageMetric = /^(?:(?:input|output|cachedinput|reasoningoutput|prompt|completion|cachereadinput)tokens|(?:total)?tokenestimate(?:source)?|tokencounts|tokenusage|usage)$/u.test(normalizedKey);
	if (SENSITIVE.test(key) && !usageMetric) return '[REDACTED]';
	if (Array.isArray(value)) return value.map((entry) => sanitizeAgentLabValue(entry));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.map(([entryKey, entry]) => [entryKey, sanitizeAgentLabValue(entry, entryKey)]));
}

export function sanitizeAgentLabSnapshot(snapshot: AgentLabSnapshot) {
	return sanitizeAgentLabValue(snapshot) as AgentLabSnapshot;
}

function hash(value: string) {
	let result = 2166136261;
	for (const character of value) {
		result ^= character.charCodeAt(0);
		result = Math.imul(result, 16777619);
	}
	return result >>> 0;
}

export function agentClassPalette(classIds: string[]) {
	const unique = [...new Set(classIds.filter(Boolean))].sort();
	const used = new Set<number>();
	return Object.fromEntries(unique.map((id, index) => {
		let hue = (hash(id) + index * 137.508) % 360;
		while ([...used].some((candidate) => Math.abs(candidate - hue) < 18 || Math.abs(candidate - hue) > 342)) hue = (hue + 29) % 360;
		used.add(hue);
		return [id, `hsl(${hue.toFixed(1)} 82% 72%)`];
	}));
}

export function agentLabTotals(snapshot: AgentLabSnapshot) {
	const assignmentExecutions = snapshot.workdays.flatMap((workday) => workday.executions);
	const executions = snapshot.workdays.flatMap((workday) => workday.providerExecutions.length ? workday.providerExecutions : workday.executions);
	const activity = snapshot.workdays.flatMap((workday) => workday.activity);
	const assertions = snapshot.workdays.flatMap((workday) => workday.assertions);
	return {
		workdays: snapshot.workdays.length,
		workdaysCompleted: snapshot.workdays.filter((entry) => entry.status === 'completed').length,
		executions: executions.length,
		completed: executions.filter((entry) => ['completed', 'succeeded'].includes(entry.status)).length,
		failed: executions.filter((entry) => ['failed', 'error'].includes(entry.status)).length,
		running: executions.filter((entry) => entry.status === 'running').length,
		agents: snapshot.agents.length,
		agentsActive: new Set(assignmentExecutions.map((entry) => entry.agentId).filter(Boolean)).size,
		classes: new Set(assignmentExecutions.map((entry) => entry.agentClassId).filter(Boolean)).size,
		activities: new Set(activity.map((entry) => entry.id)).size,
		assignments: new Set(snapshot.workdays.flatMap((entry) => entry.assignments).map((entry) => String(entry.id ?? ''))).size,
		artifacts: assignmentExecutions.reduce((total, entry) => total + entry.artifacts.length, 0),
		assertionsPassed: assertions.filter((entry) => entry.status === 'passed').length,
		assertionsFailed: assertions.filter((entry) => entry.status === 'failed').length,
	};
}

function hasFailedContentToolRecord(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	if (!Array.isArray(value)) {
		const item = value as Record<string, unknown>;
		if (item.type === 'mcp_tool_call' && item.status === 'failed' && /^(?:treedx_|treeseed_content_)/u.test(String(item.tool ?? ''))) return true;
	}
	return Object.values(value).some(hasFailedContentToolRecord);
}

export function hasFailedAgentLabContentTool(day: AgentLabSnapshot['workdays'][number]) {
	return day.executions.some((execution) => execution.transcript.some((item) => hasFailedContentToolRecord(item.payload))
		|| execution.evidence.some((item) => item.kind === 'work-package'
		&& /"id":"treedx-evidence-warnings"/u.test(JSON.stringify(item.detail))
		&& /TreeDX[^"\\]* failed/iu.test(JSON.stringify(item.detail))));
}

export function initialAgentLabSnapshot(input: {
	sceneId: string;
	runId: string;
	presentation: AgentLabSnapshot['presentation'];
	timeZone: string;
	repositories: string[];
	workdays: Array<{ id: string; title?: string; agentTests: string[] }>;
}): AgentLabSnapshot {
	return {
		schemaVersion: 'treeseed.agent-simulation/v2', sceneId: input.sceneId, runId: input.runId,
		status: 'starting', presentation: input.presentation, timeZone: input.timeZone, generatedAt: new Date().toISOString(),
		team: { id: null, name: null, isolation: 'ephemeral' },
		provider: { id: null, membershipId: null, executionProviderId: 'codex', status: 'pending' },
		repositories: input.repositories.map((slug) => ({ slug, projectId: null, repositoryId: null, ref: null })),
		agents: [],
		workdays: input.workdays.map((workday) => ({
			id: workday.id, title: workday.title ?? workday.id, workdayRunId: null, status: 'pending',
			startedAt: null, finishedAt: null, agentTests: workday.agentTests, activity: [], executions: [], providerExecutions: [], assignments: [], governance: [], accounting: {}, assertions: [], diagnostics: [],
		})),
		cleanup: { status: 'pending', diagnostics: [] }, diagnostics: [],
	};
}
