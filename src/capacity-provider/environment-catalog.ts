import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';

const identifier = z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const version = z.string().regex(/^\d+\.\d+\.\d+$/u);

export const sandboxEnvironmentContractSchema = z.object({
	id: identifier,
	version,
	digest,
	capabilities: z.array(identifier),
}).strict();

const provenance = z.object({
	sourceRepository: z.string().url(),
	sourceRevision: z.union([z.string().regex(/^[a-f0-9]{40}$/u), digest]),
	buildRecipeDigest: digest,
	sbomDigest: digest,
	signature: z.object({ keyId: identifier, algorithm: z.enum(['Ed25519', 'cosign']), value: z.string().min(1) }).strict(),
}).strict();

export const sandboxEnvironmentCatalogEntrySchema = z.object({
	id: identifier,
	version,
	kind: z.enum(['base', 'extension']),
	contract: sandboxEnvironmentContractSchema,
	image: z.object({ reference: z.string().min(1), digest, architectures: z.array(z.enum(['amd64', 'arm64'])).min(1), operatingSystem: z.literal('linux') }).strict(),
	derivedFrom: z.array(z.object({ entryId: identifier, version, imageDigest: digest }).strict()).min(1).nullable(),
	provenance,
	qualification: z.object({ suiteId: identifier, suiteVersion: version, evidenceDigest: digest, status: z.literal('passed'), completedAt: z.string().datetime() }).strict(),
	status: z.enum(['active', 'deprecated', 'revoked']),
	createdAt: z.string().datetime(),
}).strict().superRefine((entry, context) => {
	if (new Set(entry.image.architectures).size !== entry.image.architectures.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['image', 'architectures'], message: 'Image architectures must be unique.' });
	if (entry.kind === 'base' && entry.derivedFrom !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ['derivedFrom'], message: 'Base environments cannot derive from another catalog entry.' });
	if (entry.kind === 'extension' && entry.derivedFrom === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ['derivedFrom'], message: 'Extended environments require exact catalog bases.' });
});

export const sandboxEnvironmentCatalogSchema = z.object({
	schemaVersion: z.literal('treeseed.sandbox-environment-catalog/v1'),
	generation: z.number().int().positive(),
	catalogDigest: digest,
	rootPolicy: z.object({ allowedBaseImageDigests: z.array(digest).min(1) }).strict(),
	entries: z.array(sandboxEnvironmentCatalogEntrySchema),
	createdAt: z.string().datetime(),
	signature: z.object({ keyId: identifier, algorithm: z.literal('Ed25519'), value: z.string().min(1) }).strict(),
}).strict().superRefine((catalog, context) => {
	const entries = new Map(catalog.entries.map((entry) => [`${entry.id}@${entry.version}`, entry]));
	for (const [index, entry] of catalog.entries.entries()) {
		if (entry.kind === 'base' && !catalog.rootPolicy.allowedBaseImageDigests.includes(entry.image.digest)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['entries', index, 'image', 'digest'], message: 'Base image is not an allowed catalog root.' });
		if (entry.kind !== 'extension' || !entry.derivedFrom) continue;
		const parentArchitectures = new Set<string>();
		for (const [parentIndex, reference] of entry.derivedFrom.entries()) {
			const parent = entries.get(`${reference.entryId}@${reference.version}`);
			if (!parent || parent.image.digest !== reference.imageDigest) {
				context.addIssue({ code: z.ZodIssueCode.custom, path: ['entries', index, 'derivedFrom', parentIndex], message: 'Environment extension does not bind an exact entry in this catalog.' });
				continue;
			}
			const pending = [parent], seen = new Set<string>(), roots = [] as typeof catalog.entries;
			while (pending.length) {
				const current = pending.pop()!, key = `${current.id}@${current.version}`;
				if (seen.has(key)) { roots.length = 0; break; }
				seen.add(key);
				if (current.kind === 'base') { roots.push(current); continue; }
				for (const ancestor of current.derivedFrom ?? []) {
					const resolved = entries.get(`${ancestor.entryId}@${ancestor.version}`);
					if (!resolved || resolved.image.digest !== ancestor.imageDigest) { roots.length = 0; pending.length = 0; break; }
					pending.push(resolved);
				}
			}
			if (!roots.length || roots.some((root) => !catalog.rootPolicy.allowedBaseImageDigests.includes(root.image.digest))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['entries', index, 'derivedFrom', parentIndex], message: 'Environment extension does not resolve to an allowed catalog root.' });
			else for (const root of roots) for (const architecture of root.image.architectures) parentArchitectures.add(architecture);
		}
		for (const architecture of entry.image.architectures) if (!parentArchitectures.has(architecture)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['entries', index, 'derivedFrom'], message: `Environment extension has no allowed ${architecture} base.` });
	}
});

export const providerSandboxEnvironmentAvailabilitySchema = z.object({
	schemaVersion: z.literal('treeseed.provider-sandbox-environments/v1'),
	providerId: z.string().min(1),
	catalogGeneration: z.number().int().positive(),
	catalogDigest: digest,
	entries: z.array(z.object({ entryId: identifier, version, contractDigest: digest, imageDigest: digest, status: z.enum(['pulling', 'ready', 'failed', 'quarantined']), checkedAt: z.string().datetime(), reason: z.string().min(1).nullable() }).strict()),
}).strict();

export type SandboxEnvironmentContract = z.infer<typeof sandboxEnvironmentContractSchema>;
export type SandboxEnvironmentCatalogEntry = z.infer<typeof sandboxEnvironmentCatalogEntrySchema>;
export type SandboxEnvironmentCatalog = z.infer<typeof sandboxEnvironmentCatalogSchema>;
export type ProviderSandboxEnvironmentAvailability = z.infer<typeof providerSandboxEnvironmentAvailabilitySchema>;

function canonical(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export function sandboxEnvironmentCatalogDigest(value: Omit<SandboxEnvironmentCatalog, 'catalogDigest' | 'signature'>): `sha256:${string}` {
	return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

export function sandboxEnvironmentCatalogSigningBytes(value: SandboxEnvironmentCatalog): Buffer {
	return Buffer.from(canonical({ ...value, signature: { ...value.signature, value: '' } }));
}

export function verifySandboxEnvironmentCatalog(value: unknown, publicJwk: JsonWebKey): SandboxEnvironmentCatalog {
	const catalog = sandboxEnvironmentCatalogSchema.parse(value);
	const { catalogDigest, signature: _signature, ...material } = catalog;
	if (sandboxEnvironmentCatalogDigest(material) !== catalogDigest) throw new Error('Sandbox environment catalog digest does not match its canonical content.');
	if (!verify(null, sandboxEnvironmentCatalogSigningBytes(catalog), createPublicKey({ key: publicJwk, format: 'jwk' }), Buffer.from(catalog.signature.value, 'base64url'))) throw new Error('Sandbox environment catalog signature is invalid.');
	return catalog;
}
