import { z } from 'zod';

const identifier = z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/u);
const relativePath = z.string().min(1).max(512).refine((value) => {
	if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
	return !value.split('/').some((part) => part === '..' || part === '');
}, 'Paths must be safe, normalized, repository-relative paths.');
const environmentName = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u);
const localAlias = z.string().regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.localhost$/u);

export const developmentModeSchema = z.enum(['released', 'candidate', 'live']);
export const developmentTargetKindSchema = z.enum(['package-watch', 'live-web', 'live-api', 'rebuild-restart', 'local-companion']);
export const developmentReactionSchema = z.enum(['reload', 'restart', 'rebuild', 'stale', 'manual', 'none']);
export const developmentStatePolicySchema = z.enum(['stateless', 'ephemeral', 'clone', 'shared-compatible']);

const operationSchema = z.object({
	command: z.string().min(1).max(256),
	args: z.array(z.string().max(4_096)).max(64).default([]),
	cwd: relativePath.optional(),
	environment: z.record(environmentName, z.string().max(16_384)).default({}),
	timeoutSeconds: z.number().int().positive().max(86_400).default(600),
}).strict();

const readinessSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('marker'), path: relativePath, timeoutSeconds: z.number().int().positive().max(3_600) }).strict(),
	z.object({ kind: z.literal('http'), path: z.string().startsWith('/'), expectedStatus: z.number().int().min(100).max(599).default(200), timeoutSeconds: z.number().int().positive().max(3_600) }).strict(),
	z.object({ kind: z.literal('tcp'), timeoutSeconds: z.number().int().positive().max(3_600) }).strict(),
	z.object({ kind: z.literal('process'), graceSeconds: z.number().int().nonnegative().max(600).default(2) }).strict(),
]);

const endpointSchema = z.object({
	id: identifier,
	protocol: z.enum(['http', 'https', 'tcp']),
	port: z.number().int().min(1).max(65_535),
	canonicalAlias: localAlias.optional(),
	visibility: z.enum(['host', 'loopback', 'private']),
	authentication: z.enum(['none', 'application', 'mtls']).default('none'),
}).strict().superRefine((endpoint, context) => {
	if (endpoint.visibility === 'host' && !endpoint.canonicalAlias) context.addIssue({ code: z.ZodIssueCode.custom, path: ['canonicalAlias'], message: 'Host-visible endpoints require a canonical .localhost alias.' });
	if (endpoint.visibility !== 'host' && endpoint.canonicalAlias) context.addIssue({ code: z.ZodIssueCode.custom, path: ['canonicalAlias'], message: 'Only host-visible endpoints may request a canonical alias.' });
});

const outputSchema = z.object({
	path: relativePath,
	mediaType: z.string().min(1).max(256),
	completionMarker: relativePath.optional(),
	digestAlgorithm: z.literal('sha256').default('sha256'),
}).strict();

const dependencySchema = z.object({
	id: identifier,
	target: identifier,
	capability: identifier.optional(),
	locality: z.enum(['local', 'remote', 'either']).default('either'),
	reaction: developmentReactionSchema,
}).strict();

const freezeSchema = z.object({
	kind: z.enum(['npm-package', 'oci-image', 'archive', 'executable']),
	operation: operationSchema,
	artifacts: z.array(relativePath).min(1),
	contractOperations: z.array(operationSchema).default([]),
}).strict();

export const developmentTargetSchema = z.object({
	id: identifier,
	kind: developmentTargetKindSchema,
	platforms: z.array(z.enum(['linux-amd64', 'linux-arm64', 'darwin-arm64', 'darwin-amd64'])).min(1),
	runtimeRequirements: z.array(z.string().min(1).max(128)).default([]),
	sourceRoots: z.array(relativePath).min(1),
	ignoredPaths: z.array(relativePath).default([]),
	operations: z.object({
		setup: operationSchema.optional(), watch: operationSchema.optional(), build: operationSchema.optional(),
		start: operationSchema.optional(), stop: operationSchema.optional(), verify: operationSchema.optional(), cleanup: operationSchema.optional(),
	}).strict(),
	ready: readinessSchema,
	outputs: z.array(outputSchema).default([]),
	endpoints: z.array(endpointSchema).default([]),
	dependencies: z.array(dependencySchema).default([]),
	statePolicy: developmentStatePolicySchema,
	migrationPolicy: z.enum(['none', 'explicit-review', 'disposable-only']),
	secretRefs: z.record(environmentName, identifier).default({}),
	shutdown: z.object({ drainOperation: operationSchema.optional(), graceSeconds: z.number().int().nonnegative().max(3_600).default(30), activeWorkPolicy: z.enum(['block', 'drain', 'cancel-authorized']).default('block') }).strict(),
	resources: z.object({ cpuCores: z.number().positive().optional(), memoryBytes: z.number().int().positive().optional(), diskBytes: z.number().int().positive().optional() }).strict().default({}),
	logs: z.array(relativePath).default([]),
	forbiddenOperations: z.array(z.string().min(1).max(128)).default([]),
	freeze: freezeSchema.optional(),
	promotion: z.object({ liveAdmissible: z.literal(false), candidateRequiresVerification: z.literal(true) }).strict(),
}).strict().superRefine((target, context) => {
	const endpoints = target.endpoints.map((entry) => entry.id);
	if (new Set(endpoints).size !== endpoints.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endpoints'], message: 'Development endpoint IDs must be unique.' });
	if (target.kind === 'package-watch' && target.endpoints.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endpoints'], message: 'Package-watch targets cannot own service endpoints.' });
	if (target.kind === 'local-companion' && target.endpoints.some((entry) => entry.visibility !== 'loopback')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endpoints'], message: 'Local companions must remain loopback-only.' });
	if (target.kind !== 'package-watch' && target.ready.kind === 'marker') context.addIssue({ code: z.ZodIssueCode.custom, path: ['ready'], message: 'Service targets require process, TCP, or HTTP readiness.' });
	if (target.statePolicy === 'shared-compatible' && target.migrationPolicy !== 'explicit-review') context.addIssue({ code: z.ZodIssueCode.custom, path: ['migrationPolicy'], message: 'Shared state requires explicit migration review.' });
});

export const developmentRuntimeSchema = z.object({
	schemaVersion: z.literal('treeseed.development-runtime/v1'),
	project: z.object({ id: identifier, repository: z.string().regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/iu) }).strict(),
	defaults: z.object({ leaseSeconds: z.number().int().min(60).max(86_400).default(14_400), restoreOnFailure: z.boolean().default(true) }).strict(),
	targets: z.array(developmentTargetSchema).min(1),
}).strict().superRefine((runtime, context) => {
	const ids = runtime.targets.map((target) => target.id);
	if (new Set(ids).size !== ids.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['targets'], message: 'Development target IDs must be unique.' });
});

const repositoryClosureSchema = z.object({
	projectId: identifier,
	repository: z.string().min(1),
	worktree: z.string().min(1),
	commit: gitCommit,
	branch: z.string().min(1).nullable(),
	dirty: z.boolean(),
	dirtyDigest: digest.nullable(),
	recipeDigest: digest,
}).strict();

export const developmentSessionSchema = z.object({
	schemaVersion: z.literal('treeseed.development-session/v1'),
	sessionId: identifier,
	actor: z.string().min(1).max(256),
	hostId: identifier,
	createdAt: z.string().datetime(),
	expiresAt: z.string().datetime(),
	status: z.enum(['planning', 'active', 'degraded', 'restoring', 'stopped', 'expired']),
	repositories: z.array(repositoryClosureSchema),
	targets: z.array(z.object({ projectId: identifier, targetId: identifier, mode: developmentModeSchema, generation: z.number().int().nonnegative(), health: z.enum(['pending', 'ready', 'degraded', 'stopped']), reaction: developmentReactionSchema.optional() }).strict()),
	leases: z.array(z.object({ kind: z.enum(['alias', 'component', 'state', 'secret']), resource: z.string().min(1), acquiredAt: z.string().datetime(), expiresAt: z.string().datetime() }).strict()),
	restoredReceiptId: identifier.nullable(),
	blockers: z.array(z.object({ code: identifier, message: z.string().min(1), targetId: identifier.optional() }).strict()),
}).strict();

export const developmentCandidateSchema = z.object({
	schemaVersion: z.literal('treeseed.development-candidate/v1'),
	candidateId: identifier,
	sessionId: identifier,
	createdAt: z.string().datetime(),
	source: z.array(repositoryClosureSchema),
	artifacts: z.array(z.object({ projectId: identifier, targetId: identifier, kind: z.enum(['npm-package', 'oci-image', 'archive', 'executable', 'contract-bundle']), identity: z.string().min(1), digest, integrity: z.string().min(1).optional() }).strict()).min(1),
	configurationDigest: digest,
	dependencyGenerations: z.record(z.number().int().nonnegative()),
	compatibilityAttestations: z.array(z.object({ contractId: z.string().min(1), digest, compatible: z.boolean(), minimumBump: z.enum(['none', 'patch', 'minor', 'major']) }).strict()),
	verification: z.object({ status: z.enum(['pending', 'passed', 'failed']), operations: z.array(z.string().min(1)), completedAt: z.string().datetime().nullable() }).strict(),
	promotable: z.boolean(),
}).strict().superRefine((candidate, context) => {
	if (candidate.source.some((source) => source.dirty) && candidate.promotable) context.addIssue({ code: z.ZodIssueCode.custom, path: ['promotable'], message: 'Candidates containing dirty source cannot be promotable.' });
	if (candidate.verification.status !== 'passed' && candidate.promotable) context.addIssue({ code: z.ZodIssueCode.custom, path: ['promotable'], message: 'Only verified candidates can be promotable.' });
	if (candidate.promotable && candidate.source.some((source) => !Object.keys(candidate.dependencyGenerations).some((key) => key === source.projectId || key.startsWith(`${source.projectId}.`)))) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['dependencyGenerations'], message: 'Promotable candidates must bind a completed generation for every source project.' });
	}
});

const releaseArtifactSchema = z.object({
	id: identifier,
	kind: z.enum(['npm-package', 'oci-image', 'archive', 'executable', 'sbom', 'contract-bundle', 'compatibility-attestation', 'component-manifest', 'compose', 'provenance']),
	identity: z.string().min(1).max(2_048),
	digest,
	mediaType: z.string().min(1).max(256),
	size: z.number().int().nonnegative().optional(),
}).strict();

/** Exact, immutable custody record used to promote an already-built candidate. */
export const releaseEvidenceSchema = z.object({
	schemaVersion: z.literal('treeseed.release-evidence/v1'),
	candidate: z.object({
		id: identifier,
		receiptDigest: digest,
		sourceCommit: gitCommit,
		stagingRef: z.string().min(1).max(256),
		workflowRunId: z.string().regex(/^[1-9][0-9]*$/u),
		createdAt: z.string().datetime(),
	}).strict(),
	packages: z.array(z.object({
		projectId: identifier,
		name: z.string().min(1).max(256),
		version: z.string().min(1).max(128),
		minimumBump: z.enum(['none', 'patch', 'minor', 'major']),
	}).strict()).min(1),
	artifacts: z.array(releaseArtifactSchema).min(1),
	contractBundles: z.array(z.object({ id: identifier, digest }).strict()).default([]),
	compatibilityAttestations: z.array(z.object({ contractId: z.string().min(1), digest, compatible: z.literal(true), minimumBump: z.enum(['none', 'patch', 'minor', 'major']) }).strict()).default([]),
	verification: z.object({
		status: z.literal('passed'),
		operations: z.array(z.string().min(1)).min(1),
		completedAt: z.string().datetime(),
	}).strict(),
}).strict().superRefine((evidence, context) => {
	const identities = evidence.artifacts.map((artifact) => artifact.identity);
	if (new Set(identities).size !== identities.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['artifacts'], message: 'Release artifact identities must be unique.' });
	for (const bundle of evidence.contractBundles) {
		if (!evidence.artifacts.some((artifact) => artifact.kind === 'contract-bundle' && artifact.digest === bundle.digest)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['contractBundles'], message: `Contract bundle ${bundle.id} is not present in artifact custody.` });
	}
	for (const attestation of evidence.compatibilityAttestations) {
		if (!evidence.artifacts.some((artifact) => artifact.kind === 'compatibility-attestation' && artifact.digest === attestation.digest)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['compatibilityAttestations'], message: `Compatibility attestation ${attestation.contractId} is not present in artifact custody.` });
	}
});

export type DevelopmentRuntime = z.infer<typeof developmentRuntimeSchema>;
export type DevelopmentTarget = z.infer<typeof developmentTargetSchema>;
export type DevelopmentSession = z.infer<typeof developmentSessionSchema>;
export type DevelopmentCandidate = z.infer<typeof developmentCandidateSchema>;
export type DevelopmentMode = z.infer<typeof developmentModeSchema>;
export type DevelopmentReaction = z.infer<typeof developmentReactionSchema>;
export type ReleaseEvidence = z.infer<typeof releaseEvidenceSchema>;
