import { describe, expect, it } from 'vitest';
import { validateCapacityGrantV2 } from '../../../src/agent-capacity/validation/grant.ts';
import { validateAgentActivityProfilesConfiguration } from '../../../src/agent-capacity/validation/activity-profile.ts';
import { validateProjectAgentClassConfiguration } from '../../../src/agent-capacity/validation/configuration.ts';
import { CAPACITY_CONFIGURATION_DESCRIPTORS, CAPACITY_CONFIGURATION_FAMILIES } from '../../../src/agent-capacity/contracts/configuration/configuration.ts';
import { validateCapacityProviderManifestV5, validateProviderSupplyOffer } from '../../../src/capacity-provider/validation.ts';
import { validateAgentDefinitionModel } from '../../../src/agent-capacity/validation/agent-definition-schema.ts';
import * as providerContracts from '../../../src/capacity-provider/contracts/index.ts';
import { capabilityOfferDigest, capabilityOfferSchema } from '../../../src/capacity-provider/capability-ontology.ts';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const validators = {
	'provider-manifest': validateCapacityProviderManifestV5,
	'provider-offer': validateProviderSupplyOffer,
	'capacity-grant': validateCapacityGrantV2,
	'project-agent-class': validateProjectAgentClassConfiguration,
	'activity-profile': validateAgentActivityProfilesConfiguration,
} as const;

describe('capacity configuration inventory', () => {
	it('native public provider contracts validate immutable signed-proof inputs without loading control-plane clients or operator catalogs', () => {
		const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
			import { registerHooks } from 'node:module';
			import assert from 'node:assert/strict';
			registerHooks({ resolve(specifier, context, next) {
				const resolved = next(specifier, context);
				assert.doesNotMatch(resolved.url, /(?:control-plane-client|operator-contracts|capacity-provider\\/client\\.js)/u);
				return resolved;
			} });
			const contracts = await import('@treeseed/sdk/capacity-provider/contracts');
			assert.equal(typeof contracts.validateCapacityProviderManifestV5, 'function');
			assert.equal(typeof contracts.capabilityOfferSchema.parse, 'function');
			const proof = { schemaVersion: 1, algorithm: 'Ed25519', providerFingerprint: 'fingerprint',
				identityVersion: 1, method: 'POST', path: '/proof', bodySha256: 'digest', audience: 'https://isolated.invalid',
				jti: 'nonce', issuedAt: '2026-10-04T00:00:00.000Z', expiresAt: '2026-10-04T00:00:03.000Z' };
			const original = structuredClone(proof), options = { now: new Date('2026-10-04T00:00:01.000Z'), expectedPath: '/proof' };
			assert.deepEqual(contracts.validateCapacityProviderProofPayload(proof, options), { ok: true, diagnostics: [] });
			const changed = { ...proof, identityVersion: 0 }, retained = structuredClone(changed);
			const denied = contracts.validateCapacityProviderProofPayload(changed, options);
			assert.deepEqual(denied.diagnostics.map(value => value.code), ['provider_proof_identity_version_invalid']);
			assert.equal(denied.ok, false); assert.deepEqual(changed, retained); assert.deepEqual(proof, original);
			assert.deepEqual(contracts.validateCapacityProviderProofPayload(proof, options), { ok: true, diagnostics: [] });
			const reference = { id: 'provider.aaaaaaaaaaaaaaaa.work', version: '1.0.0', digest: 'sha256:' + 'a'.repeat(64) };
			const material = { schemaVersion: 'treeseed.capability-offer/v2', offerId: 'native-qualified-input', capabilities: [reference],
				features: [], configurationSupport: {}, permissionClasses: [], contextModes: [], inputContracts: [], outputContracts: [],
				interactionModes: [], conformance: [{ schemaVersion: 'treeseed.capability-conformance/v1', providerId: 'provider',
					capability: reference, tier: 'signed-attestation', status: 'passed', evidenceDigest: reference.digest, suite: null,
					issuedAt: proof.issuedAt, expiresAt: proof.expiresAt, signature: { keyId: 'input-key', algorithm: 'Ed25519', value: 'controlled-input' } }],
				contextCapacity: { mode: 'unbounded', measurement: null, transportPayloadBytes: 1024,
					measurementProvenance: { provider: 'provider', implementation: 'native-input', version: null } },
				limits: {}, commercial: { currency: null, estimatedCost: null }, region: null, trust: [] };
			const offer = { ...material, offerDigest: contracts.capabilityOfferDigest(material) }, retainedOffer = structuredClone(offer);
			assert.deepEqual(contracts.validateCapabilityOfferQualification(offer, { ...options, providerId: 'provider' }), { ok: true, diagnostics: [] });
			assert.equal(contracts.validateCapabilityOfferQualification(offer, { ...options, providerId: 'foreign' }).ok, false);
			assert.equal(contracts.validateCapabilityOfferQualification(offer, { now: new Date(proof.expiresAt) }).ok, false);
			assert.deepEqual(offer, retainedOffer);
			assert.deepEqual(contracts.validateCapabilityOfferQualification(offer, { ...options, providerId: 'provider' }), { ok: true, diagnostics: [] });
			process.stdout.write(JSON.stringify({ valid: true, invalid: false, retry: true, qualification: true }));
		`], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', timeout: 15_000 });
		expect(JSON.parse(output)).toEqual({ valid: true, invalid: false, retry: true, qualification: true });
	});
	it('exposes the original provider manifest validator and offer schemas through the client-free contracts boundary', () => {
		expect(Reflect.get(providerContracts, 'validateCapacityProviderManifestV5')).toBe(validateCapacityProviderManifestV5);
		expect(Reflect.get(providerContracts, 'capabilityOfferSchema')).toBe(capabilityOfferSchema);
		expect(Reflect.get(providerContracts, 'capabilityOfferDigest')).toBe(capabilityOfferDigest);
		for (const client of ['ProviderProtocolClient', 'ControlPlaneClient']) expect(Object.hasOwn(providerContracts, client)).toBe(false);
	});
	it('has one SDK-owned descriptor and validator for every declarative family', () => {
		expect(CAPACITY_CONFIGURATION_DESCRIPTORS.map((entry) => entry.id)).toEqual(CAPACITY_CONFIGURATION_FAMILIES);
		for (const descriptor of CAPACITY_CONFIGURATION_DESCRIPTORS) {
			expect(descriptor.ownerPackage).toBe('@treeseed/sdk');
			expect(validators[descriptor.id]).toBeTypeOf('function');
		}
	});

	it('accepts the minimal profile and preserves project-owned handler IDs', () => {
		const result = validateAgentActivityProfilesConfiguration({
			acting: {
				handler: 'sdk/project-handler',
				dependsOn: { agents: ['tester'] },
				permissions: {
					content: { read: ['book', 'knowledge', 'decision'], write: [] },
					tools: ['source.read', 'source.write', 'verification'],
				},
				prompt: { system: 'Implement the accepted work with the smallest complete change.' },
				additionalContext: ['assigned-source-scope'],
			},
		});
		expect(result).toEqual({ ok: true, diagnostics: [] });
	});

	it('rejects removed profile concepts instead of accepting compatibility aliases', () => {
		for (const field of ['enabled', 'branchPolicy', 'authorityPresets', 'tools', 'outputs', 'execution']) {
			const result = validateAgentActivityProfilesConfiguration({
				chat: {
					handler: 'writer',
					permissions: { content: { read: ['discussion'], write: ['discussion'] }, tools: ['discussion'] },
					prompt: { system: 'Answer the discussion using only the authorized project context.' },
					[field]: field === 'enabled' ? true : {},
				},
			});
			expect(result.ok, field).toBe(false);
			expect(result.diagnostics.some((entry) => entry.message.includes('Unrecognized key')), field).toBe(true);
		}
	});

	it('requires one handler, meaningful prompt, and permission ceiling', () => {
		const result = validateAgentActivityProfilesConfiguration({ chat: { handler: '', prompt: { system: 'short' } } });
		expect(result.ok).toBe(false);
		expect(result.diagnostics.map((entry) => entry.path)).toEqual(expect.arrayContaining([
			'activityProfiles.chat.handler',
			'activityProfiles.chat.permissions',
			'activityProfiles.chat.prompt.system',
		]));
	});

	it('reserves reviewing for the Reviewer class', () => {
		const activity = {
			handler: 'writer',
			permissions: { content: { read: ['decision'], write: ['note', 'decision'] }, tools: ['source.read', 'verification'] },
			prompt: { system: 'Review the exact candidate and record a formal disposition.' },
		};
		const base = {
			schemaVersion: 'treeseed.agent/v1', id: 'sdk/engineer', name: 'SDK Engineer', agentClass: 'engineer',
			purpose: 'Implement SDK work.', responsibilities: ['Implement accepted changes.'], capabilities: ['code-change'],
			context: { include: ['assignment-subject'] }, activityProfiles: { reviewing: activity },
		};
		expect(validateAgentDefinitionModel(base).ok).toBe(false);
		expect(validateAgentDefinitionModel({ ...base, id: 'sdk/reviewer', agentClass: 'reviewer' }).ok).toBe(true);
	});

	it('fails closed on unknown project-agent-class configuration fields', () => {
		const result = validateProjectAgentClassConfiguration({ id: 'engineer', slug: 'engineer', allowedModes: ['planning'], obsoletePolicy: {} });
		expect(result.ok).toBe(false);
		expect(result.diagnostics.map((entry) => entry.path)).toEqual(['allowedModes', 'obsoletePolicy']);
	});
});
