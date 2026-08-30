import { validateResearchSourcePolicy } from '../agent-capacity/validation/research/source-policy.ts';
import {
CAPACITY_PROVIDER_ACCESS_TOKEN_REFRESH_SECONDS,
CAPACITY_PROVIDER_ACCESS_TOKEN_TTL_SECONDS,
CAPACITY_PROVIDER_PROOF_TTL_SECONDS,
type CapacityProviderManifestV3,
type CapacityProviderManifestV4,
type CapacityProviderManifestV5,
type CapacityProviderProofPayload,
type CapacityProviderPublicJwk,
type ProviderSupplyOffer,
} from './contracts/index.ts';
import { validateExecutionProviderRuntimeConfiguration } from '../ai-appliance/validation.ts';

export interface CapacityProviderContractDiagnostic {
	code: string;
	path: string;
	message: string;
}

export interface CapacityProviderContractValidation {
	ok: boolean;
	diagnostics: CapacityProviderContractDiagnostic[];
}

export function result(diagnostics: CapacityProviderContractDiagnostic[]): CapacityProviderContractValidation {
	return { ok: diagnostics.length === 0, diagnostics };
}

export function add(diagnostics: CapacityProviderContractDiagnostic[], code: string, path: string, message: string) {
	diagnostics.push({ code, path, message });
}

export function nonEmpty(value: unknown): value is string {
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

export function validateCapacityProviderManifestV3(manifest: CapacityProviderManifestV3): CapacityProviderContractValidation {
	const diagnostics: CapacityProviderContractDiagnostic[] = [];
	if (manifest?.schemaVersion !== 3) add(diagnostics, 'provider_manifest_schema_invalid', 'schemaVersion', 'Capacity provider manifest schemaVersion must be 3.');
	if ('providerClass' in (manifest as unknown as Record<string, unknown>)) add(diagnostics, 'provider_manifest_legacy_class_forbidden', 'providerClass', 'Provider classes are not part of the unified battery contract.');
	if (!['team', 'external'].includes(manifest?.ownership?.type)) add(diagnostics, 'provider_manifest_ownership_invalid', 'ownership.type', 'ownership.type must be team or external.');
	if (manifest?.ownership?.type === 'team' && !nonEmpty(manifest.ownership.teamId)) add(diagnostics, 'provider_manifest_owner_team_required', 'ownership.teamId', 'Team-owned providers require ownership.teamId.');
	if (!nonEmpty(manifest?.configuration?.generation)) add(diagnostics, 'provider_manifest_generation_required', 'configuration.generation', 'An immutable desired configuration generation is required.');
	if (!nonEmpty(manifest?.identity?.privateKeyRef) || !manifest.identity.privateKeyRef.includes('://')) add(diagnostics, 'provider_manifest_identity_ref_invalid', 'identity.privateKeyRef', 'Provider identity must use an encrypted secret reference.');
	if (!nonEmpty(manifest?.identity?.displayName)) add(diagnostics, 'provider_manifest_identity_name_required', 'identity.displayName', 'Provider identity displayName is required.');
	if (!Number.isInteger(manifest?.capacity?.maxConcurrentWorkers) || manifest.capacity.maxConcurrentWorkers < 1) add(diagnostics, 'provider_manifest_concurrency_invalid', 'capacity.maxConcurrentWorkers', 'Provider worker concurrency must be a positive integer.');
	for (const field of ['cpuCores', 'memoryBytes'] as const) {
		const value = manifest?.capacity?.[field];
		if (value !== undefined && (!Number.isFinite(value) || value <= 0)) add(diagnostics, 'provider_manifest_resource_capacity_invalid', `capacity.${field}`, `${field} must be greater than zero when configured.`);
	}
	for (const [index, accelerator] of (manifest?.capacity?.accelerators ?? []).entries()) {
		if (!nonEmpty(accelerator.kind)) add(diagnostics, 'provider_manifest_accelerator_kind_required', `capacity.accelerators[${index}].kind`, 'Accelerator kind is required.');
		if (!Number.isInteger(accelerator.count) || accelerator.count < 1) add(diagnostics, 'provider_manifest_accelerator_count_invalid', `capacity.accelerators[${index}].count`, 'Accelerator count must be a positive integer.');
	}
	for (const field of ['maxActiveSeconds', 'maxInputTokens', 'maxOutputTokens', 'maxCost', 'maxAttempts'] as const) {
		const value = manifest?.capacity?.[field];
		if (value !== undefined && (!Number.isFinite(value) || value <= 0)) add(diagnostics, 'provider_manifest_supply_ceiling_invalid', `capacity.${field}`, `${field} must be greater than zero when configured.`);
	}
	if (manifest?.capacity?.maxCost !== undefined && !nonEmpty(manifest.capacity.currency)) add(diagnostics, 'provider_manifest_supply_currency_required', 'capacity.currency', 'A currency is required when maxCost is configured.');
	const bindingIds = new Set<string>();
	for (const [index, binding] of (manifest?.credentialProfiles ?? []).entries()) {
		const path = `credentialProfiles[${index}]`;
		if (!nonEmpty(binding.id) || bindingIds.has(binding.id)) add(diagnostics, 'provider_manifest_credential_binding_id_invalid', `${path}.id`, 'Credential binding IDs must be non-empty and unique.');
		bindingIds.add(binding.id);
		if (!['service-vault', 'process-environment'].includes(binding.source)) add(diagnostics, 'provider_manifest_credential_binding_source_invalid', `${path}.source`, 'Credential bindings must use service-vault or process-environment.');
		if (!nonEmpty(binding.reference)) add(diagnostics, 'provider_manifest_credential_binding_reference_required', `${path}.reference`, 'Credential binding reference is required.');
		if (binding.source === 'process-environment' && !/^TREESEED_[A-Z0-9_]+$/u.test(binding.reference)) add(diagnostics, 'provider_manifest_credential_environment_invalid', `${path}.reference`, 'Process-environment bindings must name a TREESEED_* variable.');
	}
	if (!Array.isArray(manifest?.lanes) || manifest.lanes.length === 0) add(diagnostics, 'provider_manifest_lanes_required', 'lanes', 'At least one provider lane is required.');
	const laneIds = new Set<string>();
	let reservedWorkers = 0;
	const purposes = new Set<string>();
	for (const [laneIndex, lane] of (manifest?.lanes ?? []).entries()) {
		const lanePath = `lanes[${laneIndex}]`;
		if (!nonEmpty(lane.id) || laneIds.has(lane.id)) add(diagnostics, 'provider_lane_id_invalid', `${lanePath}.id`, 'Provider lane id must be non-empty and provider-global unique.');
		laneIds.add(lane.id);
		purposes.add(lane.purpose);
		if (!['communication', 'platform', 'workday'].includes(lane.purpose)) add(diagnostics, 'provider_lane_purpose_invalid', `${lanePath}.purpose`, 'Provider lane purpose must be communication, platform, or workday.');
		if (!Number.isInteger(lane.priority) || lane.priority < 1) add(diagnostics, 'provider_lane_priority_invalid', `${lanePath}.priority`, 'Provider lane priority must be a positive integer.');
		if (!Number.isInteger(lane.reservedConcurrentWorkers) || lane.reservedConcurrentWorkers < 0) add(diagnostics, 'provider_lane_reservation_invalid', `${lanePath}.reservedConcurrentWorkers`, 'Reserved workers must be a non-negative integer.');
		if (!Number.isInteger(lane.maxConcurrentWorkers) || lane.maxConcurrentWorkers < 1 || lane.maxConcurrentWorkers > manifest.capacity.maxConcurrentWorkers) add(diagnostics, 'provider_lane_concurrency_invalid', `${lanePath}.maxConcurrentWorkers`, 'Lane concurrency must be positive and no greater than provider capacity.');
		if (lane.reservedConcurrentWorkers > lane.maxConcurrentWorkers) add(diagnostics, 'provider_lane_reservation_exceeds_maximum', `${lanePath}.reservedConcurrentWorkers`, 'Lane reservation may not exceed its maximum.');
		reservedWorkers += Number.isInteger(lane.reservedConcurrentWorkers) ? lane.reservedConcurrentWorkers : 0;
		if (lane.reclaimPolicy !== 'admission') add(diagnostics, 'provider_lane_reclaim_policy_invalid', `${lanePath}.reclaimPolicy`, 'Borrowed capacity is reclaimed through admission control, never worker termination.');
		if (!Number.isInteger(lane.queueLimit) || lane.queueLimit < 0) add(diagnostics, 'provider_lane_queue_limit_invalid', `${lanePath}.queueLimit`, 'Lane queueLimit must be a non-negative integer.');
		if (!Number.isInteger(lane.timeoutSeconds) || lane.timeoutSeconds < 1) add(diagnostics, 'provider_lane_timeout_invalid', `${lanePath}.timeoutSeconds`, 'Lane timeoutSeconds must be a positive integer.');
		if (lane.capabilities && lane.capabilities.some((entry) => !nonEmpty(entry))) add(diagnostics, 'provider_lane_capabilities_invalid', `${lanePath}.capabilities`, 'Provider lane capabilities must be non-empty strings.');
		const minimumDuration = lane.minimumAssignmentDuration;
		if (minimumDuration !== undefined) {
			if (!Number.isInteger(minimumDuration.amount) || minimumDuration.amount < 1) add(diagnostics, 'provider_lane_minimum_duration_invalid', `${lanePath}.minimumAssignmentDuration.amount`, 'Minimum assignment duration amount must be a positive integer.');
			if (!['seconds', 'business-days'].includes(minimumDuration.unit)) add(diagnostics, 'provider_lane_minimum_duration_unit_invalid', `${lanePath}.minimumAssignmentDuration.unit`, 'Minimum assignment duration unit must be seconds or business-days.');
			if (minimumDuration.unit === 'business-days') {
				try { new Intl.DateTimeFormat('en', { timeZone: minimumDuration.calendar?.timeZone }).format(); }
				catch { add(diagnostics, 'provider_lane_minimum_duration_timezone_invalid', `${lanePath}.minimumAssignmentDuration.calendar.timeZone`, 'Business-day duration requires a valid IANA time zone.'); }
				const weekdays = minimumDuration.calendar?.weekdays ?? [1, 2, 3, 4, 5];
				if (!Array.isArray(weekdays) || weekdays.length === 0 || weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7) || new Set(weekdays).size !== weekdays.length) add(diagnostics, 'provider_lane_minimum_duration_weekdays_invalid', `${lanePath}.minimumAssignmentDuration.calendar.weekdays`, 'Business weekdays must be unique ISO weekday numbers from 1 through 7.');
				if ((minimumDuration.calendar?.holidayDates ?? []).some((date) => !/^\d{4}-\d{2}-\d{2}$/u.test(date))) add(diagnostics, 'provider_lane_minimum_duration_holidays_invalid', `${lanePath}.minimumAssignmentDuration.calendar.holidayDates`, 'Business-day holidays must use YYYY-MM-DD dates.');
			}
		}
	}
	if (reservedWorkers > manifest?.capacity?.maxConcurrentWorkers) add(diagnostics, 'provider_lane_reservations_exceed_capacity', 'lanes', 'Total reserved workers may not exceed provider capacity.');
	for (const purpose of ['communication', 'platform', 'workday']) if (!purposes.has(purpose)) add(diagnostics, 'provider_lane_purpose_required', 'lanes', `Unified providers require a ${purpose} lane.`);
	const communication = (manifest?.lanes ?? []).find((lane) => lane.purpose === 'communication');
	if (communication && communication.reservedConcurrentWorkers < 1) add(diagnostics, 'provider_communication_reservation_required', 'lanes', 'Communication requires at least one reserved worker.');
	if (communication && (manifest?.lanes ?? []).some((lane) => lane.purpose !== 'communication' && lane.priority >= communication.priority)) add(diagnostics, 'provider_communication_priority_invalid', 'lanes', 'Communication must have the highest lane priority.');

	if (!Array.isArray(manifest?.adapters) || manifest.adapters.length === 0) add(diagnostics, 'provider_manifest_adapters_required', 'adapters', 'At least one execution adapter is required.');
	const adapterIds = new Set<string>();
	for (const [index, adapter] of (manifest?.adapters ?? []).entries()) {
		const path = `adapters[${index}]`;
		if (!nonEmpty(adapter.id) || adapterIds.has(adapter.id)) add(diagnostics, 'provider_adapter_id_invalid', `${path}.id`, 'Adapter id must be non-empty and unique.');
		adapterIds.add(adapter.id);
		if (!nonEmpty(adapter.adapter)) add(diagnostics, 'provider_adapter_required', `${path}.adapter`, 'Adapter implementation is required.');
		if (!['process', 'worker'].includes(adapter.isolation)) add(diagnostics, 'provider_adapter_isolation_invalid', `${path}.isolation`, 'Adapter isolation must be process or worker.');
		if (!Number.isInteger(adapter.maxConcurrentWorkers) || adapter.maxConcurrentWorkers < 1 || adapter.maxConcurrentWorkers > manifest.capacity.maxConcurrentWorkers) add(diagnostics, 'provider_adapter_concurrency_invalid', `${path}.maxConcurrentWorkers`, 'Adapter concurrency must be positive and no greater than provider capacity.');
		if (!Array.isArray(adapter.laneIds) || adapter.laneIds.length === 0) add(diagnostics, 'provider_adapter_lanes_required', `${path}.laneIds`, 'Every adapter must serve at least one lane.');
		for (const laneId of adapter.laneIds ?? []) if (!laneIds.has(laneId)) add(diagnostics, 'provider_adapter_lane_unknown', `${path}.laneIds`, `Adapter references unknown lane ${laneId}.`);
		for (const bindingId of adapter.credentialProfiles ?? []) if (!bindingIds.has(bindingId)) add(diagnostics, 'provider_adapter_credential_unknown', `${path}.credentialProfiles`, `Adapter references unknown credential profile ${bindingId}.`);
		if ((adapter.laneIds ?? []).some((laneId) => (manifest.lanes ?? []).find((lane) => lane.id === laneId)?.purpose === 'platform') && adapter.isolation !== 'process') add(diagnostics, 'provider_platform_adapter_isolation_required', `${path}.isolation`, 'Platform adapters require process isolation.');
		if (!adapter.nativeLimits || typeof adapter.nativeLimits !== 'object' || Array.isArray(adapter.nativeLimits)) add(diagnostics, 'provider_adapter_limits_invalid', `${path}.nativeLimits`, 'Adapter nativeLimits must be an object.');
		for (const entry of validateExecutionProviderRuntimeConfiguration(adapter, path).diagnostics) add(diagnostics, entry.code, entry.path, entry.message);
		if (adapter.researchSourcePolicy !== undefined) for (const diagnostic of validateResearchSourcePolicy(adapter.researchSourcePolicy).diagnostics) add(diagnostics, diagnostic.code, `${path}.researchSourcePolicy.${diagnostic.path}`, diagnostic.message);
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
		if (!nonEmpty(connection.serverProfile) && !nonEmpty(connection.controlPlaneUrl)) add(diagnostics, 'provider_connection_server_required', path, 'Connection requires serverProfile or controlPlaneUrl.');
		if (connection.controlPlaneAudience !== undefined && !nonEmpty(connection.controlPlaneAudience)) add(diagnostics, 'provider_connection_control_plane_audience_invalid', `${path}.controlPlaneAudience`, 'Connection controlPlaneAudience must be a non-empty canonical control-plane URL when provided.');
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

export function validateCapacityProviderManifestV4(manifest: CapacityProviderManifestV4): CapacityProviderContractValidation {
	const compatible = { ...manifest, schemaVersion: 3,
		adapters: manifest.adapters.map((adapter) => ({ ...adapter, isolation: adapter.isolation === 'microvm' ? 'process' : adapter.isolation })) } as CapacityProviderManifestV3;
	const diagnostics = validateCapacityProviderManifestV3(compatible).diagnostics;
	if (manifest.schemaVersion !== 4) add(diagnostics, 'provider_manifest_schema_invalid', 'schemaVersion', 'Capacity provider manifest schemaVersion must be 4.');
	if (manifest.sandbox?.required !== true || manifest.sandbox?.runtime !== 'kata-runtime-rs-qemu') add(diagnostics, 'provider_sandbox_required', 'sandbox', 'Manifest v4 requires the Kata runtime-rs QEMU sandbox.');
	if (!manifest.sandbox?.brokerSocket?.startsWith('/run/treeseed/')) add(diagnostics, 'provider_sandbox_socket_invalid', 'sandbox.brokerSocket', 'Sandbox broker socket must remain under /run/treeseed.');
	const profiles = new Set((manifest.sandbox?.profiles ?? []).map((profile) => profile.id));
	for (const [index, profile] of (manifest.sandbox?.profiles ?? []).entries()) {
		if (!/^[a-z][a-z0-9._-]{0,127}$/u.test(profile.id)) add(diagnostics, 'provider_sandbox_profile_invalid', `sandbox.profiles[${index}].id`, 'Sandbox profile id must be a provider-local identifier.');
		if (profile.contract) {
			if (!/^[a-z][a-z0-9._-]{0,127}$/u.test(profile.contract.id) || !/^\d+\.\d+\.\d+$/u.test(profile.contract.version) || !/^sha256:[a-f0-9]{64}$/u.test(profile.contract.digest)) add(diagnostics, 'provider_sandbox_contract_invalid', `sandbox.profiles[${index}].contract`, 'Portable sandbox contracts require an id, exact semantic version, and immutable digest.');
			if (!Array.isArray(profile.contract.capabilities) || profile.contract.capabilities.some((capability) => !/^[a-z][a-z0-9._-]{0,127}$/u.test(capability))) add(diagnostics, 'provider_sandbox_contract_capabilities_invalid', `sandbox.profiles[${index}].contract.capabilities`, 'Sandbox contract capabilities must be portable identifiers.');
		}
		if (!/^sha256:[a-f0-9]{64}$/u.test(profile.guestImageDigest)) add(diagnostics, 'provider_sandbox_image_digest_invalid', `sandbox.profiles[${index}].guestImageDigest`, 'Guest images require an immutable SHA-256 digest.');
		if (profile.defaultDenyNetwork !== true) add(diagnostics, 'provider_sandbox_network_policy_invalid', `sandbox.profiles[${index}].defaultDenyNetwork`, 'Sandbox networking must default deny.');
	}
	for (const [index, adapter] of manifest.adapters.entries()) {
		if (adapter.isolation !== 'microvm') add(diagnostics, 'provider_v4_microvm_required', `adapters[${index}].isolation`, 'Manifest v4 adapters must use microvm isolation.');
		for (const profile of adapter.sandboxProfileIds ?? []) if (!profiles.has(profile)) add(diagnostics, 'provider_sandbox_profile_unknown', `adapters[${index}].sandboxProfileIds`, `Unknown sandbox profile ${profile}.`);
		for (const [purpose, profile] of Object.entries(adapter.defaultSandboxProfiles ?? {})) if (!profiles.has(profile)) add(diagnostics, 'provider_sandbox_default_unknown', `adapters[${index}].defaultSandboxProfiles.${purpose}`, `Unknown default sandbox profile ${profile}.`);
	}
	return result(diagnostics);
}

export function validateCapacityProviderManifestV5(manifest: CapacityProviderManifestV5): CapacityProviderContractValidation {
	const compatible = { ...manifest, schemaVersion: 4, adapters: manifest.adapters.map((adapter) => ({ ...adapter,
		capabilities: [...new Set(adapter.offers.flatMap(({ offer }) => offer.capabilities.map(({ id }) => id)))],
		sandboxProfileIds: [...new Set(adapter.offers.map(({ sandboxProfileId }) => sandboxProfileId))],
		defaultSandboxProfiles: undefined,
	})) } as unknown as CapacityProviderManifestV4;
	const diagnostics = validateCapacityProviderManifestV4(compatible).diagnostics.filter((entry) => entry.code !== 'provider_sandbox_default_unknown');
	if (manifest.schemaVersion !== 5) add(diagnostics, 'provider_manifest_schema_invalid', 'schemaVersion', 'Capacity provider manifest schemaVersion must be 5.');
	if (!Number.isInteger(manifest.ontology?.generation) || manifest.ontology.generation < 1 || !/^sha256:[a-f0-9]{64}$/u.test(manifest.ontology?.digest ?? '')) add(diagnostics, 'provider_ontology_binding_invalid', 'ontology', 'Manifest v5 requires an exact ontology generation and digest.');
	const profiles = new Set(manifest.sandbox.profiles.map(({ id }) => id)), offerIds = new Set<string>();
	for (const [profileIndex, profile] of manifest.sandbox.profiles.entries()) {
		if (!profile.lineage || !/^sha256:[a-f0-9]{64}$/u.test(profile.lineage.baseImageDigest) || !/^sha256:[a-f0-9]{64}$/u.test(profile.lineage.provenanceDigest)
			|| !profile.lineage.architectures.length || !profile.lineage.signature.value) add(diagnostics, 'provider_sandbox_lineage_required', `sandbox.profiles[${profileIndex}].lineage`, 'Manifest v5 sandbox images require signed exact sandbox-base lineage and architectures.');
	}
	for (const [adapterIndex, adapter] of manifest.adapters.entries()) {
		if (!adapter.offers.length) add(diagnostics, 'provider_adapter_offers_required', `adapters[${adapterIndex}].offers`, 'Every v5 adapter must expose at least one standardized capability offer.');
		for (const [offerIndex, binding] of adapter.offers.entries()) {
			const path = `adapters[${adapterIndex}].offers[${offerIndex}]`;
			if (offerIds.has(binding.offer.offerId)) add(diagnostics, 'provider_offer_id_duplicate', `${path}.offer.offerId`, 'Offer ids must be provider-global unique.');
			offerIds.add(binding.offer.offerId);
			if (!profiles.has(binding.sandboxProfileId)) add(diagnostics, 'provider_offer_sandbox_unknown', `${path}.sandboxProfileId`, 'Offer references an unknown provider-local sandbox profile.');
			if (binding.offer.capabilities.some((reference) => !reference.id.startsWith('treeseed.') && !reference.id.startsWith('provider.'))) add(diagnostics, 'provider_offer_capability_namespace_invalid', `${path}.offer.capabilities`, 'Offers require standardized TreeSeed or provider capability references.');
			if (binding.offer.conformance.some((entry) => entry.status !== 'passed')) add(diagnostics, 'provider_offer_conformance_failed', `${path}.offer.conformance`, 'Only passing capability conformance may be advertised.');
		}
	}
	return result(diagnostics);
}

export function capacityProviderSecurityDefaults() {
	return {
		proofTtlSeconds: CAPACITY_PROVIDER_PROOF_TTL_SECONDS,
		accessTokenTtlSeconds: CAPACITY_PROVIDER_ACCESS_TOKEN_TTL_SECONDS,
		accessTokenRefreshSeconds: CAPACITY_PROVIDER_ACCESS_TOKEN_REFRESH_SECONDS,
	};
}
