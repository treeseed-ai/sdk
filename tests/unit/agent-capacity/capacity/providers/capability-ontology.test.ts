import { describe, expect, it } from 'vitest';
import {
	CORE_CAPABILITY_DEFINITIONS,
	capabilityDemandDigest,
	capabilityDemandSchema,
	capabilityOfferDigest,
	capabilityOfferSchema,
	negotiateCapabilityOffer,
	semverSatisfies,
} from '../../../../../src/capacity-provider/index.ts';

describe('capability ontology contracts', () => {
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
		const offerMaterial = { schemaVersion: 'treeseed.capability-offer/v1' as const, offerId: 'offer-1', capabilities: demand.resolved,
			features: [], configurationSupport: {}, permissionClasses: [], contextModes: ['manifest'], inputContracts: [], outputContracts: [], interactionModes: ['asynchronous'],
			conformance: [{ schemaVersion: 'treeseed.capability-conformance/v1' as const, providerId: 'provider-1', capability: demand.resolved[0]!, tier: 'signed-attestation' as const, status: 'passed' as const,
				evidenceDigest: `sha256:${'a'.repeat(64)}`, suite: null, issuedAt: '2026-08-29T00:00:00.000Z', expiresAt: null, signature: { keyId: 'provider-key', algorithm: 'Ed25519' as const, value: 'signed' } }],
			limits: {}, commercial: { currency: 'USD', estimatedCost: 1 }, region: null, trust: [] };
		const offer = capabilityOfferSchema.parse({ ...offerMaterial, offerDigest: capabilityOfferDigest(offerMaterial) });
		expect(negotiateCapabilityOffer(demand, offer)).toMatchObject({ eligible: false, reasons: ['missing_permission_support:tool-policy', 'missing_required_capability:treeseed.coordination.conversation'] });
	});
});
