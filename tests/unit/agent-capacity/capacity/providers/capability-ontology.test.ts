import { describe, expect, it } from 'vitest';
import { validateCapabilityOfferQualification as qualify } from '../../../../../src/capacity-provider/contracts/index.ts';
import {
	CORE_CAPABILITY_DEFINITIONS,
	capabilityDemandDigest,
	capabilityDemandSchema,
	capabilityOfferDigest,
	capabilityOfferSchema,
	negotiateCapabilityOffer,
	semverSatisfies,
	validateCapacityProviderManifestV5,
	type CapacityProviderManifestV5,
} from '../../../../../src/capacity-provider/index.ts';

describe('capability ontology contracts', () => {
	it('requires current unique qualification at the declared core tier before advertising any unchanged provider offer', () => {
		const definition = CORE_CAPABILITY_DEFINITIONS.find(value => value.id === 'treeseed.engineering.release');
		if (!definition) throw new Error('Original automated qualification definition required');
		const reference = { id: definition.id, version: definition.version, digest: definition.digest }, digest = `sha256:${'a'.repeat(64)}`;
		const material = { schemaVersion: 'treeseed.capability-offer/v2' as const, offerId: 'qualified-offer', capabilities: [reference],
			features: [], configurationSupport: {}, permissionClasses: [], contextModes: [], inputContracts: [], outputContracts: [], interactionModes: [],
			conformance: [{ schemaVersion: 'treeseed.capability-conformance/v1' as const, providerId: 'provider', capability: reference,
				tier: definition.qualificationTier, status: 'passed' as const, evidenceDigest: digest, suite: { id: 'supplied-suite', version: '1.0.0' },
				issuedAt: '2020-01-01T00:00:00.000Z', expiresAt: null, signature: { keyId: 'provider-key', algorithm: 'Ed25519' as const, value: 'supplied-signature' } }],
			contextCapacity: { mode: 'bounded' as const, measurement: 'bytes' as const, defaultInitial: 100, maximum: 1000, reservedOutput: 0,
				transportPayloadBytes: 1000, measurementProvenance: { provider: 'provider', implementation: 'utf8-byte-length', version: '1' } },
			limits: {}, commercial: { currency: null, estimatedCost: null }, region: null, trust: [] };
		const manifest: CapacityProviderManifestV5 = {
			schemaVersion: 5, ownership: { type: 'external' }, configuration: { generation: 'controlled-current-input' },
			identity: { privateKeyRef: 'data://identity.json', displayName: 'Renamed provider' }, ontology: { generation: 1, digest },
			capacity: { maxConcurrentWorkers: 1 }, credentialProfiles: [], connections: [],
			lanes: (['communication', 'platform', 'workday'] as const).map((purpose, index) => ({ id: purpose, purpose, priority: 100 - index,
				reservedConcurrentWorkers: index === 0 ? 1 : 0, maxConcurrentWorkers: 1, borrowWhenIdle: true, lendWhenIdle: true,
				reclaimPolicy: 'admission', queueLimit: 1, timeoutSeconds: 1 })),
			sandbox: { required: true, brokerSocket: '/run/treeseed/sandbox/broker.sock', runtime: 'kata-runtime-rs-qemu', profiles: [{
				id: 'isolated', guestImage: 'controlled/guest', guestImageDigest: digest, defaultDenyNetwork: true,
				resources: { cpuCores: 1, memoryBytes: 1024, diskBytes: 1024, processLimit: 1, outputBytes: 1024 },
				lineage: { baseImageDigest: digest, provenanceDigest: digest, architectures: ['amd64'],
					signature: { keyId: 'provider-key', algorithm: 'Ed25519', value: 'supplied-lineage' } } }] },
			adapters: [{ id: 'renamed-executor', adapter: 'configured-executor', isolation: 'microvm', laneIds: ['workday'], maxConcurrentWorkers: 1,
				nativeLimits: { modelConfigurationId: 'configured-model', dailyActiveSecondsLimit: 0,
					capabilityLimits: { [definition.id]: { dailyActiveSecondsLimit: 0 } } },
				offers: [{ sandboxProfileId: 'isolated', offer: { ...material, offerDigest: capabilityOfferDigest(material) } }] }],
		};
		const original = structuredClone(manifest);
		expect(validateCapacityProviderManifestV5(manifest)).toEqual({ ok: true, diagnostics: [] });
		expect(qualify).toBeTypeOf('function');
		const offer = manifest.adapters[0]!.offers[0]!.offer;
		expect(qualify(offer, { providerId: 'provider' })).toEqual({ ok: true, diagnostics: [] });
		for (const providerId of ['', 'foreign-provider']) expect(qualify(offer, { providerId }).ok, providerId).toBe(false);
		for (const changed of [undefined, null, {}, [], { ...offer, offerDigest: `sha256:${'0'.repeat(64)}` }]) {
			const before = structuredClone(changed); expect(qualify(changed).ok).toBe(false); expect(changed).toEqual(before);
		}
		for (const mode of ['missing', 'duplicate', 'downgraded', 'missing-suite', 'future', 'expired', 'reverse-clock',
			'failed', 'revoked', 'foreign-reference', 'extra-receipt', 'malformed-evidence', 'malformed-issued', 'malformed-expiry']) {
			const changed = structuredClone(manifest), offer = changed.adapters[0]!.offers[0]!.offer, receipt = offer.conformance[0]!;
			if (mode === 'missing') offer.conformance = [];
			if (mode === 'duplicate') offer.conformance.push(structuredClone(receipt));
			if (mode === 'downgraded') { receipt.tier = 'signed-attestation'; receipt.suite = null; }
			if (mode === 'missing-suite') receipt.suite = null;
			if (mode === 'future') receipt.issuedAt = '9999-01-01T00:00:00.000Z';
			if (mode === 'expired') receipt.expiresAt = '2020-01-01T00:00:01.000Z';
			if (mode === 'reverse-clock') receipt.expiresAt = '2019-12-31T23:59:59.000Z';
			if (mode === 'failed' || mode === 'revoked') receipt.status = mode;
			if (mode === 'foreign-reference') receipt.capability = { ...receipt.capability, digest: `sha256:${'b'.repeat(64)}` };
			if (mode === 'extra-receipt') offer.conformance.push({ ...structuredClone(receipt), capability: { ...receipt.capability, id: 'treeseed.engineering.operations' } });
			if (mode === 'malformed-evidence') receipt.evidenceDigest = 'not-a-digest';
			if (mode === 'malformed-issued') receipt.issuedAt = 'not-a-clock';
			if (mode === 'malformed-expiry') receipt.expiresAt = 'not-a-clock';
			const { offerDigest: ignored, ...changedMaterial } = offer; offer.offerDigest = capabilityOfferDigest(changedMaterial);
			const before = structuredClone(changed), outcome = validateCapacityProviderManifestV5(changed);
			expect(outcome.ok, mode).toBe(false);
			expect(qualify(offer).ok, `shared:${mode}`).toBe(false);
			expect(outcome.diagnostics, mode).toContainEqual(expect.objectContaining({
				code: mode === 'failed' || mode === 'revoked' ? 'provider_offer_conformance_failed' : 'provider_offer_conformance_invalid',
				path: 'adapters[0].offers[0].offer.conformance' }));
			expect(changed).toEqual(before);
		}
		expect(manifest).toEqual(original);
		expect(validateCapacityProviderManifestV5(manifest)).toEqual({ ok: true, diagnostics: [] });
		// Supplied signatures/suites are validator inputs, not cryptographic or
		// executed-suite proof. Native publication belongs to the Agent boundary.
	});
	it('seeds every service family with immutable exact definitions', () => {
		expect(new Set(CORE_CAPABILITY_DEFINITIONS.map(({ family }) => family))).toEqual(new Set(['coordination', 'research', 'data', 'engineering', 'publishing', 'external-work']));
		expect(CORE_CAPABILITY_DEFINITIONS.every(({ id, digest }) => id.startsWith('treeseed.') && /^sha256:[a-f0-9]{64}$/u.test(digest))).toBe(true);
	});

	it('supports normal semantic-version ranges', () => {
		expect(semverSatisfies('1.4.2', '>=1.2.0 <2.0.0')).toBe(true);
		expect(semverSatisfies('2.0.0', '^1.2.0')).toBe(false);
	});

	it('never negotiates away required permissions or configuration', () => {
		const capability = CORE_CAPABILITY_DEFINITIONS.find(({ id }) => id === 'treeseed.coordination.conversation')!;
		const demandMaterial = { schemaVersion: 'treeseed.capability-demand/v1' as const, ontologyGeneration: 1,
			requirements: [{ capabilityId: capability.id, versionRange: '^1.0.0', requirement: 'required' as const, alternativeGroup: null, requiredFeatures: [], configuration: { 'tools.policy': { value: 'assignment', requirement: 'required' as const } } }],
			resolved: [{ id: capability.id, version: capability.version, digest: capability.digest }], permissionClasses: ['tool-policy'], contextModes: ['manifest'], inputContracts: [], outputContracts: [] };
		const demand = capabilityDemandSchema.parse({ ...demandMaterial, demandDigest: capabilityDemandDigest(demandMaterial) });
		const offerMaterial = { schemaVersion: 'treeseed.capability-offer/v2' as const, offerId: 'offer-1', capabilities: demand.resolved,
			features: [], configurationSupport: {}, permissionClasses: [], contextModes: ['manifest'], inputContracts: [], outputContracts: [], interactionModes: ['asynchronous'],
			conformance: [{ schemaVersion: 'treeseed.capability-conformance/v1' as const, providerId: 'provider-1', capability: demand.resolved[0]!, tier: 'signed-attestation' as const, status: 'passed' as const,
				evidenceDigest: `sha256:${'a'.repeat(64)}`, suite: null, issuedAt: '2026-08-29T00:00:00.000Z', expiresAt: null, signature: { keyId: 'provider-key', algorithm: 'Ed25519' as const, value: 'signed' } }],
			contextCapacity: { mode: 'bounded' as const, measurement: 'tokens' as const, defaultInitial: 32_000, maximum: 128_000, reservedOutput: 8_000,
				transportPayloadBytes: 4_194_304, measurementProvenance: { provider: 'openai', implementation: 'provider-reported-tokenizer', version: null } },
			limits: {}, commercial: { currency: 'USD', estimatedCost: 1 }, region: null, trust: [] };
		const offer = capabilityOfferSchema.parse({ ...offerMaterial, offerDigest: capabilityOfferDigest(offerMaterial) });
		expect(negotiateCapabilityOffer(demand, offer)).toMatchObject({ eligible: false, reasons: ['missing_permission_support:tool-policy', 'missing_required_capability:treeseed.coordination.conversation'] });
	});
});
