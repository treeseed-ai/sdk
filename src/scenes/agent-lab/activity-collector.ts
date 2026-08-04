import type { MarketClient } from '../../entrypoints/clients/market-client.ts';
import type { AgentActivityEvent } from '../../agent-capacity/contracts/capacity/workdays/workday-records.ts';
import type { AgentLabExecution,AgentLabExecutionEvidence,AgentLabTranscriptItem } from '../types/scene-agent-lab.ts';

type Row = Record<string, unknown>;

function record(value: unknown): Row {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

function payloadOf(value: unknown): Row {
	const source = record(value);
	return record(source.payload ?? source);
}

function number(value: unknown): number {
	const parsed = Number(value ?? 0);
	return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function normalizedContextPack(value: unknown) {
	const pack = record(value);
	const graphPack = record(pack.pack);
	const searchResult = record(pack.results);
	const graphNodes = Array.isArray(graphPack.nodes) ? graphPack.nodes.map((entry) => record(record(entry).node ?? entry)) : [];
	const searchItems = Array.isArray(searchResult.results) ? searchResult.results : [];
	const rawFiles = [pack.files, Array.isArray(pack.results) ? pack.results : null, pack.items, graphNodes, searchItems].find((entry) => Array.isArray(entry) && entry.length > 0) as unknown[] | undefined ?? [];
	const files = rawFiles.map((value) => {
		const file = record(value); const content = text(file.content ?? file.text ?? file.body) ?? '';
		return { ...file, path: text(file.path ?? file.filePath), mediaType: text(file.mediaType ?? file.mimeType) ?? 'text/plain', bytes: new TextEncoder().encode(content).byteLength, characters: content.length, truncated: file.truncated === true, content };
	});
	const reportedTokenEstimate = optionalNumber(pack.totalTokenEstimate ?? pack.tokenEstimate ?? graphPack.totalTokenEstimate);
	const fileTokenEstimate = files.reduce((sum, file) => sum + number(file.tokenEstimate ?? file.tokens), 0);
	const totalCharacters = files.reduce((sum, file) => sum + file.characters, 0);
	const tokenEstimate = reportedTokenEstimate ?? (fileTokenEstimate > 0 ? fileTokenEstimate : Math.ceil(totalCharacters / 4));
	const tokenEstimateSource = reportedTokenEstimate !== null ? 'provider'
		: fileTokenEstimate > 0 ? 'file-metadata' : totalCharacters > 0 ? 'character-estimate' : 'empty';
	const queries = Array.isArray(pack.queries) ? pack.queries : text(searchResult.query) ? [{ query: text(searchResult.query), truncated: searchResult.truncated === true }] : [];
	return { ...pack, queries, files, statistics: { fileCount: files.length, resultCount: rawFiles.length, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), totalCharacters, tokenEstimate, tokenEstimateSource } };
}

export function applyAgentLabAccounting(executions: AgentLabExecution[], accounting: Row) {
	const evidence = record(accounting.evidence);
	const rows = (key: string) => Array.isArray(record(evidence[key]).items) ? record(evidence[key]).items as unknown[] : [];
	const reservations = rows('reservations').map(record);
	const usage = rows('usageActuals').map(record);
	const ledger = rows('ledgerEntries').map(record);
	return executions.map((execution) => {
		const byAssignment = (row: Row) => text(row.assignmentId ?? row.assignment_id) === execution.assignmentId;
		const reservation = reservations.find(byAssignment) ?? {};
		const assignmentUsage = usage.filter(byAssignment);
		const actual = assignmentUsage.length
			? assignmentUsage.reduce((sum, row) => sum + number(row.actualCredits ?? row.actual_credits), 0)
			: execution.credits.actual;
		const reserved = optionalNumber(reservation.reservedCredits ?? reservation.reserved_credits) ?? execution.credits.reserved;
		const consumed = optionalNumber(reservation.consumedCredits ?? reservation.consumed_credits) ?? actual;
		const released = execution.status === 'running' ? 0 : Math.max(0, reserved - consumed);
		const refunded = ledger.filter(byAssignment).filter((row) => text(row.phase).includes('refund')).reduce((sum, row) => sum + Math.abs(number(row.credits)), 0);
		return { ...execution, credits: { ...execution.credits, reserved, actual, released, refunded, overrun: Math.max(0, actual - reserved) } };
	});
}

export async function readAgentLabAssignments(input: { client: MarketClient; teamId: string; workdayRunId: string; assignmentIds?: Set<string> }) {
	const items: Row[] = [];
	let cursor: string | null = null;
	for (;;) {
		const query = new URLSearchParams({ limit: '200', ...(cursor ? { cursor } : {}) });
		const response = await input.client.request<Row>(
			`/v1/teams/${encodeURIComponent(input.teamId)}/capacity/assignments?${query}`,
			{ requireAuth: true },
		);
		const payload = payloadOf(response);
		if (Array.isArray(payload.items)) items.push(...payload.items.map(record));
		const page = record(payload.page);
		if (page.hasMore !== true || !text(page.nextCursor)) break;
		cursor = text(page.nextCursor);
	}
	return items
		.filter((entry) => input.assignmentIds?.has(text(entry.id) ?? '') === true
			|| text(entry.workdayRunId ?? entry.workday_run_id ?? record(entry.metadata).workdayRunId) === input.workdayRunId)
		.map((entry) => {
			const decisionInput = record(entry.decisionInput ?? entry.decision_input_json);
			const activityType = text(record(entry.metadata).activityType)
				?? text(record(decisionInput.metadata).activityType)
				?? text(record(decisionInput.input).activityType)
				?? text(entry.mode);
			return { ...entry, activityType };
		});
}

export async function readAgentLabProviderExecutions(input: { client: MarketClient; teamId: string; assignmentIds: Set<string> }) {
	const items: Row[] = []; let cursor: string | null = null;
	for (;;) {
		const query = new URLSearchParams({ limit: '200', ...(cursor ? { cursor } : {}) });
		const response = await input.client.request<Row>(`/v1/teams/${encodeURIComponent(input.teamId)}/capacity/execution-runs?${query}`, { requireAuth: true });
		const payload = payloadOf(response); if (Array.isArray(payload.items)) items.push(...payload.items.map(record));
		const page = record(payload.page); if (page.hasMore !== true || !text(page.nextCursor)) break; cursor = text(page.nextCursor);
	}
	return normalizeAgentLabProviderExecutions(items, input.assignmentIds);
}

export function normalizeAgentLabProviderExecutions(items: Row[], assignmentIds: Set<string>) {
	return items.flatMap((entry) => {
		const assignment = record(entry.assignment);
		const agent = record(entry.agent);
		const timing = record(entry.timing);
		const provider = record(entry.executionProvider);
		const metadata = record(record(entry.metadata).modeRun);
		const selectedInput = record(record(entry.input).selectedInput);
		const decisionInput = record(record(entry.input).decisionInput);
		const activityType = text(selectedInput.activityType)
			?? text(record(decisionInput.metadata).activityType)
			?? text(record(decisionInput.input).activityType)
			?? text(entry.mode);
		const assignmentId = text(assignment.id ?? entry.assignmentId ?? entry.assignment_id ?? entry.providerAssignmentId ?? entry.provider_assignment_id);
		if (!assignmentId || !assignmentIds.has(assignmentId) || !/^agent_kernel_(?:inputs_resolved|mode_runtime)$/u.test(text(metadata.source) ?? '')) return [];
		return [{
			id: text(entry.id), assignmentId, status: text(entry.status) ?? 'running', activityType,
			agentId: text(agent.agentId), agentClassId: text(agent.projectAgentClassId), handlerId: text(agent.handlerId),
			projectId: text(agent.projectId), runnerId: text(assignment.runnerId), executionProviderId: text(provider.id),
			capacityProviderId: text(provider.capacityProviderId), startedAt: text(timing.startedAt ?? timing.createdAt),
			finishedAt: text(timing.finishedAt ?? timing.completedAt ?? timing.failedAt), tokenCounts: record(provider.tokenCounts),
			input: record(entry.input), output: record(entry.output), contentArtifactRefs: Array.isArray(entry.contentArtifactRefs) ? entry.contentArtifactRefs : [],
		}];
	});
}

export async function readAgentLabAccounting(client: MarketClient, workdayRunId: string) {
	const response = await client.request<Row>(`/v1/workdays/${encodeURIComponent(workdayRunId)}/summary?limit=200`, { requireAuth: true });
	return payloadOf(response);
}

export async function readAgentLabActivity(input: {
	client: MarketClient;
	teamId: string;
	workdayRunId: string;
	after?: number;
}) {
	const items: AgentActivityEvent[] = [];
	let cursor = input.after ?? -1;
	for (;;) {
		const query = new URLSearchParams({ after: String(cursor), limit: '200' });
		const response = await input.client.request<Row>(
			`/v1/teams/${encodeURIComponent(input.teamId)}/workday-runs/${encodeURIComponent(input.workdayRunId)}/activity?${query}`,
			{ requireAuth: true },
		);
		const payload = payloadOf(response);
		const page = (Array.isArray(payload.items) ? payload.items : []) as AgentActivityEvent[];
		items.push(...page);
		const next = Number(payload.cursor ?? cursor);
		if (page.length < 200 || next <= cursor) { cursor = next; break; }
		cursor = next;
	}
	return {
		items,
		cursor,
	};
}

export async function followAgentLabActivity(input: {
	client: MarketClient;
	teamId: string;
	workdayRunId: string;
	signal: AbortSignal;
	onEvent(event: AgentActivityEvent): Promise<void> | void;
}) {
	let after = -1;
	let failures = 0;
	while (!input.signal.aborted) {
		try {
			const query = new URLSearchParams({ after: String(after) });
			const response = await input.client.fetchImpl(
				`${input.client.baseUrl}/v1/teams/${encodeURIComponent(input.teamId)}/workday-runs/${encodeURIComponent(input.workdayRunId)}/activity/stream?${query}`,
				{ signal: input.signal, headers: input.client.accessToken ? { authorization: `Bearer ${input.client.accessToken}` } : {} },
			);
			if (!response.ok || !response.body) throw new Error(`Agent Lab activity stream failed with HTTP ${response.status}.`);
			failures = 0;
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			while (!input.signal.aborted) {
				const chunk = await reader.read();
				if (chunk.done) break;
				buffer += decoder.decode(chunk.value, { stream: true });
				for (;;) {
					const boundary = buffer.indexOf('\n\n');
					if (boundary < 0) break;
					const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
					const data = block.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
					if (!data) continue;
					const event = JSON.parse(data) as AgentActivityEvent;
					after = Math.max(after, event.sequence);
					await input.onEvent(event);
				}
			}
		} catch (error) {
			if (input.signal.aborted) break;
			failures += 1;
			const delay = Math.min(5_000, 250 * (2 ** Math.min(failures - 1, 5)));
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, delay);
				input.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
			});
		}
	}
}

export async function readAgentLabTranscript(client: MarketClient, executionRunId: string) {
	const entries: Row[] = [];
	let cursor: string | null = null;
	for (;;) {
		const query = new URLSearchParams({ limit: '200', ...(cursor ? { cursor } : {}) });
		const response = await client.request<Row>(
			`/v1/execution-runs/${encodeURIComponent(executionRunId)}/transcript?${query}`,
			{ requireAuth: true },
		);
		const payload = payloadOf(response);
		if (Array.isArray(payload.entries)) entries.push(...payload.entries.map(record));
		const page = record(payload.page);
		if (page.hasMore !== true || !text(page.nextCursor)) break;
		cursor = text(page.nextCursor);
	}
	return entries;
}

function transcriptItem(entry: Row, executionId: string, index: number): AgentLabTranscriptItem {
	const output = record(entry.outputs ?? entry.output);
	const error = record(entry.error);
	return {
		id: text(entry.id) ?? `${executionId}:transcript:${index}`,
		timestamp: text(entry.created_at ?? entry.createdAt ?? entry.started_at ?? entry.startedAt),
		type: text(entry.event_type ?? entry.eventType ?? entry.mode ?? entry.status) ?? 'execution-record',
		text: text(entry.status_message ?? entry.statusMessage ?? entry.summary ?? entry.message ?? output.summary ?? error.message),
		status: text(entry.status),
		payload: entry,
	};
}

function executionEvidence(transcript: Row[], executionId: string): AgentLabExecutionEvidence[] {
	const evidence: AgentLabExecutionEvidence[] = [];
	const push = (entry: Row, index: number, kind: AgentLabExecutionEvidence['kind'], label: string, summary: unknown, detail: unknown, status?: unknown) => evidence.push({
		id: `${executionId}:${kind}:${text(entry.id) ?? index}`,
		timestamp: text(entry.created_at ?? entry.createdAt ?? entry.started_at ?? entry.startedAt),
		kind, label, status: text(status ?? entry.status), summary: text(summary), detail,
	});
	for (const [index, entry] of transcript.entries()) {
		const outputs = record(entry.outputs_json ?? entry.outputs ?? entry.output);
		const metadata = record(outputs.metadata);
		const source = text(metadata.source ?? record(entry.metadata_json ?? entry.metadata).source) ?? '';
		const message = record(metadata.message);
		const payload = record(message.payload);
		const item = record(payload.item);
		const itemType = text(item.type);
		const workPackage = record(metadata.workPackage);
		const context = record(workPackage.context);
		const packs = Array.isArray(context.contextPacks) ? context.contextPacks : [];
		for (const [packIndex, pack] of packs.entries()) {
			const normalized = normalizedContextPack(pack);
			push(entry, index * 100 + packIndex, 'context-pack', `Context pack ${packIndex + 1}`, `${normalized.statistics.fileCount} files · ${normalized.statistics.totalBytes} bytes`, normalized, outputs.status);
		}
		if (Object.keys(workPackage).length) push(entry, index, 'work-package', text(workPackage.title) ?? 'Resolved work package', workPackage.summary, workPackage, outputs.status);
		const codex = record(metadata.codex);
		const request = record(metadata.request ?? codex.request);
		if (text(request.prompt)) push(entry, index, 'provider-invocation', `${text(metadata.provider ?? codex.provider) ?? 'Execution provider'} invocation`, `Prompt · ${String(text(request.prompt)?.length ?? 0)} characters`, request, outputs.status);
		else if (source === 'execution_provider_starting') push(entry, index, 'provider-invocation', `${text(metadata.provider) ?? 'Execution provider'} invocation started`, outputs.summary, metadata, outputs.status);
		if (['provider_runner_assignment_project_materialized', 'provider_runner_repository_ready', 'provider_runner_early_exit'].includes(source)) {
			const label = source === 'provider_runner_repository_ready' ? 'TreeDX and execution context ready'
				: source === 'provider_runner_early_exit' ? 'Execution context preparation failed' : 'Assignment execution context prepared';
			push(entry, index, 'diagnostic', label, outputs.summary ?? entry.fallback_reason, { authority: Object.keys(record(metadata.treeDx)).length ? 'TreeDX workspace' : text(record(metadata.repository).materialization) ?? 'assignment context', repository: metadata.repository, treeDx: metadata.treeDx, projectFound: metadata.projectFound, failure: entry.fallback_reason }, outputs.status ?? entry.status);
		}
		if (message.type === 'agent.execution.activity' && itemType) {
			const kind = ['mcp_tool_call', 'command_execution', 'web_search', 'file_change'].includes(itemType) ? 'tool-call'
				: itemType === 'reasoning' ? 'reasoning' : itemType === 'agent_message' ? 'agent-message' : 'diagnostic';
			push(entry, index, kind, itemType.replaceAll('_', ' '), item.text ?? item.command ?? item.tool ?? item.query ?? record(item.error).message, { eventType: payload.eventType, item, usage: payload.usage, error: payload.error }, item.status ?? entry.status);
		}
		if (source.includes('treedx') || source.includes('content_operation')) push(entry, index, 'treedx-call', text(outputs.summary) ?? 'TreeDX operation', metadata.operation ?? metadata.path ?? null, metadata, outputs.status);
		const providerOutput = record(outputs.outputs);
		if (text(providerOutput.finalResponse) || text(codex.finalResponse)) push(entry, index, 'provider-output', 'Execution provider output', text(providerOutput.finalResponse ?? codex.finalResponse), Object.keys(providerOutput).length ? providerOutput : codex, outputs.status);
		if (entry.status === 'failed' || outputs.status === 'failed') {
			const execution = record(record(outputs.metadata).executionSnapshot);
			push(entry, index, 'diagnostic', 'Execution failure', outputs.summary ?? entry.fallback_reason, {
				validation: entry.validation_json ?? entry.validation,
				error: entry.error,
				execution: { status: execution.status, code: execution.code, retryable: execution.retryable, summary: execution.summary },
			}, 'failed');
		}
	}
	const seen = new Set<string>();
	return evidence.filter((entry) => {
		const signature = `${entry.kind}:${JSON.stringify(entry.detail)}`;
		if (seen.has(signature)) return false;
		seen.add(signature); return true;
	});
}

function executionFromEvents(events: AgentActivityEvent[], transcript: Row[], assignment: Row): AgentLabExecution {
	const first = events[0]!;
	const last = events.at(-1)!;
	const transcriptActivityType = transcript.map((entry) =>
		text(entry.activity_type ?? entry.activityType ?? entry.mode)
		?? text(record(entry.selected_input_json ?? entry.selectedInput).activityType),
	).find(Boolean) ?? null;
	const terminalRecord = [...transcript].reverse().find((entry) => {
		const source = text(record(entry.metadata_json ?? entry.metadata).source);
		return ['agent_kernel_mode_runtime', 'provider_assignment_processing_failed'].includes(source ?? '')
			&& ['completed', 'succeeded', 'failed', 'cancelled'].includes(text(entry.status) ?? '');
	});
	const terminalStatus = text(terminalRecord?.status);
	const status = terminalStatus === 'failed' || terminalStatus === 'cancelled' ? 'failed'
		: terminalStatus ? 'completed' : 'running';
	const envelope = record(assignment.capacityEnvelope ?? assignment.capacity_envelope_json);
	const decisionInput = record(assignment.decisionInput ?? assignment.decision_input_json);
	const assignmentInput = record(decisionInput.input);
	const requestedCapacity = record(assignmentInput.capacity);
	const assignedActivityType = text(record(assignment.metadata).activityType) ?? text(record(decisionInput.metadata).activityType) ?? text(record(decisionInput.input).activityType);
	const lifecycle = record(assignment.lifecycleOutput ?? assignment.lifecycle_output_json);
	const terminalOutputs = record(terminalRecord?.outputs_json ?? terminalRecord?.outputs);
	const manifests = [record(lifecycle.artifactManifest), record(terminalOutputs.artifactManifest), record(record(terminalOutputs.outputs).artifactManifest)];
	const signals = [...new Map(manifests.flatMap((manifest) => Array.isArray(manifest.signals) ? manifest.signals.map(record) : [])
		.map((signal) => [`${text(signal.code) ?? ''}:${JSON.stringify(signal.metadata ?? {})}`, signal])).values()];
	const requested = number(decisionInput.requestedCredits ?? envelope.requestedCredits ?? assignment.requestedCredits ?? envelope.reservedCredits);
	const estimated = number(decisionInput.estimatedCredits ?? requestedCapacity.expectedCredits ?? envelope.expectedCredits ?? requested);
	const reserved = number(envelope.reservedCredits ?? assignment.reservedCredits ?? requested);
	const actual = number(lifecycle.actualCredits ?? record(terminalRecord?.usage_actual_json).actualCredits);
	return {
		id: first.executionRunId ?? first.modeRunId ?? first.assignmentId ?? first.id,
		assignmentId: first.assignmentId,
		modeRunId: first.modeRunId,
		agentId: events.find((entry) => entry.agentId)?.agentId ?? null,
		agentClassId: events.find((entry) => entry.agentClassId)?.agentClassId ?? null,
		activityType: assignedActivityType ?? transcriptActivityType ?? events.find((entry) => entry.activityType)?.activityType ?? null,
		handlerId: events.find((entry) => entry.handlerId)?.handlerId ?? null,
		projectId: events.find((entry) => entry.projectId)?.projectId ?? null,
		status,
		startedAt: first.timestamp,
		finishedAt: status === 'running' ? null : text(terminalRecord?.completed_at ?? terminalRecord?.failed_at ?? terminalRecord?.updated_at) ?? last.timestamp,
		providerId: events.find((entry) => entry.capacityProviderId)?.capacityProviderId ?? null,
		providerManagerId: events.find((entry) => entry.providerManagerId)?.providerManagerId ?? null,
		runnerId: events.find((entry) => entry.runnerId)?.runnerId ?? null,
		executionProviderId: events.find((entry) => entry.executionProviderId)?.executionProviderId ?? null,
		transcript: transcript.map((entry, index) => transcriptItem(entry, first.id, index)),
		evidence: executionEvidence(transcript, first.assignmentId ?? first.id),
		signals,
		artifacts: events.flatMap((entry) => entry.artifactRefs),
		usage: Object.assign({}, ...events.map((entry) => entry.usageDelta)),
		error: status === 'failed' ? { category: terminalRecord?.fallback_reason ?? null, summary: record(terminalRecord?.outputs_json).summary ?? null } : null,
		assignment,
		credits: { estimated, requested, reserved, actual, released: Math.max(0, reserved - actual), refunded: 0, overrun: Math.max(0, actual - reserved) },
	};
}

export async function collectAgentLabExecutions(client: MarketClient, activity: AgentActivityEvent[], assignments: Row[] = []) {
	const assignmentsById = new Map(assignments.map((entry) => [text(entry.id), entry]));
	const groups = new Map<string, AgentActivityEvent[]>();
	for (const event of activity) {
		const key = event.assignmentId ?? event.executionRunId ?? event.modeRunId;
		if (!key) continue;
		groups.set(key, [...(groups.get(key) ?? []), event]);
	}
	return Promise.all([...groups.values()].map(async (events) => {
		// The transcript route is keyed by a durable mode-run record and then pages
		// every sanitized mode run for its assignment. executionRunId identifies the
		// native provider invocation and is evidence inside that transcript.
		const executionRunId = events.find((entry) => entry.modeRunId)?.modeRunId;
		const transcript = executionRunId ? await readAgentLabTranscript(client, executionRunId).catch(() => []) : [];
		return executionFromEvents(events, transcript, assignmentsById.get(text(events[0]?.assignmentId)) ?? {});
	}));
}
