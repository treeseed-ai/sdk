import { createHash } from 'node:crypto';
import { z } from 'zod';

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
const identifier = z.string().regex(/^[a-z][a-z0-9.-]{1,191}$/u);
const capabilityId = z.string().regex(/^(?:treeseed\.[a-z][a-z0-9.-]*|provider\.[a-f0-9]{16,64}\.[a-z][a-z0-9.-]*)$/u);
const jsonSchema = z.record(z.unknown());

export const capabilityReferenceSchema = z.object({ id: capabilityId, version: semver, digest }).strict();
const artifactContractSchema = z.object({ id: identifier, version: semver, digest, mediaTypes: z.array(z.string().min(1)).default([]) }).strict();
const configurationFieldSchema = z.object({
	key: identifier,
	description: z.string().min(1),
	schema: jsonSchema,
	requirementSupport: z.array(z.enum(['required', 'preferred'])).min(1),
	securityCritical: z.boolean().default(false),
}).strict();

export const capabilityDefinitionSchema = z.object({
	schemaVersion: z.literal('treeseed.capability-definition/v1'),
	id: capabilityId,
	version: semver,
	digest,
	family: z.enum(['coordination', 'research', 'data', 'engineering', 'publishing', 'external-work']),
	title: z.string().min(1),
	description: z.string().min(1),
	status: z.enum(['active', 'deprecated', 'revoked']),
	features: z.array(identifier),
	inputs: z.array(artifactContractSchema),
	outputs: z.array(artifactContractSchema),
	configuration: z.array(configurationFieldSchema),
	permissionClasses: z.array(identifier),
	contextModes: z.array(identifier),
	interactionModes: z.array(identifier),
	implies: z.array(capabilityReferenceSchema),
	conflicts: z.array(capabilityReferenceSchema),
	qualificationTier: z.enum(['signed-attestation', 'automated-suite', 'reviewed-certification']),
	createdAt: z.string().datetime(),
}).strict();

export const capabilityOntologySchema = z.object({
	schemaVersion: z.literal('treeseed.capability-ontology/v1'),
	generation: z.number().int().positive(),
	digest,
	definitions: z.array(capabilityDefinitionSchema),
	createdAt: z.string().datetime(),
	signature: z.object({ keyId: identifier, algorithm: z.enum(['Ed25519', 'release-catalog']), value: z.string().min(1) }).strict(),
}).strict().superRefine((catalog, context) => {
	const keys = catalog.definitions.map((entry) => `${entry.id}@${entry.version}`);
	if (new Set(keys).size !== keys.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['definitions'], message: 'Capability definitions must be unique by id and version.' });
});

const configuredValueSchema = z.object({ value: z.unknown(), requirement: z.enum(['required', 'preferred']) }).strict();
export const capabilityDemandSchema = z.object({
	schemaVersion: z.literal('treeseed.capability-demand/v1'),
	ontologyGeneration: z.number().int().positive(),
	requirements: z.array(z.object({
		capabilityId,
		versionRange: z.string().min(1),
		requirement: z.enum(['required', 'preferred']),
		alternativeGroup: identifier.nullable().default(null),
		requiredFeatures: z.array(identifier).default([]),
		configuration: z.record(configuredValueSchema).default({}),
	}).strict()).min(1),
	resolved: z.array(capabilityReferenceSchema),
	permissionClasses: z.array(identifier),
	contextModes: z.array(identifier),
	inputContracts: z.array(artifactContractSchema),
	outputContracts: z.array(artifactContractSchema),
	demandDigest: digest,
}).strict();

export const capabilityConformanceSchema = z.object({
	schemaVersion: z.literal('treeseed.capability-conformance/v1'),
	providerId: z.string().min(1),
	capability: capabilityReferenceSchema,
	tier: z.enum(['signed-attestation', 'automated-suite', 'reviewed-certification']),
	status: z.enum(['passed', 'failed', 'revoked']),
	evidenceDigest: digest,
	suite: z.object({ id: identifier, version: semver }).strict().nullable(),
	issuedAt: z.string().datetime(),
	expiresAt: z.string().datetime().nullable(),
	signature: z.object({ keyId: identifier, algorithm: z.literal('Ed25519'), value: z.string().min(1) }).strict(),
}).strict();

export const providerContextCapacitySchema = z.discriminatedUnion('mode', [
	z.object({
		mode: z.literal('bounded'), measurement: z.enum(['tokens', 'bytes', 'items']),
		defaultInitial: z.number().int().positive(), maximum: z.number().int().positive(),
		reservedOutput: z.number().int().nonnegative().default(0), transportPayloadBytes: z.number().int().positive(),
		measurementProvenance: z.object({ provider: identifier, implementation: z.string().min(1), version: z.string().min(1).nullable() }).strict(),
	}).strict(),
	z.object({
		mode: z.literal('unbounded'), measurement: z.enum(['tokens', 'bytes', 'items']).nullable().default(null),
		transportPayloadBytes: z.number().int().positive(),
		measurementProvenance: z.object({ provider: identifier, implementation: z.string().min(1), version: z.string().min(1).nullable() }).strict(),
	}).strict(),
]).superRefine((value, context) => {
	if (value.mode === 'bounded' && value.defaultInitial > value.maximum) context.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultInitial'], message: 'Default initial context cannot exceed the maximum.' });
	if (value.mode === 'bounded' && value.measurement === 'tokens' && value.reservedOutput >= value.maximum) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reservedOutput'], message: 'Reserved output must leave room for input context.' });
});

export const capabilityOfferSchema = z.object({
	schemaVersion: z.literal('treeseed.capability-offer/v2'),
	offerId: identifier,
	capabilities: z.array(capabilityReferenceSchema).min(1),
	features: z.array(identifier),
	configurationSupport: z.record(z.object({ required: z.boolean(), preferred: z.boolean() }).strict()),
	permissionClasses: z.array(identifier),
	contextModes: z.array(identifier),
	inputContracts: z.array(artifactContractSchema),
	outputContracts: z.array(artifactContractSchema),
	interactionModes: z.array(identifier),
	conformance: z.array(capabilityConformanceSchema).min(1),
	contextCapacity: providerContextCapacitySchema,
	limits: z.record(z.unknown()),
	commercial: z.object({ currency: z.string().min(3).max(3).nullable(), estimatedCost: z.number().nonnegative().nullable() }).strict(),
	region: z.string().min(1).nullable(),
	trust: z.array(identifier),
	offerDigest: digest,
}).strict();

export const capabilityNegotiationReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.capability-negotiation/v1'),
	demandDigest: digest,
	offerDigest: digest,
	eligible: z.boolean(),
	resolvedCapabilities: z.array(capabilityReferenceSchema),
	omittedPreferred: z.array(z.string()),
	reasons: z.array(z.string()),
	receiptDigest: digest,
}).strict();

function canonical(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export function capabilityContractDigest(value: unknown): `sha256:${string}` {
	return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

export function capabilityDefinitionDigest(value: Omit<CapabilityDefinition, 'digest'>): `sha256:${string}` { return capabilityContractDigest(value); }
export function capabilityOfferDigest(value: Omit<CapabilityOffer, 'offerDigest'>): `sha256:${string}` { return capabilityContractDigest(value); }
export function capabilityDemandDigest(value: Omit<CapabilityDemand, 'demandDigest'>): `sha256:${string}` { return capabilityContractDigest(value); }

export function semverSatisfies(version: string, range: string): boolean {
	const parse = (input: string) => /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-|$)/u.exec(input)?.slice(1, 4).map(Number) ?? null;
	const actual = parse(version); if (!actual) return false;
	const compare = (left: number[], right: number[]) => left[0]! - right[0]! || left[1]! - right[1]! || left[2]! - right[2]!;
	if (range.includes('||')) return range.split('||').some((part) => semverSatisfies(version, part.trim()));
	if (/\s/u.test(range.trim())) return range.trim().split(/\s+/u).every((part) => semverSatisfies(version, part));
	for (const operator of ['>=', '<=', '>', '<'] as const) if (range.startsWith(operator)) {
		const expected = parse(range.slice(operator.length)); if (!expected) return false; const result = compare(actual, expected);
		return operator === '>=' ? result >= 0 : operator === '<=' ? result <= 0 : operator === '>' ? result > 0 : result < 0;
	}
	if (range.startsWith('^')) { const expected = parse(range.slice(1)); if (!expected || compare(actual, expected) < 0) return false;
		return expected[0]! > 0 ? actual[0] === expected[0] : expected[1]! > 0 ? actual[0] === 0 && actual[1] === expected[1] : compare(actual, [0, 0, expected[2]! + 1]) < 0; }
	if (range.startsWith('~')) { const expected = parse(range.slice(1)); return Boolean(expected && actual[0] === expected[0] && actual[1] === expected[1] && compare(actual, expected) >= 0); }
	if (/^\d+\.x$/u.test(range)) return actual[0] === Number(range.split('.')[0]);
	const exact = parse(range); return Boolean(exact && compare(actual, exact) === 0);
}

export function negotiateCapabilityOffer(demand: CapabilityDemand, offer: CapabilityOffer): CapabilityNegotiationReceipt {
	const reasons: string[] = [], omittedPreferred: string[] = [], resolvedCapabilities: CapabilityReference[] = [];
	const alternatives = new Map<string, { satisfied: boolean; required: boolean }>();
	for (const requirement of demand.requirements) {
		const candidates = offer.capabilities.filter((capability) => capability.id === requirement.capabilityId && semverSatisfies(capability.version, requirement.versionRange));
		const compatible = candidates.find((capability) => demand.resolved.some((resolved) => resolved.id === capability.id && resolved.version === capability.version && resolved.digest === capability.digest));
		const featureCompatible = compatible && requirement.requiredFeatures.every((feature) => offer.features.includes(feature));
		const configMissing = Object.entries(requirement.configuration).filter(([key, configured]) => configured.requirement === 'required' && offer.configurationSupport[key]?.required !== true).map(([key]) => key);
		const satisfied = Boolean(featureCompatible && configMissing.length === 0);
		if (requirement.alternativeGroup) { const group = alternatives.get(requirement.alternativeGroup) ?? { satisfied: false, required: false };
			alternatives.set(requirement.alternativeGroup, { satisfied: group.satisfied || satisfied, required: group.required || requirement.requirement === 'required' }); }
		else if (!satisfied && requirement.requirement === 'required') reasons.push(`missing_required_capability:${requirement.capabilityId}`);
		else if (!satisfied) omittedPreferred.push(`capability:${requirement.capabilityId}`);
		if (satisfied && compatible) resolvedCapabilities.push(compatible);
		for (const [key, configured] of Object.entries(requirement.configuration)) if (configured.requirement === 'preferred' && offer.configurationSupport[key]?.preferred !== true) omittedPreferred.push(`configuration:${requirement.capabilityId}:${key}`);
	}
	for (const [group, state] of alternatives) if (!state.satisfied && state.required) reasons.push(`missing_required_alternative:${group}`); else if (!state.satisfied) omittedPreferred.push(`alternative:${group}`);
	for (const permission of demand.permissionClasses) if (!offer.permissionClasses.includes(permission)) reasons.push(`missing_permission_support:${permission}`);
	for (const mode of demand.contextModes) if (!offer.contextModes.includes(mode)) reasons.push(`missing_context_mode:${mode}`);
	for (const contract of demand.inputContracts) if (!offer.inputContracts.some((candidate) => candidate.id === contract.id && candidate.version === contract.version && candidate.digest === contract.digest)) reasons.push(`missing_input_contract:${contract.id}`);
	for (const contract of demand.outputContracts) if (!offer.outputContracts.some((candidate) => candidate.id === contract.id && candidate.version === contract.version && candidate.digest === contract.digest)) reasons.push(`missing_output_contract:${contract.id}`);
	const material = { schemaVersion: 'treeseed.capability-negotiation/v1' as const, demandDigest: demand.demandDigest, offerDigest: offer.offerDigest,
		eligible: reasons.length === 0, resolvedCapabilities, omittedPreferred: [...new Set(omittedPreferred)].sort(), reasons: [...new Set(reasons)].sort() };
	return capabilityNegotiationReceiptSchema.parse({ ...material, receiptDigest: capabilityContractDigest(material) });
}

export type CapabilityReference = z.infer<typeof capabilityReferenceSchema>;
export type CapabilityDefinition = z.infer<typeof capabilityDefinitionSchema>;
export type CapabilityOntology = z.infer<typeof capabilityOntologySchema>;
export type CapabilityDemand = z.infer<typeof capabilityDemandSchema>;
export type CapabilityOffer = z.infer<typeof capabilityOfferSchema>;
export type CapabilityConformance = z.infer<typeof capabilityConformanceSchema>;
export type ProviderContextCapacity = z.infer<typeof providerContextCapacitySchema>;
export type CapabilityNegotiationReceipt = z.infer<typeof capabilityNegotiationReceiptSchema>;
