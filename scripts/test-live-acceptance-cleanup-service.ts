import assert from 'node:assert/strict';
import { MarketClient } from '../src/market-client.ts';
import { ProviderProtocolClient } from '../src/capacity-provider.ts';
import { runTreeseedLiveReconcileTests } from '../src/reconcile/live-acceptance.ts';
import { provisionLocalCapacityAcceptanceProvider } from '../src/reconcile/live-acceptance-capacity-context.ts';
import {
	createLocalCapacityAcceptanceScope,
	isLocalCapacityAcceptanceTeam,
} from '../src/reconcile/live-acceptance-capacity-scope.ts';

const apiUrl = process.env.TREESEED_CAPACITY_ACCEPTANCE_API_URL ?? 'http://127.0.0.1:3000';
const adminToken = process.env.TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN ?? 'tsk_local_treeseed_acceptance_admin';
const runId = `cleanup${Date.now()}`;
const adminClient = new MarketClient({
	profile: {
		id: 'capacity-cleanup-service-test',
		label: 'Capacity cleanup service test',
		baseUrl: apiUrl,
		kind: 'specialized',
	},
	accessToken: adminToken,
});

const scope = await createLocalCapacityAcceptanceScope(adminClient, runId);
const provider = await provisionLocalCapacityAcceptanceProvider({
	adminClient,
	apiUrl,
	teamId: scope.teamId,
	runId,
	fetchImpl: fetch,
});
const providerClient = new ProviderProtocolClient({
	marketUrl: apiUrl,
	accessToken: provider.providerAccessToken,
});

try {
	assert.equal((await adminClient.teams()).payload.some((team) => (
		team && typeof team === 'object' && isLocalCapacityAcceptanceTeam(team as Record<string, unknown>)
	)), true);

	const cleanup = await runTreeseedLiveReconcileTests({
		cwd: process.cwd(),
		environment: 'local',
		mode: 'cleanup',
		providers: ['local'],
		runId: `${runId}-recovery`,
	});
	assert.equal(cleanup.ok, true, JSON.stringify(cleanup.providers[0], null, 2));
	assert.equal(cleanup.providers[0]?.destroyedResources.some((resource) => (
		resource.id === scope.teamId && resource.type === 'capacity-acceptance-team'
	)), true);
	assert.equal((await adminClient.teams()).payload.some((team) => (
		team && typeof team === 'object' && (team as Record<string, unknown>).id === scope.teamId
	)), false);
	await assert.rejects(providerClient.createAvailabilitySession({
		environment: 'local',
		status: 'open',
		sequence: 1,
	}), (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 401));
} finally {
	await runTreeseedLiveReconcileTests({
		cwd: process.cwd(),
		environment: 'local',
		mode: 'cleanup',
		providers: ['local'],
		runId: `${runId}-final`,
	});
}
