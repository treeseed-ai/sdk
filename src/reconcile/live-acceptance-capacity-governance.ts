import {
	CapacityProviderApiError,
	capacityProviderPublicIdentity,
	generateCapacityProviderIdentity,
	ProviderProtocolClient,
	signCapacityProviderProof,
} from '../capacity-provider.ts';
import { MarketClient } from '../market-client.ts';

export interface CapacityGovernanceAcceptanceProof {
	secondTeamId: string;
	sharedProviderMemberships: number;
	proofReplayRejected: boolean;
	reviewRaceResolvedOnce: boolean;
	registrationRotationRaceResolved: boolean;
	pendingRequestCancelledByRotation: boolean;
	approvedMembershipSurvivedRotation: boolean;
	suspendedMembershipAccessDenied: boolean;
	twoRunnableConnections: boolean;
	providerGlobalLimit: number;
	readyDispatches: number;
	localClaimsAtCapacity: number;
	deferredAssignmentRemainedPending: boolean;
}

export interface CapacityGovernanceRuntimeConnection {
	teamId: string;
	providerId: string;
	membershipId: string;
	credentialId: string;
	membershipCredential: string;
	providerAccessToken: string;
}

export interface CapacityFinalSlotAcceptanceProof {
	twoRunnableConnections: boolean;
	providerGlobalLimit: number;
	readyDispatches: number;
	localClaimsAtCapacity: number;
	deferredAssignmentRemainedPending: boolean;
}

function registrationBody(publicJwk: JsonWebKey, runId: string, purpose: string) {
	return {
		schemaVersion: 1 as const,
		displayName: `Treeseed isolated acceptance ${runId}`,
		publicJwk,
		capabilitySummary: ['planning', 'agent_mode_run', 'repo_read', 'usage_report'],
		supplyOffer: {
			weight: 1,
			maxConcurrentRunners: 1,
			capabilities: ['planning', 'agent_mode_run', 'repo_read', 'usage_report'],
		},
		metadata: { liveAcceptance: true, runId, purpose },
	};
}

async function signedRegistration(input: {
	protocol: ProviderProtocolClient;
	registrationKey: string;
	privateJwk: JsonWebKey;
	publicJwk: JsonWebKey;
	apiUrl: string;
	runId: string;
	purpose: string;
}) {
	const body = registrationBody(input.publicJwk, input.runId, input.purpose);
	const proof = await signCapacityProviderProof({
		privateJwk: input.privateJwk,
		publicJwk: input.publicJwk,
		method: 'POST',
		path: '/v1/provider-registrations',
		audience: input.apiUrl,
		body,
	});
	return {
		body,
		proof,
		submit: (idempotencyKey: string) => input.protocol.register(
			input.registrationKey,
			{ ...body, proof },
			idempotencyKey,
		),
	};
}

function expectedProviderDenial(error: unknown) {
	return error instanceof CapacityProviderApiError && (error.status === 401 || error.status === 403);
}

function expectedRotatedKeyDenial(error: unknown) {
	return error instanceof CapacityProviderApiError
		&& ['registration_key_disabled', 'registration_key_invalid'].includes(error.code);
}

export async function proveLocalCapacityGovernance(input: {
	adminClient: MarketClient;
	apiUrl: string;
	runId: string;
	primaryTeamId: string;
	primaryMembershipId: string;
	privateJwk: JsonWebKey;
	fetchImpl: typeof fetch;
}) {
	const suffix = input.runId.replace(/[^a-z0-9]/giu, '').toLowerCase().slice(-14) || 'run';
	const teamName = `capacity-live-governance-${suffix}`;
	const createdTeam = await input.adminClient.createTeam({
		name: teamName,
		displayName: `Capacity governance acceptance ${suffix}`,
		metadata: { liveAcceptance: true, runId: input.runId, purpose: 'isolated-capacity-governance' },
	});
	const secondTeamId = createdTeam.payload.id;
	if (!secondTeamId) throw new Error('Capacity governance acceptance could not resolve its durable audit team.');
	const cleanup = async () => {
		const deleted = await input.adminClient.deleteTeam(secondTeamId, `DELETE ${teamName}`);
		if (!deleted.ok) throw new Error(`Capacity governance acceptance could not delete team ${secondTeamId}: ${deleted.message ?? deleted.code ?? 'unknown error'}.`);
	};
	try {
		const protocol = new ProviderProtocolClient({
			marketUrl: input.apiUrl,
			fetchImpl: input.fetchImpl,
			userAgent: `treeseed-governance-acceptance/${input.runId}`,
		});
		const registrationKey = (await input.adminClient.revealTeamCapacityRegistrationKey(secondTeamId)).payload.registrationKey;
		const publicJwk = capacityProviderPublicIdentity(input.privateJwk);
		const shared = await signedRegistration({ ...input, protocol, registrationKey, publicJwk, purpose: 'shared-provider' });
		const sharedRequest = await shared.submit(`capacity-governance:${input.runId}:shared-register`);
		const sharedApproval = await input.adminClient.reviewCapacityProviderRegistration(
			secondTeamId,
			sharedRequest.id,
			'approve',
			`capacity-governance:${input.runId}:shared-approve`,
			{ teamAlias: `shared-${input.runId}` },
		);
		if (!sharedApproval.payload.membershipId) throw new Error('Second-team provider approval did not create a membership.');
		const sharedMembershipId = sharedApproval.payload.membershipId;
		const exchangeKey = `capacity-governance:${input.runId}:shared-exchange`;
		const exchangePath = `/v1/provider-registrations/${encodeURIComponent(sharedRequest.id)}/credential`;
		const exchangeProof = await signCapacityProviderProof({
			privateJwk: input.privateJwk,
			publicJwk,
			method: 'POST',
			path: exchangePath,
			audience: input.apiUrl,
			body: { requestId: sharedRequest.id, idempotencyKey: exchangeKey },
		});
		const credential = await protocol.exchangeCredential(sharedRequest.id, exchangeProof, exchangeKey);
		const accessKey = `capacity-governance:${input.runId}:shared-access`;
		const accessProof = await signCapacityProviderProof({
			privateJwk: input.privateJwk,
			publicJwk,
			method: 'POST',
			path: '/v1/provider/access-tokens',
			audience: input.apiUrl,
			body: { credentialId: credential.id, idempotencyKey: accessKey },
		});
		const access = await protocol.issueAccessToken(credential.credential, credential.id, accessProof, accessKey);

		const replayIdentity = generateCapacityProviderIdentity();
		const replay = await signedRegistration({
			...input,
			protocol,
			registrationKey,
			privateJwk: replayIdentity,
			publicJwk: capacityProviderPublicIdentity(replayIdentity),
			purpose: 'proof-replay',
		});
		const replayRequest = await replay.submit(`capacity-governance:${input.runId}:replay-first`);
		let proofReplayRejected = false;
		try {
			await replay.submit(`capacity-governance:${input.runId}:replay-second`);
		} catch (error) {
			proofReplayRejected = error instanceof CapacityProviderApiError && error.code === 'provider_proof_replayed';
		}
		if (!proofReplayRejected) throw new Error('Provider proof replay was not rejected with provider_proof_replayed.');

		const reviewIdentity = generateCapacityProviderIdentity();
		const review = await signedRegistration({
			...input,
			protocol,
			registrationKey,
			privateJwk: reviewIdentity,
			publicJwk: capacityProviderPublicIdentity(reviewIdentity),
			purpose: 'review-race',
		});
		const reviewRequest = await review.submit(`capacity-governance:${input.runId}:review-register`);
		const reviewResults = await Promise.allSettled([
			input.adminClient.reviewCapacityProviderRegistration(secondTeamId, reviewRequest.id, 'approve', `capacity-governance:${input.runId}:review-approve`),
			input.adminClient.reviewCapacityProviderRegistration(secondTeamId, reviewRequest.id, 'reject', `capacity-governance:${input.runId}:review-reject`, { reason: 'concurrent acceptance rejection' }),
		]);
		const reviewFinal = await input.adminClient.capacityProviderRegistrationRequest(secondTeamId, reviewRequest.id);
		const reviewRaceResolvedOnce = reviewResults.filter((entry) => entry.status === 'fulfilled').length === 1
			&& ['approved', 'rejected'].includes(reviewFinal.payload.status);
		if (!reviewRaceResolvedOnce) throw new Error('Concurrent provider approval/rejection did not resolve exactly once.');

		const racingIdentity = generateCapacityProviderIdentity();
		const racing = await signedRegistration({
			...input,
			protocol,
			registrationKey,
			privateJwk: racingIdentity,
			publicJwk: capacityProviderPublicIdentity(racingIdentity),
			purpose: 'registration-rotation-race',
		});
		const rotationResults = await Promise.allSettled([
			racing.submit(`capacity-governance:${input.runId}:rotation-race-register`),
			input.adminClient.rotateTeamCapacityRegistrationKey(secondTeamId, `capacity-governance:${input.runId}:rotate`),
		]);
		if (rotationResults[1]?.status !== 'fulfilled') throw new Error('Registration-key rotation lost its race and did not commit.');
		const pendingAfterRotation = await input.adminClient.capacityProviderRegistrationRequest(secondTeamId, replayRequest.id);
		const pendingRequestCancelledByRotation = pendingAfterRotation.payload.status === 'cancelled';
		if (!pendingRequestCancelledByRotation) throw new Error('Registration-key rotation did not cancel an old-generation pending request.');
		let registrationRotationRaceResolved = rotationResults[0]?.status === 'rejected'
			&& expectedRotatedKeyDenial(rotationResults[0].reason);
		if (rotationResults[0]?.status === 'fulfilled') {
			const raced = await input.adminClient.capacityProviderRegistrationRequest(secondTeamId, rotationResults[0].value.id);
			registrationRotationRaceResolved = raced.payload.status === 'cancelled';
		}
		if (!registrationRotationRaceResolved) throw new Error('Registration racing with key rotation remained pending or was accepted under the retired generation.');
		const approvedMembership = await input.adminClient.capacityProviderMembership(secondTeamId, sharedMembershipId);
		const approvedMembershipSurvivedRotation = approvedMembership.payload.status === 'approved';
		if (!approvedMembershipSurvivedRotation) throw new Error('Registration-key rotation changed an approved provider membership.');

		return {
			runtime: {
				teamId: secondTeamId,
				providerId: sharedRequest.providerId,
				membershipId: sharedMembershipId,
				credentialId: credential.id,
				membershipCredential: credential.credential,
				providerAccessToken: access.accessToken,
			} satisfies CapacityGovernanceRuntimeConnection,
			finalize: async (finalSlot: CapacityFinalSlotAcceptanceProof) => {
				await input.adminClient.suspendCapacityProviderMembership(secondTeamId, sharedMembershipId, `capacity-governance:${input.runId}:suspend`);
				const suspendedClient = new ProviderProtocolClient({ marketUrl: input.apiUrl, accessToken: access.accessToken, fetchImpl: input.fetchImpl });
				let suspendedMembershipAccessDenied = false;
				try {
					await suspendedClient.createAvailabilitySession({ environment: 'local', status: 'open', sequence: 1 });
				} catch (error) {
					suspendedMembershipAccessDenied = expectedProviderDenial(error);
				}
				if (!suspendedMembershipAccessDenied) throw new Error('Suspended second-team membership retained provider runtime access.');
				const primaryMembership = await input.adminClient.capacityProviderMembership(input.primaryTeamId, input.primaryMembershipId);
				if (primaryMembership.payload.status !== 'approved') throw new Error('Second-team suspension leaked into the primary provider membership.');
				return {
					secondTeamId,
					sharedProviderMemberships: 2,
					proofReplayRejected,
					reviewRaceResolvedOnce,
					registrationRotationRaceResolved,
					pendingRequestCancelledByRotation,
					approvedMembershipSurvivedRotation,
					suspendedMembershipAccessDenied,
					...finalSlot,
				} satisfies CapacityGovernanceAcceptanceProof;
			},
			cleanup,
		};
	} catch (error) {
		await cleanup().catch((cleanupError) => {
			throw new AggregateError([error, cleanupError], 'Capacity governance acceptance and temporary-team cleanup both failed.');
		});
		throw error;
	}
}
