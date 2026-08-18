import { createHash } from 'node:crypto';
import type { AgentLabSnapshot } from '../types.ts';

const SENSITIVE = /(?:api.?key|authorization|credential|membershipcredential|password|private.?key|secret|token)/iu;
const MAX_COLLECTION_ITEMS = 40;
const MAX_OBJECT_FIELDS = 40;
const MAX_TEXT_BYTES = 1_024;
const MAX_VALUE_BYTES = 8_192;
const MAX_TRANSCRIPT_ITEMS = 120;
const MAX_EVIDENCE_ITEMS = 80;

function digest(value: string) {
	return createHash('sha256').update(value).digest('hex');
}

function boundedText(value: string) {
	const bytes = Buffer.byteLength(value, 'utf8');
	if (bytes <= MAX_TEXT_BYTES) return value;
	const preview = value.slice(0, MAX_TEXT_BYTES / 2);
	return `${preview}\n\n[Agent Lab presentation truncated ${bytes - Buffer.byteLength(preview, 'utf8')} bytes; sha256:${digest(value)}. Query durable forensic evidence for the complete value.]`;
}

function boundedContainer(original: object, projected: unknown, kind: 'array' | 'object') {
	const serialized = JSON.stringify(projected);
	if (Buffer.byteLength(serialized, 'utf8') <= MAX_VALUE_BYTES) return projected;
	return {
		presentationTruncated: true,
		byteLength: Buffer.byteLength(JSON.stringify(original), 'utf8'),
		sha256: digest(JSON.stringify(original)),
		reason: 'maximum-value-bytes',
		kind,
		...(Array.isArray(original) ? { itemCount: original.length } : { fields: Object.keys(original).slice(0, MAX_OBJECT_FIELDS) }),
		preview: boundedText(serialized),
	};
}

function boundedValue(value: unknown, depth = 0): unknown {
	if (typeof value === 'string') return boundedText(value);
	if (!value || typeof value !== 'object') return value;
	if (depth >= 8) {
		const serialized = JSON.stringify(value);
		return { presentationTruncated: true, byteLength: Buffer.byteLength(serialized, 'utf8'), sha256: digest(serialized), reason: 'maximum-depth' };
	}
	if (Array.isArray(value)) {
		const selected = value.length > MAX_COLLECTION_ITEMS
			? [...value.slice(0, MAX_COLLECTION_ITEMS / 2), ...value.slice(-MAX_COLLECTION_ITEMS / 2)]
			: value;
		const result = selected.map((entry) => boundedValue(entry, depth + 1));
		if (selected.length !== value.length) result.splice(MAX_COLLECTION_ITEMS / 2, 0, {
			presentationTruncated: true, omittedItems: value.length - selected.length,
			sha256: digest(JSON.stringify(value)), reason: 'maximum-items',
		});
		return boundedContainer(value, result, 'array');
	}
	const entries = Object.entries(value as Record<string, unknown>);
	const selected = entries.slice(0, MAX_OBJECT_FIELDS);
	const result = Object.fromEntries(selected.map(([key, entry]) => [key, boundedValue(entry, depth + 1)]));
	if (selected.length !== entries.length) result.presentationTruncation = {
		omittedFields: entries.length - selected.length, sha256: digest(JSON.stringify(value)), reason: 'maximum-fields',
	};
	return boundedContainer(value, result, 'object');
}

function boundedTimeline<T>(items: T[], limit: number) {
	if (items.length <= limit) return items;
	return [...items.slice(0, Math.floor(limit / 4)), ...items.slice(-(limit - Math.floor(limit / 4)))];
}

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
	const sanitized = sanitizeAgentLabValue(snapshot) as AgentLabSnapshot;
	return {
		...sanitized,
		workdays: sanitized.workdays.map((day) => ({
			...day,
			activity: boundedTimeline(day.activity, 1_000).map((entry) => boundedValue(entry) as typeof entry),
			assignments: day.assignments.map((entry) => boundedValue(entry) as Record<string, unknown>),
			providerExecutions: day.providerExecutions.map((entry) => boundedValue(entry) as Record<string, unknown>),
			governance: day.governance.map((entry) => boundedValue(entry) as Record<string, unknown>),
			accounting: boundedValue(day.accounting) as Record<string, unknown>,
			executions: day.executions.map((execution) => ({
				...execution,
				transcript: boundedTimeline(execution.transcript, MAX_TRANSCRIPT_ITEMS).map((entry) => ({
					...entry, text: entry.text === null ? null : boundedText(entry.text), payload: boundedValue(entry.payload) as Record<string, unknown>,
				})),
				evidence: boundedTimeline(execution.evidence, MAX_EVIDENCE_ITEMS).map((entry) => ({ ...entry, detail: boundedValue(entry.detail) })),
				signals: execution.signals.map((entry) => boundedValue(entry) as Record<string, unknown>),
				artifacts: execution.artifacts.map((entry) => boundedValue(entry) as Record<string, unknown>),
				usage: boundedValue(execution.usage) as Record<string, unknown>,
				error: execution.error ? boundedValue(execution.error) as Record<string, unknown> : null,
				assignment: boundedValue(execution.assignment) as Record<string, unknown>,
				capacity: boundedValue(execution.capacity) as typeof execution.capacity,
			})),
		})),
	};
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
