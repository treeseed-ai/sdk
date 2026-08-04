import { ProviderProtocolClient } from '../../capacity/providers/capacity-provider.ts';
import { validateAgentArtifactContract } from '../../agent-capacity/validation/agent-artifact.ts';
import { MarketClient } from '../../entrypoints/clients/market-client.ts';
import {
	provisionLocalCapacityAcceptanceProvider,
	syncLocalAcceptanceAgentClasses,
} from '../../reconcile/capacity/capacity-core/live-acceptance-capacity-context.ts';
import type { CapacityAcceptanceExecutionInput,CapacityAcceptanceExecutionResult } from '../../reconcile/capacity/capacity-core/live-acceptance-capacity-executor.ts';
import { createLocalCapacityAcceptanceScope } from '../../reconcile/capacity/capacity-core/live-acceptance-capacity-scope.ts';
import { closeCapacityAcceptanceAvailabilitySession } from '../../reconcile/capacity/capacity-core/live-acceptance-capacity-cleanup.ts';
import type { AgentLabExecutor,AgentLabSnapshot,AgentLabWorkdaySnapshot } from '../types.ts';
import { applyAgentLabAccounting,collectAgentLabExecutions,followAgentLabActivity,readAgentLabAccounting,readAgentLabActivity,readAgentLabAssignments,readAgentLabProviderExecutions } from './activity-collector.ts';
import { hasFailedAgentLabContentTool,initialAgentLabSnapshot,sanitizeAgentLabSnapshot } from './report-model.ts';
import { seedAgentLabPlanningProfileInputs } from './profile-input-seed.ts';
import { verifyAgentLabTerminal } from './terminal-verification.ts';
import { resolveTeamAgentLabRuntime } from './runtime/team-scope.ts';
import { agentLabDiagnostic, localAgentLabApiConfig, withAgentLabDiagnostic as withDiagnostic } from './runtime/diagnostics.ts';
import { resolveAgentLabInitiator } from './runtime/metadata.ts';
import { parse as parseYaml } from 'yaml';

type Row = Record<string, unknown>;
type AssignmentExecutor = (input: CapacityAcceptanceExecutionInput) => Promise<CapacityAcceptanceExecutionResult>;
const BASE_CAPABILITIES = ['planning', 'repo_read', 'agent_mode_run', 'usage_report'];
const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'degraded']);
const EDITORIAL_AGENTS = new Set(['guide-steward', 'knowledge-cartographer', 'evidence-researcher', 'guide-writer', 'technical-verifier', 'audience-reviewer', 'publication-steward', 'workday-reporter']);

function record(value: unknown): Row {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}
function text(...values: unknown[]): string {
	for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
	return '';
}

async function withdrawLegacySyntheticProposals(client: MarketClient, projectId: string) {
	const response = await client.request<{ payload?: unknown }>(`/v1/projects/${encodeURIComponent(projectId)}/proposals?limit=200`, { requireAuth: true });
	const payload = record(response.payload);
	const proposals = Array.isArray(response.payload) ? response.payload : Array.isArray(payload.items) ? payload.items : [];
	for (const value of proposals) {
		const proposal = record(value);
		if (text(proposal.title) !== 'Authorize bounded TreeSeed Guide editorial execution' || text(proposal.proposalType,proposal.proposal_type) !== 'editorial-test'
			|| ['withdrawn','accepted','rejected','superseded'].includes(text(proposal.status))) continue;
		await client.request(`/v1/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(text(proposal.id))}/withdraw`, {
			method: 'POST', requireAuth: true, body: { reason: 'Withdraw obsolete SDK-generated Agent Lab authorization shortcut; preserve historical evidence.' },
		});
	}
}
export { agentLabDiagnostic } from './runtime/diagnostics.ts';
async function resolveGuideSelection(input: {
	client: MarketClient;
	projectId: string;
	repositoryId: string;
	agentTests: string[];
	agents: string[];
}) {
	const testPaths = input.agentTests.map((id) => `src/content/agent-tests/${id}.mdx`);
	const tests = await input.client.treeDxReadRepositoryFiles(input.projectId, input.repositoryId, {
		ref: 'refs/heads/main', paths: testPaths, encoding: 'utf8', parseFrontmatter: true,
	});
	const payload = record(tests.payload);
	const resolvedRef = text(payload.resolvedRef);
	if (!/^[a-f0-9]{40}$/u.test(resolvedRef)) {
		throw new Error('Agent Lab test selection did not resolve to an immutable TreeDX commit.');
	}
	const files = Array.isArray(payload.files) ? payload.files.map(record) : [];
	if (files.length !== testPaths.length) {
		throw new Error(`Agent Lab resolved ${files.length}/${testPaths.length} agent tests through TreeDX.`);
	}
	const testAgentSlugs = [...new Set(files.flatMap((file) => {
		const frontmatter = record(file.frontmatter);
		const trigger = record(frontmatter.trigger);
		return Array.isArray(trigger.agents) ? trigger.agents.map(text).filter(Boolean) : [text(frontmatter.agent)].filter(Boolean);
	}))];
	const agentSlugs = input.agents.length ? input.agents : testAgentSlugs;
	if (!agentSlugs.length) throw new Error('Selected workday agent tests contain no production agent selection.');
	const agentPaths = agentSlugs.map((slug) => `src/content/agents/${EDITORIAL_AGENTS.has(slug) ? 'editorial/' : ''}${slug}.mdx`);
	const synchronized = await syncLocalAcceptanceAgentClasses(input.client, {
		projectId: input.projectId, repositoryId: input.repositoryId, agentPaths, runId: resolvedRef.slice(0, 16),
	});
	if (synchronized.resolvedRef !== resolvedRef) {
		throw new Error('Agent Lab agent definitions and tests did not resolve from the same immutable TreeDX commit.');
	}
	const classes = synchronized.agentClasses.map((response) => record(response.payload));
	const agentFilesResponse = await input.client.treeDxReadRepositoryFiles(input.projectId, input.repositoryId, {
		ref: resolvedRef, paths: agentPaths, encoding: 'utf8', parseFrontmatter: true,
	});
	const agentFiles = Array.isArray(record(agentFilesResponse.payload).files) ? record(agentFilesResponse.payload).files as unknown[] : [];
	const contractKinds = new Map<string,'artifact' | 'signal'>();
	for (const fileValue of agentFiles) {
		const profiles = record(record(fileValue).frontmatter).activityProfiles;
		for (const profileValue of Object.values(record(profiles))) {
			const profile = record(profileValue);
			for (const owner of [record(profile.inputs),record(profile.outputs)]) {
				for (const id of Array.isArray(owner.artifactContracts) ? owner.artifactContracts.map(text).filter(Boolean) : []) contractKinds.set(id,'artifact');
				for (const id of Array.isArray(owner.signalContracts) ? owner.signalContracts.map(text).filter(Boolean) : []) contractKinds.set(id,'signal');
			}
		}
	}
	if (contractKinds.size) {
		const contractPaths = [...contractKinds.keys()].map((id) => `.treeseed/agents/artifacts/${id}.yaml`);
		const response = await input.client.treeDxReadRepositoryFiles(input.projectId,input.repositoryId,{ ref: resolvedRef, paths: contractPaths, encoding: 'utf8', parseFrontmatter: false });
		const contractPayload = record(response.payload);
		const contractFiles = Array.isArray(contractPayload.files) ? contractPayload.files.map(record) : [];
		if (text(contractPayload.resolvedRef) !== resolvedRef || contractFiles.length !== contractPaths.length) throw new Error('Agent Lab artifact and signal contracts did not resolve completely at the selected immutable ref.');
		for (const file of contractFiles) {
			const parsed = parseYaml(text(file.content)); const validation = validateAgentArtifactContract(parsed);
			const expected = contractKinds.get(text(record(parsed).id));
			if (!validation.ok || !expected || record(parsed).kind !== expected) throw new Error(`Agent Lab contract ${text(file.path)} is invalid or referenced with the wrong connector kind.`);
		}
	}
	const agentDefinitions = agentFiles.map((fileValue) => {
		const file = record(fileValue); const frontmatter = record(file.frontmatter);
		const profiles = record(frontmatter.activityProfiles);
		return {
			id: text(frontmatter.slug), title: text(frontmatter.title ?? frontmatter.name) || text(frontmatter.slug),
			classId: text(frontmatter.agentClass ?? frontmatter.projectAgentClassSlug), description: text(frontmatter.description) || null,
			identity: record(frontmatter.identity), capabilities: Array.isArray(frontmatter.capabilities) ? frontmatter.capabilities.map(record) : [],
			activityProfiles: Object.entries(profiles).map(([id, profileValue]) => {
				const profile = record(profileValue);
				return { id, activityType: text(profile.activityType) || id, handlerId: text(profile.handler) || null, enabled: profile.enabled !== false, execution: record(profile.execution) };
			}),
		};
	});
	return {
		resolvedRef,
		agentSlugs,
		agentPaths,
		classSlugs: classes.map((entry) => text(entry.slug)).filter(Boolean),
		classCapabilities: [...new Set(classes.flatMap((entry) => Array.isArray(entry.requiredCapabilities) ? entry.requiredCapabilities.map(text).filter(Boolean) : []))],
		agentClasses: Object.fromEntries(agentSlugs.map((slug, index) => [slug, text(classes[index]?.slug)])),
		agentClassIds: Object.fromEntries(agentSlugs.map((slug, index) => [slug, text(classes[index]?.id)])),
		agentDefinitions,
		normalizedTests: files.map((file) => ({
			path: text(file.path),
			frontmatter: record(file.frontmatter),
		})),
	};
}

function assertionsFor(day: AgentLabWorkdaySnapshot, expectedAgents: string[], expectedProfiles: string[], verifiedAssignments: Set<string>) {
	const completed = day.executions.filter((entry) => entry.status === 'completed');
	const completedProfiles = new Set(completed.filter((entry) => verifiedAssignments.has(entry.assignmentId)).map((entry) => `${entry.agentId}:${entry.activityType}`));
	const completedAgents = new Set(completed.filter((entry) => verifiedAssignments.has(entry.assignmentId)).map((entry) => entry.agentId).filter((value): value is string => Boolean(value)));
	const terminal = TERMINAL.has(day.status);
	const result = (passed: boolean) => passed ? 'passed' as const : terminal ? 'failed' as const : 'pending' as const;
	const events = day.activity;
	const failedContentTool = hasFailedAgentLabContentTool(day);
	const governanceRequired = expectedProfiles.some((profile) => profile.endsWith(':acting'));
	const acceptedGovernance = day.governance.some((proposal) => text(proposal.status) === 'accepted' && text(record(proposal.decision).id));
	return [
		{ id: 'signed-provider', label: 'Signed provider onboarding and approved membership', status: events.some((entry) => entry.capacityProviderId) ? 'passed' as const : 'pending' as const },
		{ id: 'agent-coverage', label: 'Every selected production agent completed', status: result(expectedAgents.every((agent) => completedAgents.has(agent))), detail: `${completedAgents.size}/${expectedAgents.length} agents completed and verified` },
		{ id: 'profile-coverage', label: 'Every required activity profile completed', status: result(expectedProfiles.every((profile) => completedProfiles.has(profile))), detail: `${expectedProfiles.filter((profile) => completedProfiles.has(profile)).length}/${expectedProfiles.length} profiles completed and verified` },
		{ id: 'kernel', label: 'AgentKernel produced durable mode-run evidence', status: events.some((entry) => entry.modeRunId) ? 'passed' as const : 'pending' as const },
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
				const content = text(file.content ?? file.text) || '';
				return { ...reference, ...file, content, bytes: new TextEncoder().encode(content).byteLength, characters: content.length, sourceMap: record(reference.sourceMap), relationReceipt: record(reference.relationReceipt) };
			} catch (error) {
				return { ...reference, inspectionError: error instanceof Error ? error.message : String(error) };
			}
		}));
		return { ...execution, artifacts };
	}));
}

async function refreshWorkday(input: {
	client: MarketClient;
	teamId: string;
	projectId: string;
	repositoryId: string;
	day: AgentLabWorkdaySnapshot;
	expectedAgents: string[];
	expectedProfiles: string[];
	verifiedAssignments: Set<string>;
}) {
	const activity = await readAgentLabActivity({ client: input.client, teamId: input.teamId, workdayRunId: input.day.workdayRunId! });
	const byId = new Map(input.day.activity.map((entry) => [entry.id, entry]));
	for (const event of activity.items) byId.set(event.id, event);
	const events = [...byId.values()].sort((left, right) => left.sequence - right.sequence);
	const assignments = await readAgentLabAssignments({ client: input.client, teamId: input.teamId, workdayRunId: input.day.workdayRunId! });
	const providerExecutions = await readAgentLabProviderExecutions({ client: input.client, teamId: input.teamId, assignmentIds: new Set(assignments.map((entry) => text(entry.id))) });
	const durableWorkdayId = assignments.map((assignment) => text(record(assignment.capacityEnvelope ?? assignment.capacity_envelope_json).workDayId)).find(Boolean);
	const accounting = durableWorkdayId
		? await readAgentLabAccounting(input.client, durableWorkdayId).catch((error) => ({ collectionError: error instanceof Error ? error.message : String(error) }))
		: { collectionError: 'No durable capacity workday identity is available yet.' };
	const observed = await input.client.workdayRun(input.teamId, input.day.workdayRunId!);
	const run = record(observed.payload.run);
	const status = text(run.status) as AgentLabWorkdaySnapshot['status'];
	const executions = await hydrateArtifacts(input.client, input.projectId, input.repositoryId, applyAgentLabAccounting(await collectAgentLabExecutions(input.client, events, assignments), accounting));
	return {
		...input.day,
		status: status || input.day.status,
		startedAt: text(run.startedAt) || input.day.startedAt,
		finishedAt: text(run.completedAt) || (TERMINAL.has(status) ? new Date().toISOString() : null),
		activity: events,
		executions,
		providerExecutions,
		assignments,
		accounting,
		assertions: assertionsFor({ ...input.day, activity: events, executions }, input.expectedAgents, input.expectedProfiles, input.verifiedAssignments),
	};
}

async function refreshWorkdayReliably(input: Parameters<typeof refreshWorkday>[0]) {
	let error: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) try { return await refreshWorkday(input); }
	catch (caught) { error = caught; if (!/fetch failed|timed out|econnreset|socket|temporarily unavailable/iu.test(caught instanceof Error ? caught.message : String(caught))) throw caught; await new Promise((resolve) => setTimeout(resolve, 250)); }
	throw error;
}

function replaceDay(snapshot: AgentLabSnapshot, day: AgentLabWorkdaySnapshot): AgentLabSnapshot {
	return { ...snapshot, generatedAt: new Date().toISOString(), workdays: snapshot.workdays.map((entry) => entry.id === day.id ? day : entry) };
}

export function createProductionAgentLabExecutor(options: {
	env: Record<string, string | undefined>;
	assignmentExecutor: AssignmentExecutor;
	fetchImpl?: typeof fetch;
}): AgentLabExecutor {
	return async (input) => {
		const fetchImpl = options.fetchImpl ?? fetch;
		const api = localAgentLabApiConfig(options.env);
		const client = new MarketClient({
			profile: { id: 'agent-lab', label: 'Agent Lab', baseUrl: api.apiUrl, kind: 'specialized' },
			accessToken: api.adminToken, fetchImpl, userAgent: `treeseed-agent-lab/${input.runId}`,
		});
		const initiatingUser = await resolveAgentLabInitiator(client);
		let snapshot = initialAgentLabSnapshot({
			sceneId: input.sceneId, runId: input.runId, presentation: input.config.presentation,
			timeZone: input.config.timeZone, repositories: input.config.repositories, workdays: input.config.workdays,
		});
		let publishQueue = Promise.resolve();
		let publishPending = false;
		let publishInFlight = false;
		const publish = () => {
			publishPending = true;
			if (publishInFlight) return publishQueue;
			publishInFlight = true;
			publishQueue = (async () => {
				do {
					publishPending = false;
					await input.onUpdate({ snapshot: sanitizeAgentLabSnapshot(snapshot) });
				} while (publishPending);
			})().finally(() => { publishInFlight = false; });
			return publishQueue;
		};
		if (input.config.repositories.some((slug) => slug !== 'market')) {
			throw new Error('This production slice supports the reconciled market repository; additional portfolio repositories are not yet provisionable.');
		}
		let scope: Awaited<ReturnType<typeof createLocalCapacityAcceptanceScope>> | null = null;
		let provider: Awaited<ReturnType<typeof provisionLocalCapacityAcceptanceProvider>> | null = null;
		let protocol: ProviderProtocolClient | null = null;
		let sessionId = '';
		let grantId = '';
		let allocation: Row = {};
		let teamName = '';
		const persistentTeam = input.config.scope.kind === 'team';
		let cleanupError: unknown = null;
		const maxConcurrency = Math.max(...input.config.workdays.map((entry) => entry.maxActiveAssignments));
		try {
			snapshot = { ...snapshot, status: 'running' }; await publish();
			if (input.config.scope.kind === 'team') {
				const resolved = await resolveTeamAgentLabRuntime({
					projectRoot: input.projectRoot, client, apiUrl: api.apiUrl, teamKey: input.config.scope.team,
					providerKey: input.config.scope.capacityProvider, repositories: input.config.repositories,
				});
				scope = resolved.scope;
				provider = resolved.provider;
				grantId = resolved.grantId;
				allocation = resolved.allocation;
				teamName = resolved.teamName;
			} else {
				scope = await createLocalCapacityAcceptanceScope(client, `agent-lab-${input.runId}`);
			}
			const library = (await client.projectTreeDxLibrary(scope.projectId)).payload;
			await withdrawLegacySyntheticProposals(client,scope.projectId);
			const repositoryId = text(library.repositoryId);
			if (!repositoryId) throw new Error('Agent Lab isolated project has no authoritative TreeDX repository binding.');
			const selections = new Map<string, Awaited<ReturnType<typeof resolveGuideSelection>>>();
			for (const workday of input.config.workdays) {
				const resolved = await resolveGuideSelection({
					client, projectId: scope.projectId, repositoryId, agentTests: workday.agentTests,
					agents: input.config.agents,
				});
				const filtered = resolved.agentSlugs.filter((slug) =>
					!input.config.agentClasses.length || input.config.agentClasses.includes(resolved.agentClasses[slug] ?? ''));
				if (!filtered.length) throw new Error(`Agent Lab overrides selected no eligible agents for workday ${workday.id}.`);
				selections.set(workday.id, { ...resolved, agentSlugs: filtered });
			}
			const capabilities = [...new Set([...BASE_CAPABILITIES, ...[...selections.values()].flatMap((entry) => entry.classCapabilities)])];
			if (!provider) provider = await provisionLocalCapacityAcceptanceProvider({
				adminClient: client, apiUrl: api.apiUrl, teamId: scope.teamId, runId: input.runId, fetchImpl,
				capabilities, maxConcurrentRunners: maxConcurrency, purpose: 'production-agent-lab',
			});
			protocol = new ProviderProtocolClient({ marketUrl: api.apiUrl, accessToken: provider.providerAccessToken, fetchImpl });
			const executionProvider = { id: 'codex', adapter: 'codex', status: 'available', capabilities, maxConcurrentRunners: maxConcurrency, activeRunners: 0, nativeLimits: { availableCredits: input.config.workdays.reduce((total, entry) => total + entry.availableCredits, 0) }, lanes: [] };
			let availability: Awaited<ReturnType<ProviderProtocolClient['createAvailabilitySession']>> | null = null;
			if (!persistentTeam) {
				availability = await protocol.createAvailabilitySession({
					environment: 'local', status: 'open', capabilities, grants: [], executionProviders: [executionProvider],
					nativeLimits: { availableCredits: executionProvider.nativeLimits.availableCredits, maxConcurrentRunners: maxConcurrency },
					runnerPressure: { activeRunners: 0, maxConcurrentRunners: maxConcurrency }, constraints: { isolated: true }, metadata: { agentLab: true, runId: input.runId },
				});
				sessionId = text(availability.payload.id);
				grantId = `agent-lab:${input.runId}:grant`;
				await client.createCapacityGrant(scope.teamId, {
				schemaVersion: 2, id: grantId, membershipId: provider.membershipId, providerId: provider.providerId,
				projectId: scope.projectId, environment: 'local', status: 'planned', executionProviderIds: ['codex'], laneIds: [],
				capabilities, allowedModes: input.config.workdays.some((entry) => !entry.planningOnly) ? ['planning', 'acting'] : ['planning'], dailyCreditLimit: 10_000, monthlyCreditLimit: 10_000,
				maxConcurrentAssignments: maxConcurrency, metadata: { agentLab: true, runId: input.runId },
				}, `agent-lab:${input.runId}:grant-create`);
				await client.transitionCapacityGrant(scope.teamId, grantId, 'activate', `agent-lab:${input.runId}:grant-activate`);
				const allocationId = `agent-lab:${input.runId}:allocation`;
				allocation = (await client.createCapacityAllocationSet(scope.teamId, {
				id: allocationId, effectiveFrom: new Date(Date.now() - 1_000).toISOString(),
				effectiveUntil: new Date(Date.now() + input.config.workdays.reduce((sum, day) => sum + day.durationSeconds, 0) * 1_000 + 600_000).toISOString(),
				reservePolicy: { percent: 0, overflow: 'deny' }, borrowingRules: [],
				slices: [{ id: `${allocationId}:market`, scope: 'project', targetId: scope.projectId, policy: { minPercent: 0, targetPercent: 100, maxPercent: 100, hardCapPercent: 100 } }],
				metadata: { agentLab: true, runId: input.runId },
				}, `agent-lab:${input.runId}:allocation-create`)).payload;
				await client.supersedeCapacityAllocationSet(scope.teamId, text(allocation.id), { expectedActiveAllocationSetId: null }, `agent-lab:${input.runId}:allocation-activate`);
				availability = await protocol.refreshAvailabilitySession(sessionId, {
				expectedSequence: availability.payload.sequence, environment: 'local', status: 'open', capabilities,
				grants: [{ grantId, projectId: scope.projectId, teamId: scope.teamId, grantScope: 'project' }], executionProviders: [executionProvider],
				nativeLimits: { availableCredits: executionProvider.nativeLimits.availableCredits, maxConcurrentRunners: maxConcurrency },
				runnerPressure: { activeRunners: 0, maxConcurrentRunners: maxConcurrency }, constraints: { isolated: true }, metadata: { agentLab: true, runId: input.runId },
				});
			}
			snapshot = {
				...snapshot, team: { id: scope.teamId, name: teamName || scope.teamId, isolation: persistentTeam ? 'team' : 'ephemeral' },
				provider: { id: provider.providerId, membershipId: provider.membershipId, executionProviderId: 'codex', status: 'available' },
				repositories: [{ slug: 'market', projectId: scope.projectId, repositoryId, ref: [...selections.values()][0]?.resolvedRef ?? null }],
				agents: [...new Map([...selections.values()].flatMap((entry) => entry.agentDefinitions).map((agent) => [agent.id, agent])).values()],
			}; await publish();
			let providerSequence = Number(availability?.payload.sequence ?? 0);
			for (const config of input.config.workdays) {
				const selection = selections.get(config.id)!;
				const expectedProfiles = selection.agentDefinitions.flatMap((agent) => agent.activityProfiles
					.filter((profile) => profile.enabled && (!config.planningOnly || profile.activityType !== 'acting'))
					.map((profile) => `${agent.id}:${profile.activityType}`));
				const workdayRunId = `agent-lab:${input.runId}:${config.id}`;
				await seedAgentLabPlanningProfileInputs({
					client, projectId: scope.projectId, runId: input.runId, workdayId: config.id,
					resolvedRef: selection.resolvedRef, tests: selection.normalizedTests,
					profileInputs: config.profileInputs,
					agentClassIds: selection.agentClassIds, selectedAgents: selection.agentSlugs,
				});
				await client.createWorkdayRun(scope.teamId, {
					id: workdayRunId, capacityProviderId: provider.providerId, environment: 'local', status: 'running',
					parameters: {
						projects: [scope.projectSlug], durationSeconds: config.durationSeconds, allocationSetId: allocation.id,
						availableCredits: config.availableCredits, maxActiveAssignments: config.maxActiveAssignments,
						planningOnly: config.planningOnly, agentSelection: { agentSlugs: selection.agentSlugs, mode: 'intersection' },
						objectiveRefs: config.objectiveRefs,
						agentLab: { sceneId: input.sceneId, runId: input.runId, scope: input.config.scope.kind, initiatingUser, tests: selection.normalizedTests, resolvedRef: selection.resolvedRef, reportLocation: input.reportPath },
					},
				});
				let day = { ...snapshot.workdays.find((entry) => entry.id === config.id)!, workdayRunId, status: 'running' as const, startedAt: new Date().toISOString() };
				snapshot = replaceDay(snapshot, day); await publish();
				const activityController = new AbortController();
				let semanticRefreshTimer: ReturnType<typeof setTimeout> | null = null;
				let semanticRefreshPending = false;
				let semanticRefreshInFlight = false;
				let semanticRefreshQueue = Promise.resolve();
				const refreshSemanticEvidence = () => {
					semanticRefreshPending = true;
					if (semanticRefreshTimer || semanticRefreshInFlight) return;
					semanticRefreshTimer = setTimeout(() => {
						semanticRefreshTimer = null;
						semanticRefreshPending = false;
						semanticRefreshInFlight = true;
						semanticRefreshQueue = (async () => {
							const assignments = await readAgentLabAssignments({ client, teamId: scope!.teamId, workdayRunId });
							const providerExecutions = await readAgentLabProviderExecutions({
								client, teamId: scope!.teamId,
								assignmentIds: new Set(assignments.map((entry) => text(entry.id))),
							});
							const durableWorkdayId = assignments.map((assignment) => text(record(assignment.capacityEnvelope ?? assignment.capacity_envelope_json).workDayId)).find(Boolean);
							const accounting = durableWorkdayId
								? await readAgentLabAccounting(client, durableWorkdayId).catch((error) => ({ collectionError: error instanceof Error ? error.message : String(error) }))
								: { collectionError: 'No durable capacity workday identity is available yet.' };
							const executions = applyAgentLabAccounting(await collectAgentLabExecutions(client, day.activity, assignments), accounting);
							day = { ...day, assignments, providerExecutions, accounting, executions };
							snapshot = replaceDay(snapshot, day); void publish();
						})().catch((error) => {
							day = withDiagnostic(day, error, 'Semantic refresh: ');
						}).finally(() => {
							semanticRefreshInFlight = false;
							if (semanticRefreshPending) refreshSemanticEvidence();
						});
					}, 2_000);
				};
				const activityStream = followAgentLabActivity({
					client, teamId: scope.teamId, workdayRunId, signal: activityController.signal,
					onEvent: async (event) => {
						const byId = new Map(day.activity.map((entry) => [entry.id, entry])); byId.set(event.id, event);
						day = { ...day, activity: [...byId.values()].sort((left, right) => left.sequence - right.sequence) };
						if (event.assignmentId) refreshSemanticEvidence();
						snapshot = replaceDay(snapshot, day); void publish();
					},
				}).catch((error) => {
					if (!activityController.signal.aborted) day = withDiagnostic(day, error, 'Activity stream: ');
				});
				const deadline = Date.now() + config.durationSeconds * 1_000;
				let iteration = 0;
				const verifiedAssignments = new Set<string>();
				try { while (Date.now() < deadline && !TERMINAL.has(day.status)) {
					await client.tickWorkdayRun(scope.teamId, workdayRunId, { idempotencyKey: `agent-lab:${input.runId}:${config.id}:tick:${iteration}` });
					try {
						if (persistentTeam) {
							await new Promise((resolve) => setTimeout(resolve, 1_000));
						} else {
						const execution = await options.assignmentExecutor({
							runId: `${input.runId}-${config.id}-${iteration}`, apiUrl: api.apiUrl, teamId: scope.teamId, projectId: scope.projectId,
							providerId: provider.providerId, membershipId: provider.membershipId, credentialId: provider.credentialId,
							membershipCredential: provider.membershipCredential, providerAccessToken: provider.providerAccessToken,
							providerSessionId: sessionId, providerSessionSequence: providerSequence, privateJwk: provider.privateJwk,
							assignmentId: null, expectedAssignmentCount: Math.min(2, config.maxActiveAssignments),
							maxConcurrentRunners: Math.min(2, config.maxActiveAssignments), executionProviderId: 'codex', capabilities,
						});
						providerSequence = Number(execution.providerSessionSequence ?? providerSequence);
						for (const assignmentId of [...new Set([execution.assignmentId, ...(execution.assignmentIds ?? [])].filter(Boolean))]) {
							await verifyAgentLabTerminal({ adminClient: client, teamId: scope.teamId, projectId: scope.projectId, assignmentId });
							verifiedAssignments.add(assignmentId);
						}
						}
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						const idle = message.startsWith('Provider manager did not create the expected durable dispatch:');
						if (!idle) day = withDiagnostic(day, message);
						if (!idle && Date.now() + 2_000 >= deadline) throw error;
						await new Promise((resolve) => setTimeout(resolve, 1_000));
					}
					day = await refreshWorkdayReliably({ client, teamId: scope.teamId, projectId: scope.projectId, repositoryId, day, expectedAgents: selection.agentSlugs, expectedProfiles, verifiedAssignments });
					for (const completed of day.assignments.filter((entry) => text(entry.status) === 'completed')) {
						const assignmentId = text(completed.id);
						if (!assignmentId || verifiedAssignments.has(assignmentId)) continue;
						try {
							await verifyAgentLabTerminal({ adminClient: client, teamId: scope.teamId, projectId: scope.projectId, assignmentId });
							verifiedAssignments.add(assignmentId);
						} catch (error) {
							day = withDiagnostic(day, error, `Terminal verification ${assignmentId}: `);
						}
					}
					day = { ...day, assertions: assertionsFor(day, selection.agentSlugs, expectedProfiles, verifiedAssignments) };
					const terminalProfileFailure = day.assignments.find((entry) => ['failed', 'cancelled'].includes(text(entry.status))
							&& expectedProfiles.includes(`${text(entry.agentId)}:${text(entry.activityType ?? entry.mode)}`));
					const completedProfiles = new Set(day.executions.filter((entry) => entry.status === 'completed' && verifiedAssignments.has(entry.assignmentId)).map((entry) => `${entry.agentId}:${entry.activityType}`));
					const coverageComplete = expectedProfiles.every((profile) => completedProfiles.has(profile));
					if (terminalProfileFailure || coverageComplete) {
						await client.updateWorkdayRun(scope.teamId, workdayRunId, {
							status: terminalProfileFailure ? 'failed' : 'completed',
							summary: {
								agentLab: true,
								profileCoverageComplete: coverageComplete,
								...(terminalProfileFailure ? { failedAssignmentId: text(record(terminalProfileFailure).assignmentId ?? record(terminalProfileFailure).id) } : {}),
							},
						});
						day = await refreshWorkdayReliably({ client, teamId: scope.teamId, projectId: scope.projectId, repositoryId, day, expectedAgents: selection.agentSlugs, expectedProfiles, verifiedAssignments });
					}
					snapshot = replaceDay(snapshot, day); await publish(); iteration += 1;
				} } finally {
					if (semanticRefreshTimer) clearTimeout(semanticRefreshTimer);
					semanticRefreshTimer = null; semanticRefreshPending = false;
					activityController.abort(); await activityStream; await semanticRefreshQueue;
				}
				if (!TERMINAL.has(day.status)) await client.updateWorkdayRun(scope.teamId, workdayRunId, { status: 'failed', summary: { agentLab: true, durationElapsed: Date.now() >= deadline, profileCoverageComplete: false } });
				day = await refreshWorkdayReliably({ client, teamId: scope.teamId, projectId: scope.projectId, repositoryId, day, expectedAgents: selection.agentSlugs, expectedProfiles, verifiedAssignments });
				const failedAssertion = day.assertions.some((entry) => entry.status !== 'passed');
				day = { ...day, status: failedAssertion ? 'degraded' : day.status, diagnostics: failedAssertion ? [...day.diagnostics, 'One or more production-path assertions lacked durable evidence.'] : day.diagnostics };
				snapshot = replaceDay(snapshot, day); await publish();
			}
			snapshot = { ...snapshot, status: snapshot.workdays.some((day) => day.status === 'failed' || day.status === 'degraded') ? 'failed' : 'completed' };
		} catch (error) {
			snapshot = { ...snapshot, status: 'failed', diagnostics: [...snapshot.diagnostics, error instanceof Error ? error.message : String(error)] };
			throw error;
		} finally {
			snapshot = { ...snapshot, cleanup: { ...snapshot.cleanup, status: 'running' }, generatedAt: new Date().toISOString() }; await publish();
			const cleanup = async (label: string, operation: (() => Promise<unknown>) | null) => {
				if (!operation) return;
				try { await operation(); } catch (error) {
					const message = `${label}: ${error instanceof Error ? error.message : String(error)}`;
					snapshot.cleanup.diagnostics.push(message); cleanupError = cleanupError ?? error;
				}
			};
			await cleanup('close availability session', !persistentTeam && provider && protocol && sessionId ? () => closeCapacityAcceptanceAvailabilitySession({
				apiUrl: api.apiUrl, runId: input.runId, sessionId, fetchImpl, providerClient: protocol!, provisionedRuntime: provider,
			}) : null);
			await cleanup('revoke project grant', !persistentTeam && grantId && scope ? () => client.transitionCapacityGrant(scope!.teamId, grantId, 'revoke', `agent-lab:${input.runId}:grant-revoke`) : null);
			await cleanup('revoke provider membership', !persistentTeam && provider ? provider.cleanup : null);
			await cleanup('remove isolated team and projects', !persistentTeam && scope ? scope.cleanup : null);
			snapshot = { ...snapshot, cleanup: { ...snapshot.cleanup, status: cleanupError ? 'failed' : 'completed' }, generatedAt: new Date().toISOString() };
			if (cleanupError) snapshot = { ...snapshot, status: 'failed' };
			await publish();
		}
		return sanitizeAgentLabSnapshot(snapshot);
	};
}
