import {
	capacityProviderPublicIdentity,
	ProviderProtocolClient,
	signCapacityProviderProof,
	type CapacityProviderPrivateJwk,
} from '../../../capacity/providers/capacity-provider.ts';
import { MarketClient } from '../../../entrypoints/clients/market-client.ts';
import { assertRevokedCapacityProviderAccess } from './live-acceptance-capacity-guards.ts';

const TERMINAL_WORKDAY_RUN_STATUSES = new Set(['completed', 'cancelled', 'failed', 'degraded']);

export function describeCapacityAcceptanceError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	if (!(error instanceof AggregateError) || error.errors.length === 0) return error.message;
	return `${error.message} [${error.errors.map(describeCapacityAcceptanceError).join('; ')}]`;
}

export async function completeCapacityAcceptanceWorkdayRun(input: {
	adminClient: MarketClient;
	teamId: string;
	workdayRunId: string;
}) {
	const observed = await input.adminClient.workdayRun(input.teamId, input.workdayRunId);
	const status = String(observed.payload.run.status ?? '');
	if (TERMINAL_WORKDAY_RUN_STATUSES.has(status)) return observed.payload.run;
	const completed = await input.adminClient.updateWorkdayRun(input.teamId, input.workdayRunId, { status: 'completed' });
	return completed.payload;
}

export async function closeCapacityAcceptanceAvailabilitySession(input: {
	apiUrl: string;
	runId: string;
	sessionId: string;
	fetchImpl: typeof fetch;
	providerClient: ProviderProtocolClient;
	provisionedRuntime: {
		privateJwk: CapacityProviderPrivateJwk;
		credentialId: string;
		membershipCredential: string;
	} | null;
}) {
	if (!input.provisionedRuntime) {
		await input.providerClient.closeAvailabilitySession(input.sessionId);
		return;
	}
	const accessKey = `capacity-acceptance:${input.runId}:cleanup-access:${Date.now()}`;
	const proof = await signCapacityProviderProof({
		privateJwk: input.provisionedRuntime.privateJwk,
		publicJwk: capacityProviderPublicIdentity(input.provisionedRuntime.privateJwk),
		method: 'POST',
		path: '/v1/provider/access-tokens',
		audience: input.apiUrl,
		body: { credentialId: input.provisionedRuntime.credentialId, idempotencyKey: accessKey },
	});
	const access = await new ProviderProtocolClient({ marketUrl: input.apiUrl, fetchImpl: input.fetchImpl })
		.issueAccessToken(
			input.provisionedRuntime.membershipCredential,
			input.provisionedRuntime.credentialId,
			proof,
			accessKey,
		);
	await new ProviderProtocolClient({
		marketUrl: input.apiUrl,
		accessToken: access.accessToken,
		fetchImpl: input.fetchImpl,
	}).closeAvailabilitySession(input.sessionId);
}

export async function verifyCapacityAcceptanceCleanup(input: {
	adminClient: MarketClient;
	teamId: string;
	membershipId: string;
	providerId: string;
	grantId: string;
	workdayId: string;
	workdayRunId: string;
	sessionId: string;
}) {
	const [membership, grant, workday, workdayRun, openSessions] = await Promise.all([
		input.adminClient.capacityProviderMembership(input.teamId, input.membershipId),
		input.grantId ? input.adminClient.capacityGrant(input.teamId, input.grantId) : Promise.resolve(null),
		input.workdayId ? input.adminClient.workday(input.workdayId) : Promise.resolve(null),
		input.workdayRunId ? input.adminClient.workdayRun(input.teamId, input.workdayRunId) : Promise.resolve(null),
		input.adminClient.providerAvailabilitySessions(input.teamId, { providerId: input.providerId, status: 'open', limit: 100 }),
	]);
	if (membership.payload.status !== 'revoked') throw new Error(`membership status is ${membership.payload.status}`);
	if (grant && grant.payload.status !== 'revoked') throw new Error(`grant status is ${String(grant.payload.status)}`);
	if (workday && workday.payload.status !== 'completed') throw new Error(`workday status is ${String(workday.payload.status)}`);
	if (workdayRun && !TERMINAL_WORKDAY_RUN_STATUSES.has(String(workdayRun.payload.run.status))) {
		throw new Error(`workday run status is ${String(workdayRun.payload.run.status)}`);
	}
	if (openSessions.payload.items.some((entry) => entry.id === input.sessionId)) throw new Error('availability session remains open');
}

export async function cleanupCapacityAssignmentProof(input: {
	adminClient: MarketClient;
	providerClient: ProviderProtocolClient;
	apiUrl: string;
	runId: string;
	teamId: string;
	membershipId: string;
	providerId: string;
	grantId: string;
	workdayId: string;
	workdayRunId: string;
	sessionId: string;
	completedAssignmentId: string;
	provisionedRuntime: {
		privateJwk: CapacityProviderPrivateJwk;
		credentialId: string;
		membershipCredential: string;
	} | null;
	cleanupCapacityCompetition: (() => Promise<unknown>) | null;
	cleanupProvisionedProvider: (() => Promise<unknown>) | null;
	cleanupGovernanceProof: (() => Promise<unknown>) | null;
	cleanupLocalScope: (() => Promise<unknown>) | null;
	assignmentError: unknown;
	fetchImpl: typeof fetch;
}) {
	const errors: string[] = [];
	const cleanup = async (label: string, operation: () => Promise<unknown>) => {
		try { await operation(); }
		catch (error) { errors.push(`${label}: ${describeCapacityAcceptanceError(error)}`); }
	};
	if (input.workdayRunId) await cleanup('complete workday run', () => completeCapacityAcceptanceWorkdayRun(input));
	if (input.workdayId) await cleanup('complete workday', () => input.adminClient.completeWorkday(input.workdayId, `capacity-acceptance:${input.runId}:workday-complete`));
	if (input.sessionId) await cleanup('close availability session', () => closeCapacityAcceptanceAvailabilitySession(input));
	if (input.grantId) await cleanup('revoke capacity grant', () => input.adminClient.transitionCapacityGrant(input.teamId, input.grantId, 'revoke', `capacity-acceptance:${input.runId}:grant-revoke`));
	if (input.cleanupCapacityCompetition) await cleanup('delete capacity competition resources', input.cleanupCapacityCompetition);
	if (input.cleanupProvisionedProvider) await cleanup('revoke provider membership', input.cleanupProvisionedProvider);
	if (input.cleanupGovernanceProof) await cleanup('delete governance acceptance team', input.cleanupGovernanceProof);
	if (input.cleanupProvisionedProvider && input.completedAssignmentId) {
		await cleanup('verify revoked provider access', () => assertRevokedCapacityProviderAccess({
			providerClient: input.providerClient,
			assignmentId: input.completedAssignmentId,
		}));
	}
	if (!errors.length && input.cleanupProvisionedProvider) {
		await cleanup('verify terminal cleanup', () => verifyCapacityAcceptanceCleanup(input));
	}
	if (input.cleanupLocalScope) await cleanup('delete isolated capacity acceptance team', input.cleanupLocalScope);
	if (!errors.length) return;
	if (input.assignmentError) {
		throw new AggregateError(
			[input.assignmentError, ...errors.map((message) => new Error(message))],
			`Capacity acceptance execution failed: ${describeCapacityAcceptanceError(input.assignmentError)}; cleanup also failed: ${errors.join('; ')}`,
		);
	}
	throw new Error(`Capacity acceptance cleanup failed: ${errors.join('; ')}`);
}
