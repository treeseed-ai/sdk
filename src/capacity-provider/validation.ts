import {
	CAPACITY_PROVIDER_ACCESS_TOKEN_REFRESH_SECONDS,
	CAPACITY_PROVIDER_ACCESS_TOKEN_TTL_SECONDS,
	CAPACITY_PROVIDER_PROOF_TTL_SECONDS,
	type CapacityProviderManifestV2,
	type CapacityProviderProofPayload,
	type CapacityProviderPublicJwk,
	type ProviderSupplyOffer,
} from './contracts/index.ts';
import { validateResearchSourcePolicy } from '../agent-capacity/validation/research-source-policy.ts';

export interface CapacityProviderContractDiagnostic {
	code: string;
	path: string;
	message: string;
}

export interface CapacityProviderContractValidation {
	ok: boolean;
	diagnostics: CapacityProviderContractDiagnostic[];
}

function result(diagnostics: CapacityProviderContractDiagnostic[]): CapacityProviderContractValidation {
	return { ok: diagnostics.length === 0, diagnostics };
}

function add(diagnostics: CapacityProviderContractDiagnostic[], code: string, path: string, message: string) {
	diagnostics.push({ code, path, message });
}

function nonEmpty(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

export function validateCapacityProviderPublicJwk(jwk: CapacityProviderPublicJwk): CapacityProviderContractValidation {
	const diagnostics: CapacityProviderContractDiagnostic[] = [];
	if (jwk?.kty !== 'OKP') add(diagnostics, 'provider_jwk_kty_invalid', 'publicJwk.kty', 'Provider identity key type must be OKP.');
	if (jwk?.crv !== 'Ed25519') add(diagnostics, 'provider_jwk_curve_invalid', 'publicJwk.crv', 'Provider identity curve must be Ed25519.');
	if (!nonEmpty(jwk?.x)) add(diagnostics, 'provider_jwk_x_required', 'publicJwk.x', 'Provider public key material is required.');
	if (jwk?.alg !== undefined && jwk.alg !== 'EdDSA') add(diagnostics, 'provider_jwk_algorithm_invalid', 'publicJwk.alg', 'Provider identity algorithm must be EdDSA.');
	return result(diagnostics);
}

export function validateCapacityProviderProofPayload(
	payload: CapacityProviderProofPayload,
	options: { now?: Date; expectedMethod?: string; expectedPath?: string; expectedAudience?: string } = {},
): CapacityProviderContractValidation {
	const diagnostics: CapacityProviderContractDiagnostic[] = [];
	const now = options.now ?? new Date();
	const issuedAt = Date.parse(payload?.issuedAt);
	const expiresAt = Date.parse(payload?.expiresAt);
	if (payload?.schemaVersion !== 1) add(diagnostics, 'provider_proof_schema_invalid', 'schemaVersion', 'Provider proof schemaVersion must be 1.');
	if (payload?.algorithm !== 'Ed25519') add(diagnostics, 'provider_proof_algorithm_invalid', 'algorithm', 'Provider proof algorithm must be Ed25519.');
	for (const [path, value] of Object.entries({ providerFingerprint: payload?.providerFingerprint, method: payload?.method, path: payload?.path, bodySha256: payload?.bodySha256, audience: payload?.audience, jti: payload?.jti })) {
		if (!nonEmpty(value)) add(diagnostics, 'provider_proof_field_required', path, `${path} is required.`);
	}
	if (!Number.isInteger(payload?.identityVersion) || payload.identityVersion < 1) add(diagnostics, 'provider_proof_identity_version_invalid', 'identityVersion', 'identityVersion must be a positive integer.');
	if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
		add(diagnostics, 'provider_proof_time_invalid', 'issuedAt', 'issuedAt and expiresAt must be ISO timestamps.');
	} else {
		const duration = (expiresAt - issuedAt) / 1000;
		if (duration <= 0 || duration > CAPACITY_PROVIDER_PROOF_TTL_SECONDS) add(diagnostics, 'provider_proof_ttl_invalid', 'expiresAt', `Provider proof validity must be between 1 and ${CAPACITY_PROVIDER_PROOF_TTL_SECONDS} seconds.`);
		if (expiresAt <= now.getTime()) add(diagnostics, 'provider_proof_expired', 'expiresAt', 'Provider proof has expired.');
		if (issuedAt > now.getTime() + 60_000) add(diagnostics, 'provider_proof_issued_in_future', 'issuedAt', 'Provider proof exceeds the allowed clock skew.');
	}
	if (options.expectedMethod && payload?.method.toUpperCase() !== options.expectedMethod.toUpperCase()) add(diagnostics, 'provider_proof_method_mismatch', 'method', 'Provider proof method does not match the request.');
	if (options.expectedPath && payload?.path !== options.expectedPath) add(diagnostics, 'provider_proof_path_mismatch', 'path', 'Provider proof path does not match the request.');
	if (options.expectedAudience && payload?.audience !== options.expectedAudience) add(diagnostics, 'provider_proof_audience_mismatch', 'audience', 'Provider proof audience does not match the control plane.');
	return result(diagnostics);
}

export function validateProviderSupplyOffer(offer: ProviderSupplyOffer, path = 'offer'): CapacityProviderContractValidation {
	const diagnostics: CapacityProviderContractDiagnostic[] = [];
	if (offer.weight !== undefined && (!Number.isFinite(offer.weight) || offer.weight <= 0)) add(diagnostics, 'provider_offer_weight_invalid', `${path}.weight`, 'Offer weight must be greater than zero.');
	if (offer.sharePercent !== undefined && (!Number.isFinite(offer.sharePercent) || offer.sharePercent <= 0 || offer.sharePercent > 100)) add(diagnostics, 'provider_offer_share_invalid', `${path}.sharePercent`, 'Offer share must be greater than zero and no more than 100.');
	if (offer.weight !== undefined && offer.sharePercent !== undefined) add(diagnostics, 'provider_offer_distribution_ambiguous', path, 'Use either weight or sharePercent for one offer, not both.');
	if (offer.maxConcurrentRunners !== undefined && (!Number.isInteger(offer.maxConcurrentRunners) || offer.maxConcurrentRunners < 1)) add(diagnostics, 'provider_offer_concurrency_invalid', `${path}.maxConcurrentRunners`, 'Connection concurrency must be a positive integer.');
	if (!Array.isArray(offer.capabilities) || offer.capabilities.some((entry) => !nonEmpty(entry))) add(diagnostics, 'provider_offer_capabilities_invalid', `${path}.capabilities`, 'Offer capabilities must be non-empty strings.');
	return result(diagnostics);
}

export function validateCapacityProviderManifestV2(manifest: CapacityProviderManifestV2): CapacityProviderContractValidation {
	const diagnostics: CapacityProviderContractDiagnostic[] = [];
	if (manifest?.schemaVersion !== 2) add(diagnostics, 'provider_manifest_schema_invalid', 'schemaVersion', 'Capacity provider manifest schemaVersion must be 2.');
	if (!nonEmpty(manifest?.identity?.privateKeyRef) || !manifest.identity.privateKeyRef.includes('://')) add(diagnostics, 'provider_manifest_identity_ref_invalid', 'identity.privateKeyRef', 'Provider identity must use an encrypted secret reference.');
	if (!nonEmpty(manifest?.identity?.displayName)) add(diagnostics, 'provider_manifest_identity_name_required', 'identity.displayName', 'Provider identity displayName is required.');
	if (!Array.isArray(manifest?.executionProviders) || manifest.executionProviders.length === 0) add(diagnostics, 'provider_manifest_execution_providers_required', 'executionProviders', 'At least one execution provider is required.');
	const executionProviderIds = new Set<string>();
	const laneIds = new Set<string>();
	for (const [index, executionProvider] of (manifest?.executionProviders ?? []).entries()) {
		const path = `executionProviders[${index}]`;
		if (!nonEmpty(executionProvider.id) || executionProviderIds.has(executionProvider.id)) add(diagnostics, 'provider_execution_provider_id_invalid', `${path}.id`, 'Execution provider id must be non-empty and unique.');
		executionProviderIds.add(executionProvider.id);
		if (!nonEmpty(executionProvider.adapter)) add(diagnostics, 'provider_execution_provider_adapter_required', `${path}.adapter`, 'Execution provider adapter is required.');
		if (!executionProvider.nativeLimits || typeof executionProvider.nativeLimits !== 'object' || Array.isArray(executionProvider.nativeLimits)) add(diagnostics, 'provider_execution_provider_limits_invalid', `${path}.nativeLimits`, 'Execution provider nativeLimits must be an object.');
		if (executionProvider.researchSourcePolicy !== undefined) {
			for (const diagnostic of validateResearchSourcePolicy(executionProvider.researchSourcePolicy).diagnostics) {
				add(diagnostics, diagnostic.code, `${path}.researchSourcePolicy.${diagnostic.path}`, diagnostic.message);
			}
		}
		for (const [laneIndex, lane] of (executionProvider.lanes ?? []).entries()) {
			const lanePath = `${path}.lanes[${laneIndex}]`;
			if (!nonEmpty(lane.id) || laneIds.has(lane.id)) add(diagnostics, 'provider_lane_id_invalid', `${lanePath}.id`, 'Provider lane id must be non-empty and provider-global unique.');
			laneIds.add(lane.id);
			if (!Number.isInteger(lane.maxConcurrentRunners) || lane.maxConcurrentRunners < 1) add(diagnostics, 'provider_lane_concurrency_invalid', `${lanePath}.maxConcurrentRunners`, 'Provider lane concurrency must be a positive integer.');
			if (lane.capabilities && lane.capabilities.some((entry) => !nonEmpty(entry))) add(diagnostics, 'provider_lane_capabilities_invalid', `${lanePath}.capabilities`, 'Provider lane capabilities must be non-empty strings.');
		}
	}
	if (!Array.isArray(manifest?.connections)) add(diagnostics, 'provider_manifest_connections_required', 'connections', 'connections must be an array.');
	const ids = new Set<string>();
	const teamIds = new Set<string>();
	const membershipIds = new Set<string>();
	const providerIds = new Set<string>();
	let explicitShare = 0;
	for (const [index, connection] of (manifest?.connections ?? []).entries()) {
		const path = `connections[${index}]`;
		if ('registrationKeyRef' in (connection as unknown as Record<string, unknown>)) add(diagnostics, 'provider_connection_registration_key_forbidden', `${path}.registrationKeyRef`, 'Broadcast registration keys are one-time join input and may not be persisted in a runtime connection.');
		if (!nonEmpty(connection.id) || ids.has(connection.id)) add(diagnostics, 'provider_connection_id_invalid', `${path}.id`, 'Connection id must be non-empty and unique.');
		ids.add(connection.id);
		if (!nonEmpty(connection.marketProfile) && !nonEmpty(connection.marketUrl)) add(diagnostics, 'provider_connection_market_required', path, 'Connection requires marketProfile or marketUrl.');
		if (connection.marketAudience !== undefined && !nonEmpty(connection.marketAudience)) add(diagnostics, 'provider_connection_market_audience_invalid', `${path}.marketAudience`, 'Connection marketAudience must be a non-empty canonical control-plane URL when provided.');
		const credentialRef = connection.membershipCredentialRef;
		if (!nonEmpty(credentialRef) || !credentialRef.includes('://')) add(diagnostics, 'provider_connection_credential_ref_invalid', `${path}.membershipCredentialRef`, 'Approved connection requires a membership credential secret reference.');
		if (!nonEmpty(connection.teamId)) add(diagnostics, 'provider_connection_team_required', `${path}.teamId`, 'Approved connection requires teamId.');
		if (!nonEmpty(connection.providerId)) add(diagnostics, 'provider_connection_provider_required', `${path}.providerId`, 'Approved connection requires providerId.');
		if (!nonEmpty(connection.membershipId)) add(diagnostics, 'provider_connection_membership_required', `${path}.membershipId`, 'Approved connection requires membershipId.');
		if (nonEmpty(connection.teamId) && teamIds.has(connection.teamId)) add(diagnostics, 'provider_connection_team_duplicate', `${path}.teamId`, 'A provider manifest may contain only one connection for a team.');
		if (nonEmpty(connection.membershipId) && membershipIds.has(connection.membershipId)) add(diagnostics, 'provider_connection_membership_duplicate', `${path}.membershipId`, 'A provider membership may appear in only one connection.');
		if (nonEmpty(connection.teamId)) teamIds.add(connection.teamId);
		if (nonEmpty(connection.membershipId)) membershipIds.add(connection.membershipId);
		if (nonEmpty(connection.providerId)) providerIds.add(connection.providerId);
		if (!nonEmpty(connection.membershipCredentialId)) add(diagnostics, 'provider_connection_credential_id_required', `${path}.membershipCredentialId`, 'Approved connection requires membershipCredentialId.');
		diagnostics.push(...validateProviderSupplyOffer(connection.offer, `${path}.offer`).diagnostics);
		explicitShare += connection.offer.sharePercent ?? 0;
	}
	if (providerIds.size > 1) add(diagnostics, 'provider_connection_identity_mismatch', 'connections', 'Every connection in one provider manifest must reference the same global provider identity.');
	if (explicitShare > 100) add(diagnostics, 'provider_connection_share_exceeded', 'connections', 'Explicit connection shares may not exceed 100 percent.');
	return result(diagnostics);
}

export function capacityProviderSecurityDefaults() {
	return {
		proofTtlSeconds: CAPACITY_PROVIDER_PROOF_TTL_SECONDS,
		accessTokenTtlSeconds: CAPACITY_PROVIDER_ACCESS_TOKEN_TTL_SECONDS,
		accessTokenRefreshSeconds: CAPACITY_PROVIDER_ACCESS_TOKEN_REFRESH_SECONDS,
	};
}
