import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TreeseedCanonicalDrift, TreeseedCanonicalGraphNode } from './platform.ts';
import type { RunTreeseedLiveReconcileTestsOptions, TreeseedLiveReconcileEnvironment, TreeseedLiveReconcileMode, TreeseedLiveReconcileScenarioResult } from './live-acceptance.ts';
import type { LiveAcceptanceEnv } from './live-acceptance-values.ts';
import { runCapacityProviderAssignmentProof } from './live-acceptance-capacity-proof.ts';
import type { CapacityAcceptanceProof } from './live-acceptance-capacity-context.ts';
import { capacityAcceptanceConfig } from './live-acceptance-capacity-context.ts';
import { deleteLocalCapacityAcceptanceTeam, isLocalCapacityAcceptanceTeam } from './live-acceptance-capacity-scope.ts';
import { MarketClient } from '../market-client.ts';
import { PROVIDER_CAPABILITIES, blocking, emitProgress, measuredScenario, node, providerNode, providerPrefixRoot, scenario } from './live-acceptance-runtime.ts';
import { cleanupLocalAcceptanceAgentWorktrees } from './live-acceptance-worktree-cleanup.ts';

type LiveProgress = RunTreeseedLiveReconcileTestsOptions['onProgress'];
type LiveEnv = LiveAcceptanceEnv;

async function listenOnEphemeralPort(server: Server) {
	return new Promise<number>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (address && typeof address === 'object') resolve(address.port);
			else reject(new Error('Local server did not expose an address.'));
		});
	});
}

async function closeServer(server: Server) {
	return new Promise<void>((resolve, reject) => {
		server.close((error) => error ? reject(error) : resolve());
	});
}

export async function runLocalAcceptance(
	environment: TreeseedLiveReconcileEnvironment,
	prefix: string,
	mode: TreeseedLiveReconcileMode,
	runId: string,
	env: LiveEnv,
	fetchImpl: typeof fetch,
	onProgress?: LiveProgress,
	capacityAssignmentExecutor?: RunTreeseedLiveReconcileTestsOptions['capacityAssignmentExecutor'],
) {
	const created: TreeseedCanonicalGraphNode[] = [];
	const destroyed: TreeseedCanonicalGraphNode[] = [];
	const tempBase = resolve(process.cwd(), '.treeseed', 'tmp', 'live-acceptance');
	await mkdir(tempBase, { recursive: true });
	const dir = await mkdtemp(join(tempBase, `${prefix}-`));
	const results: TreeseedLiveReconcileScenarioResult[] = [];
	let server: Server | null = null;
	try {
		results.push(await measuredScenario({
			provider: 'local', mode, environment, runId, prefix, capability: 'local-db', phase: 'create', action: 'create',
			startMessage: 'local:local-db: creating isolated state',
			successReason: 'Local acceptance created, wrote, read, and removed isolated local state.',
			createdResources: [node('local', environment, 'local-db', dir, { path: dir })],
			onProgress,
		}, async () => {
			const file = join(dir, 'state.json');
			await writeFile(file, JSON.stringify({ ok: true, runId }), 'utf8');
			const parsed = JSON.parse(readFileSync(file, 'utf8')) as { ok?: boolean; runId?: string };
			if (parsed.ok !== true || parsed.runId !== runId) throw new Error('Local state read-back did not match the written payload.');
			created.push(node('local', environment, 'local-db', dir, { path: dir }));
			return parsed;
		}));
		server = createServer((socket) => {
			socket.end('treeseed-live-test-local\n');
		});
		results.push(await measuredScenario({
			provider: 'local', mode, environment, runId, prefix, capability: 'port', phase: 'create', action: 'create',
			startMessage: 'local:port: binding ephemeral port',
			successReason: 'Local acceptance bound and observed an ephemeral loopback port.',
			onProgress,
		}, async () => {
			const port = await listenOnEphemeralPort(server as Server);
			if (!port) throw new Error('No local port was allocated.');
			return { port };
		}));
		results.push(await measuredScenario({
			provider: 'local', mode, environment, runId, prefix, capability: 'process', phase: 'verify', action: 'noop',
			startMessage: 'local:process: verifying current process',
			successReason: 'Local acceptance observed the current Node process as a supervised-process stand-in.',
			locators: { pid: String(process.pid) },
			onProgress,
		}, async () => {
			if (!process.pid) throw new Error('Current process id is unavailable.');
			return { pid: process.pid };
		}));
		results.push(await measuredScenario({
			provider: 'local', mode, environment, runId, prefix, capability: 'local-runner', phase: 'verify', action: 'noop',
			startMessage: 'local:local-runner: verifying runner probe',
			successReason: 'Local acceptance verified the local runner probe contract.',
			onProgress,
		}, async () => ({ runnerProbe: true, runId })));
		results.push(await measuredScenario({
			provider: 'local', mode, environment, runId, prefix, capability: 'docker-compose-capacity-provider', phase: 'verify', action: 'noop',
			startMessage: 'local:docker-compose-capacity-provider: checking Docker availability',
			successReason: (value) => (value as { docker?: string; available?: boolean }).available
				? 'Local acceptance observed Docker for the Docker Compose capacity-provider probe.'
				: 'Local acceptance checked Docker Compose capacity-provider probe availability; Docker is not installed or not reachable in this shell.',
			onProgress,
		}, async () => {
			try {
				const docker = execFileSync('docker', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
				return { docker, available: true };
			} catch (error) {
				return { docker: error instanceof Error ? error.message : String(error), available: false };
			}
		}));
		results.push(await measuredScenario({
			provider: 'local', mode, environment, runId, prefix, capability: 'capacity-provider-assignment-proof', phase: 'verify', action: 'noop',
			startMessage: 'local:capacity-provider-assignment-proof: running assignment lifecycle proof',
			successReason: 'Local capacity acceptance proved multi-team registration governance plus reconciled starter planning through the provider manager, runner, AgentKernel, TreeDX, usage, and settlement path.',
			retainedResources: (value) => {
				const proof = value as CapacityAcceptanceProof;
				return [providerNode('local', environment, 'capacity-runtime-proof', proof.assignmentId, {
					sessionId: proof.sessionId,
					modeRunId: proof.modeRunId,
					finalStatus: proof.finalStatus,
					mode: proof.mode,
					modeRunCount: proof.modeRunCount,
					artifactCount: proof.artifactCount,
					toolEventCount: proof.toolEventCount,
					usageActualCount: proof.usageActualCount,
					ledgerEntryCount: proof.ledgerEntryCount,
					starterPlanning: proof.starterPlanning,
					starterEngineering: proof.starterEngineering,
					starterConcurrency: proof.starterConcurrency,
					governance: proof.governance,
				})];
			},
			onProgress,
		}, async () => runCapacityProviderAssignmentProof({ provider: 'local', environment, runId, prefix, env, fetchImpl, capacityAssignmentExecutor })));
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		for (const capability of PROVIDER_CAPABILITIES.local) {
			if (!results.some((result) => result.capability === capability)) {
				results.push(scenario({ provider: 'local', mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason }));
			}
		}
	} finally {
		if (server) await closeServer(server).catch(() => undefined);
		await rm(dir, { recursive: true, force: true });
		destroyed.push(node('local', environment, 'local-db', dir, { deleted: true }));
	}
	return { results, cleanupDrift: [], destroyedResources: destroyed };
}

export async function runLocalCleanup(
	environment: TreeseedLiveReconcileEnvironment,
	prefix: string,
	mode: TreeseedLiveReconcileMode,
	env: LiveEnv,
	fetchImpl: typeof fetch,
	onProgress?: LiveProgress,
) {
	const tempBase = resolve(process.cwd(), '.treeseed', 'tmp', 'live-acceptance');
	const prefixRoot = providerPrefixRoot(environment, 'local');
	const destroyedResources: TreeseedCanonicalGraphNode[] = [];
	const cleanupDrift: TreeseedCanonicalDrift[] = [];
	const entries = await readdir(tempBase, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.startsWith(prefixRoot)) continue;
		const path = join(tempBase, entry.name);
		await rm(path, { recursive: true, force: true });
		destroyedResources.push(node('local', environment, 'local-db', path, { deleted: true }));
	}
	const worktreeCleanup = await cleanupLocalAcceptanceAgentWorktrees(process.cwd());
	for (const removed of worktreeCleanup.removed) {
		destroyedResources.push(node('local', environment, 'assignment-worktree', removed.worktreeRoot, {
			deleted: true,
			repository: removed.repoRoot,
		}));
	}
	for (const failure of worktreeCleanup.failures) {
		cleanupDrift.push(blocking('local', 'assignment-worktree', `Local assignment-worktree cleanup failed: ${failure}`));
	}
	const config = capacityAcceptanceConfig(env, environment);
	if (config.apiUrl && config.adminToken) {
		const adminClient = new MarketClient({
			profile: {
				id: 'capacity-acceptance-cleanup',
				label: 'Capacity Acceptance Cleanup',
				baseUrl: config.apiUrl,
				kind: 'specialized',
			},
			accessToken: config.adminToken,
			fetchImpl,
			userAgent: 'treeseed-live-acceptance-cleanup',
		});
		try {
			const teams = await adminClient.teams();
			const isolatedTeams = (teams.payload as Array<Record<string, unknown>>)
				.filter((team) => isLocalCapacityAcceptanceTeam(team));
			for (const team of isolatedTeams) {
				const id = typeof team.id === 'string' ? team.id : '';
				const name = typeof team.name === 'string' ? team.name : '';
				if (!id || !name) continue;
				await deleteLocalCapacityAcceptanceTeam(adminClient, { id, name });
				destroyedResources.push(node('local', environment, 'capacity-acceptance-team', id, {
					deleted: true,
					name,
				}));
			}
		} catch (error) {
			cleanupDrift.push(blocking(
				'local',
				'capacity-acceptance-team',
				`Local capacity control-plane cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
			));
		}
	} else {
		cleanupDrift.push(blocking(
			'local',
			'capacity-acceptance-team',
			'Local capacity control-plane cleanup requires an API URL and admin token.',
		));
	}
	const results = PROVIDER_CAPABILITIES.local.map((capability) => scenario({
		provider: 'local',
		mode,
		prefix,
		capability,
		ok: capability !== 'capacity-provider-assignment-proof' || cleanupDrift.length === 0,
		phase: 'cleanup',
		action: capability === 'local-db' && destroyedResources.length ? 'delete' : 'noop',
		reason: capability === 'capacity-provider-assignment-proof' && cleanupDrift.length > 0
			? 'Local cleanup could not prove removal of isolated capacity control-plane state.'
			: capability === 'local-db' && destroyedResources.length
			? `Local cleanup removed ${destroyedResources.length} isolated live-acceptance director${destroyedResources.length === 1 ? 'y' : 'ies'}.`
			: 'Local cleanup observed no isolated resource requiring mutation.',
		destroyedResources: capability === 'local-db' || capability === 'capacity-provider-assignment-proof'
			? destroyedResources
			: [],
		issues: capability === 'capacity-provider-assignment-proof'
			? cleanupDrift.map((entry) => entry.reason)
			: [],
	}));
	emitProgress(onProgress, {
		provider: 'local', mode, environment, runId: prefix.slice(prefixRoot.length), resourcePrefix: prefix,
		phase: cleanupDrift.length === 0 ? 'cleanup' : 'blocked',
		message: `local: cleanup removed ${destroyedResources.length} isolated resource(s) with ${cleanupDrift.length} blocking drift item(s)`,
	});
	return { results, cleanupDrift, destroyedResources };
}
