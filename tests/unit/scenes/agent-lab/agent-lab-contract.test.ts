import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe,expect,it } from 'vitest';
import {
	BUILT_IN_AGENT_LAB_PRESENTATIONS,
	agentClassPalette,
	hasFailedAgentLabContentTool,
	initialAgentLabSnapshot,
	parseSceneManifest,
	sanitizeAgentLabSnapshot,
	sanitizeAgentLabValue,
	writeAgentLabHtml,
	startAgentLabReportViewer,
	type AgentLabSnapshot,
} from '../../../../src/scenes/index.ts';
import { applyAgentLabAccounting,collectAgentLabExecutions,normalizeAgentLabProviderExecutions,readAgentLabAssignments } from '../../../../src/scenes/agent-lab/activity-collector.ts';
import { agentLabDiagnostic } from '../../../../src/scenes/agent-lab/production-lifecycle.ts';

function manifest() {
	return {
		schemaVersion: 'treeseed.scene/v1', id: 'guide-agent-lab', title: 'Guide Agent Lab',
		journey: { kind: 'agent-lab' }, target: { app: 'market', environment: 'local' }, workflow: [],
		setup: { seeds: [{ name: 'treeseed', environments: ['local'], apply: true }] },
		agentLab: {
			scope: { kind: 'team', team: 'team:treeseed', capacityProvider: 'capacity-provider:treeseed/local' }, provider: 'local', executionProvider: 'codex',
			presentation: 'race-control', timeZone: 'America/New_York', repositories: ['market'],
			agents: [], agentClasses: [],
			workdays: [{ id: 'guide', agentTests: ['guide-editorial-cycle'], objectiveRefs: ['objective:harden-documentation-automation-workday-loop'], durationSeconds: 1800, timePolicy: { cooperativePlanningPercent: 90, governedExecutionPercent: 0, reservePercent: 10 }, planningSession: { rounds: 3, assignmentTimeboxSeconds: 300 }, maxActiveAssignments: 4, planningOnly: true, profileInputs: {} }],
		},
	};
}

function snapshot(): AgentLabSnapshot {
	const value = initialAgentLabSnapshot({
		sceneId: 'guide-agent-lab', runId: 'run-1', presentation: 'race-control', timeZone: 'America/New_York',
		repositories: ['market'], workdays: [{ id: 'guide', agentTests: ['guide-editorial-cycle'] }],
	});
	value.status = 'running';
	value.team = { id: 'team-1', name: 'Lab', isolation: 'ephemeral' };
	value.provider = { id: 'provider-1', membershipId: 'membership-1', executionProviderId: 'codex', status: 'available' };
	value.workdays[0]!.status = 'running';
	value.workdays[0]!.activity = [{
		id: 'event-1', sequence: 1, sourceEventId: 'source-1', timestamp: '2026-08-03T14:00:00.000Z',
		teamId: 'team-1', projectId: 'project-1', workdayId: 'workday-1', assignmentId: 'assignment-1',
		modeRunId: 'mode-1', executionRunId: 'execution-1', agentId: 'guide-steward', agentClassId: 'guide-steward',
		activityType: 'planning', handlerId: 'writer', capacityProviderId: 'provider-1', providerManagerId: 'manager-1',
		runnerId: 'runner-1', executionProviderId: 'codex', eventType: 'mode.started', severity: 'info', summary: '<plan & inspect>',
		transcriptRef: 'mode-run://mode-1', artifactRefs: [], contextPackDigest: null, usageDelta: {}, durationMs: null,
		errorCategory: null, recoveryState: null, redactionStatus: 'sanitized', payloadDigest: 'digest',
	}];
	value.workdays[0]!.executions = [{
		id: 'execution-1', assignmentId: 'assignment-1', modeRunId: 'mode-1', agentId: 'guide-steward', agentClassId: 'guide-steward',
		activityType: 'planning', handlerId: 'writer', projectId: 'project-1', status: 'running', startedAt: '2026-08-03T14:00:00.000Z',
		finishedAt: null, providerId: 'provider-1', providerManagerId: 'manager-1', runnerId: 'runner-1', executionProviderId: 'codex',
		transcript: [{ id: 't1', timestamp: '2026-08-03T14:00:00.000Z', type: 'status', text: 'Inspecting evidence', status: 'running', payload: { authorization: 'Bearer secret', tool: 'treedx.read' } }],
		evidence: [{ id: 'e1', timestamp: '2026-08-03T14:00:00.000Z', kind: 'tool-call', label: 'TreeDX read', status: 'running', summary: 'Inspecting evidence', detail: { tool: 'treedx.read' } }],
		signals: [{ code: 'evidence-ready', severity: 'info', message: 'Discovery evidence is ready.', metadata: { source: 'agent_activity_contract' } }],
		artifacts: [], usage: {}, error: null, assignment: {},
		capacity: { requestedSeconds: 0, reservedSeconds: 0, activeSeconds: 0, elapsedSeconds: 0, releasedSeconds: 0, overrunSeconds: 0, inputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, outputTokens: 0, costAmount: null, costCurrency: null, nativeUsage: {} },
	}];
	return value;
}

describe('production Agent Lab scene contract', () => {
	it('parses a non-browser production scene and rejects mock providers', () => {
		const diagnostics: Array<{ severity: string; code: string }> = [];
		const parsed = parseSceneManifest(manifest(), diagnostics as never);
		expect(parsed?.journey?.kind).toBe('agent-lab');
		expect(parsed?.setup.seeds).toEqual([{ name: 'treeseed', environments: ['local'], apply: true }]);
		expect(parsed?.agentLab?.scope).toEqual({ kind: 'team', team: 'team:treeseed', capacityProvider: 'capacity-provider:treeseed/local' });
		expect(parsed?.agentLab?.workdays[0]?.agentTests).toEqual(['guide-editorial-cycle']);
		expect(parsed?.agentLab?.workdays[0]?.objectiveRefs).toEqual(['objective:harden-documentation-automation-workday-loop']);
		expect(diagnostics).toEqual([]);
		const invalid = manifest();
		invalid.agentLab.provider = 'mock';
		const invalidDiagnostics: Array<{ code: string }> = [];
		parseSceneManifest(invalid, invalidDiagnostics as never);
		expect(invalidDiagnostics.map((entry) => entry.code)).toContain('scene.agent_lab_provider_invalid');
	});

	it('allocates unique deterministic class colors', () => {
		const classes = ['guide-steward', 'guide-writing', 'technical-verification', 'audience-review'];
		const first = agentClassPalette(classes);
		expect(agentClassPalette([...classes].reverse())).toEqual(first);
		expect(new Set(Object.values(first)).size).toBe(classes.length);
	});

	it('redacts credentials recursively without hiding provider reasoning summaries', () => {
		const sanitized = sanitizeAgentLabSnapshot(snapshot());
		const payload = sanitized.workdays[0]!.executions[0]!.transcript[0]!.payload;
		expect(payload.authorization).toBe('[REDACTED]');
		expect(sanitized.workdays[0]!.executions[0]!.transcript[0]!.text).toBe('Inspecting evidence');
		expect(sanitizeAgentLabValue({ tokenCounts: { inputTokens: 42 }, token_usage: { output_tokens: 8 }, input_tokens: 41, reasoning_output_tokens: 9, tokenEstimate: 120, tokenEstimateSource: 'character-estimate', total_token_estimate: 240, accessToken: 'secret' })).toEqual({ tokenCounts: { inputTokens: 42 }, token_usage: { output_tokens: 8 }, input_tokens: 41, reasoning_output_tokens: 9, tokenEstimate: 120, tokenEstimateSource: 'character-estimate', total_token_estimate: 240, accessToken: '[REDACTED]' });
	});

	it('normalizes only canonical execution-provider attempts for selected assignments', () => {
		const base = { assignment: { id: 'assignment-1', runnerId: 'runner-1' }, agent: { agentId: 'guide-writer', projectAgentClassId: 'class-1', handlerId: 'writer', projectId: 'project-1' }, executionProvider: { id: 'codex', capacityProviderId: 'provider-1', tokenCounts: { inputTokens: 42 } }, timing: { startedAt: '2026-08-03T14:00:00.000Z' }, input: { selectedInput: { activityType: 'reviewing' } } };
		const result = normalizeAgentLabProviderExecutions([
			{ ...base, id: 'execution-1', status: 'running', mode: 'acting', metadata: { modeRun: { source: 'agent_kernel_inputs_resolved' } } },
			{ ...base, id: 'message-1', status: 'running', mode: 'acting', metadata: { modeRun: { source: 'provider_runner_message' } } },
		], new Set(['assignment-1']));
		expect(result).toEqual([expect.objectContaining({ id: 'execution-1', assignmentId: 'assignment-1', status: 'running', activityType: 'reviewing', agentId: 'guide-writer', executionProviderId: 'codex', tokenCounts: { inputTokens: 42 } })]);
	});

	it('labels assignments with the exact activity profile carried by their governed input', async () => {
		const client = { request: async () => ({ payload: { items: [{
			id: 'assignment-1', mode: 'planning', workdayRunId: 'run-1',
			decisionInput: { input: { activityType: 'reviewing' } },
		}], page: { hasMore: false } } }) };
		await expect(readAgentLabAssignments({ client: client as never, teamId: 'team-1', workdayRunId: 'run-1' }))
			.resolves.toEqual([expect.objectContaining({ mode: 'planning', activityType: 'reviewing' })]);
	});

	it('collects assignments linked by durable activity when project workdays have distinct ids', async () => {
		const client = { request: async () => ({ payload: { items: [
			{ id: 'assignment-linked', metadata: {}, decisionInput: { input: { activityType: 'estimating' } } },
			{ id: 'assignment-unrelated', metadata: {} },
		], page: { hasMore: false } } }) };
		await expect(readAgentLabAssignments({
			client: client as never,
			teamId: 'team-1',
			workdayRunId: 'portfolio-run-1',
			assignmentIds: new Set(['assignment-linked']),
		})).resolves.toEqual([expect.objectContaining({ id: 'assignment-linked', activityType: 'estimating' })]);
	});

	it('deduplicates diagnostics around a bounded human-readable cause instead of embedding runner payloads', () => {
		const diagnostic = agentLabDiagnostic(new Error(`Provider runner completed 1 assignments instead of 2: [{"payload":"${'x'.repeat(2_000)}"}]`));
		expect(diagnostic).toBe('Provider runner completed 1 assignments instead of 2');
		expect(diagnostic.length).toBeLessThan(1_000);
	});

	it('fails production evidence when a TreeDX or content tool call failed', () => {
		const value = snapshot();
		expect(hasFailedAgentLabContentTool(value.workdays[0]!)).toBe(false);
		value.workdays[0]!.executions[0]!.transcript.push({
			id: 'failed-tool', timestamp: '2026-08-03T14:01:00.000Z', type: 'planning', text: null, status: 'running',
			payload: { item: { type: 'mcp_tool_call', tool: 'treedx_read_repository_files', status: 'failed' } },
		});
		expect(hasFailedAgentLabContentTool(value.workdays[0]!)).toBe(true);
	});

	it('does not combine an unrelated failure status with a successful content tool record', () => {
		const value = snapshot();
		value.workdays[0]!.executions[0]!.transcript.push({
			id: 'mixed-record', timestamp: null, type: 'planning', text: null, status: 'failed',
			payload: { status: 'failed', item: { type: 'mcp_tool_call', tool: 'treeseed_content_read', status: 'completed' } },
		});
		expect(hasFailedAgentLabContentTool(value.workdays[0]!)).toBe(false);
	});

	it('fails production evidence when deterministic context assembly records a TreeDX failure', () => {
		const value = snapshot();
		value.workdays[0]!.executions[0]!.evidence.push({
			id: 'work-package', timestamp: null, kind: 'work-package', label: 'Work package', status: 'running', summary: null,
			detail: { evidence: [{ id: 'treedx-evidence-warnings', warnings: ['TreeDX Guide editorial graph context failed: response too large'] }] },
		});
		expect(hasFailedAgentLabContentTool(value.workdays[0]!)).toBe(true);
	});

	it('renders identical sanitized evidence through all presentation adapters', () => {
		const value = sanitizeAgentLabSnapshot(snapshot());
		for (const adapter of BUILT_IN_AGENT_LAB_PRESENTATIONS) {
			const html = adapter.render(value);
			expect(html).toContain('agent-lab-data');
			expect(html).toContain('\\u003cplan & inspect>');
			expect(html).not.toContain('Bearer secret');
			expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/u);
			expect(html).toContain('<dialog id="command-dialog"');
			expect(html).toContain('Context window');
			expect(html).toContain('Handoff signals');
			expect(html).toContain('evidence-ready');
			expect(html).toContain('overflow-anchor:none');
			expect(html).toContain('const __name=function(target){return target;}');
			expect(html).toContain('route.delete(key)');
			expect(html.match(/applyHash\(true\)/gu)).toHaveLength(1);
			expect(html).toContain('openEntity("assignment"');
			expect(html).toContain('const renderLiveUpdate = () => render()');
			expect(html).not.toContain('window.scrollTo(0, scrollY)');
			expect(html).not.toContain("close(); focusAssignment(");
			expect(html).toContain('Execution providers');
			expect(html).toContain('data-list-filters');
			const embedded = html.match(/<script type="application\/json" id="agent-lab-data">([^<]+)<\/script>/u)?.[1];
			expect(JSON.parse(embedded!)).toEqual(value);
		}
	});

	it('atomically writes an offline standalone report', async () => {
		const root = mkdtempSync(resolve(tmpdir(), 'agent-lab-report-'));
		const path = resolve(root, 'report.html');
		await writeAgentLabHtml(path, BUILT_IN_AGENT_LAB_PRESENTATIONS[0]!, sanitizeAgentLabSnapshot(snapshot()));
		const html = readFileSync(path, 'utf8');
		expect(html).toContain('<!doctype html>');
		expect(html).toContain('guide-steward');
		expect(html).not.toContain('Bearer secret');
	});

	it('reopens a large embedded report without regular-expression stack exhaustion', async () => {
		const root = mkdtempSync(resolve(tmpdir(), 'agent-lab-large-report-'));
		const path = resolve(root, 'report.html');
		const value = snapshot();
		value.workdays[0]!.executions[0]!.transcript[0]!.payload.largeEvidence = 'x'.repeat(9_000_000);
		await writeAgentLabHtml(path, BUILT_IN_AGENT_LAB_PRESENTATIONS[0]!, value);
		const previousPort = process.env.TREESEED_AGENT_SIMULATOR_PORT;
		process.env.TREESEED_AGENT_SIMULATOR_PORT = '14761';
		try {
			const viewer = await startAgentLabReportViewer(path);
			await expect(fetch(`${viewer.url}status`).then((response) => response.json())).resolves.toMatchObject({ ok: true, runId: 'run-1' });
			await viewer.close();
		} finally {
			if (previousPort === undefined) delete process.env.TREESEED_AGENT_SIMULATOR_PORT;
			else process.env.TREESEED_AGENT_SIMULATOR_PORT = previousPort;
		}
	});

	it('recovers the activity profile from durable transcript evidence', async () => {
		const event = snapshot().workdays[0]!.activity[0]!;
		const client = {
			request: async () => ({
				entries: [{
					id: 'mode-1', mode: 'planning', status: 'completed',
					selected_input_json: { activityType: 'planning' },
					metadata_json: { source: 'agent_kernel_mode_runtime' },
				}],
				page: { hasMore: false },
			}),
		};
		const executions = await collectAgentLabExecutions(client as never, [{ ...event, activityType: null } as never]);
		expect(executions[0]?.activityType).toBe('planning');
		expect(executions[0]?.status).toBe('completed');
	});

	it('presents TreeDX execution-context preparation as readable evidence', async () => {
		const event = snapshot().workdays[0]!.activity[0]!;
		const client = { request: async () => ({ entries: [{ id: 'mode-1', mode: 'acting', status: 'running', outputs: { status: 'repository_ready', summary: 'TreeDX context is ready.', metadata: { source: 'provider_runner_repository_ready', treeDx: { workspaceId: 'workspace-1', repositoryId: 'repo-1' }, repository: { materialization: 'context' } } } }], page: { hasMore: false } }) };
		const [execution] = await collectAgentLabExecutions(client as never, [event as never]);
		expect(execution?.evidence).toContainEqual(expect.objectContaining({ label: 'TreeDX and execution context ready', summary: 'TreeDX context is ready.', detail: expect.objectContaining({ authority: 'TreeDX workspace' }) }));
	});

	it('derives and labels a context token estimate when TreeDX reports only content sizes', async () => {
		const event = snapshot().workdays[0]!.activity[0]!;
		const contextPack = { files: [{ path: 'guide.md', content: 'x'.repeat(1000) }] };
		const client = { request: async () => ({ entries: [{
			id: 'mode-1', mode: 'planning', status: 'running',
			outputs: { metadata: { workPackage: { context: { contextPacks: [contextPack] } } } },
		}], page: { hasMore: false } }) };
		const [execution] = await collectAgentLabExecutions(client as never, [event as never]);
		expect(execution?.evidence.find((entry) => entry.kind === 'context-pack')?.detail).toMatchObject({
			statistics: { totalBytes: 1000, totalCharacters: 1000, tokenEstimate: 250, tokenEstimateSource: 'character-estimate' },
		});
	});

	it('uses the assignment activity profile instead of its broad planning mode', async () => {
		const event = { ...snapshot().workdays[0]!.activity[0]!, activityType: 'planning' };
		const client = { request: async () => ({ entries: [{ id: 'mode-1', mode: 'planning', status: 'running' }], page: { hasMore: false } }) };
		const [execution] = await collectAgentLabExecutions(client as never, [event as never], [{ id: 'assignment-1', metadata: { activityType: 'estimating' } }]);
		expect(execution?.activityType).toBe('estimating');
	});

	it('projects validated artifact-manifest signals for readable downstream handoffs', async () => {
		const event = snapshot().workdays[0]!.activity[0]!;
		const client = { request: async () => ({ entries: [{ id: 'mode-1', mode: 'planning', status: 'completed', metadata_json: { source: 'agent_kernel_mode_runtime' } }], page: { hasMore: false } }) };
		const [execution] = await collectAgentLabExecutions(client as never, [event as never], [{
			id: 'assignment-1', lifecycleOutput: { artifactManifest: { signals: [{ code: 'evidence-ready', severity: 'info', metadata: { source: 'agent_activity_contract' } }] } },
		}]);
		expect(execution?.signals).toEqual([{ code: 'evidence-ready', severity: 'info', metadata: { source: 'agent_activity_contract' } }]);
	});

	it('maps requested and durable dimensional accounting without treating zero as missing', async () => {
		const event = snapshot().workdays[0]!.activity[0]!;
		const client = { request: async () => ({ entries: [{ id: 'mode-1', mode: 'planning', status: 'completed', metadata_json: { source: 'agent_kernel_mode_runtime' } }], page: { hasMore: false } }) };
		const [execution] = await collectAgentLabExecutions(client as never, [event as never], [{ id: 'assignment-1', capacityEnvelope: { requestedSeconds: 300, reservedSeconds: 300 }, decisionInput: { requestedSeconds: 300 } }]);
		expect(execution?.capacity).toEqual(expect.objectContaining({ requestedSeconds: 300, reservedSeconds: 300 }));
		const [accounted] = applyAgentLabAccounting([execution!], { evidence: { reservations: { items: [{ assignmentId: 'assignment-1', reservedSeconds: 300, releasedSeconds: 300 }] }, usageActuals: { items: [{ assignmentId: 'assignment-1', activeSeconds: 0, elapsedSeconds: 0 }] }, ledgerEntries: { items: [] } } });
		expect(accounted?.capacity).toEqual(expect.objectContaining({ reservedSeconds: 300, activeSeconds: 0, releasedSeconds: 300 }));
	});
});
