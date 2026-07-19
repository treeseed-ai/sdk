import {
	capacityProviderPublicIdentity,
	ProviderProtocolClient,
	signCapacityProviderProof,
	type CapacityProviderPrivateJwk,
} from '../capacity-provider.ts';
import { MarketClient } from '../market-client.ts';

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
	if (workdayRun && workdayRun.payload.run.status !== 'completed') throw new Error(`workday run status is ${String(workdayRun.payload.run.status)}`);
	if (openSessions.payload.items.some((entry) => entry.id === input.sessionId)) throw new Error('availability session remains open');
}
