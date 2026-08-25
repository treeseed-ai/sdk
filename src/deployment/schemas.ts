import { z } from 'zod';

const identifier = z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/u);
const packageVersion = z.string().min(1).regex(/^[0-9][0-9A-Za-z.+:~-]*$/u);
const localAlias = z.string().regex(
	/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.localhost$/u,
	'Host aliases must use the .localhost namespace.',
);
const binding = z.string().regex(/^(?:\[[0-9a-f:]+\]|[^:]+):[1-9][0-9]{0,4}$/iu);
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === 'https:', 'Remote TreeSeed connections require HTTPS.');

export const deploymentTrackSchema = z.enum(['stable', 'development']);
export const hostRoleSchema = z.union([
	z.enum(['integrated', 'capacity-provider', 'control-plane', 'knowledge', 'ai-gpu', 'edge']),
	identifier,
]);

const connectionHealthGateSchema = z.object({
	protocol: z.enum(['http', 'https', 'tcp']),
	path: z.string().startsWith('/').optional(),
	timeoutSeconds: z.number().int().positive().max(600),
}).strict();

const remoteTlsSchema = z.object({
	trust: z.enum(['system', 'secret', 'spki']),
	serverName: z.string().min(1).optional(),
	caSecretRef: identifier.optional(),
	spkiSha256: digest.optional(),
}).strict().superRefine((tls, context) => {
	if (tls.trust === 'secret' && !tls.caSecretRef) context.addIssue({ code: z.ZodIssueCode.custom, path: ['caSecretRef'], message: 'Secret TLS trust requires a CA secret reference.' });
	if (tls.trust === 'spki' && !tls.spkiSha256) context.addIssue({ code: z.ZodIssueCode.custom, path: ['spkiSha256'], message: 'SPKI TLS trust requires an exact SHA-256 pin.' });
});

export const hostConnectionBindingSchema = z.union([
	z.object({
		kind: z.literal('local'),
		componentId: identifier,
		serviceId: identifier,
		endpointId: identifier,
	}).strict(),
	z.object({
		kind: z.literal('remote'),
		url: httpsUrl,
		audience: z.string().min(1),
		tls: remoteTlsSchema,
		authentication: z.object({ mode: z.enum(['none', 'application', 'bearer', 'mtls']), secretRef: identifier.optional() }).strict(),
		healthGate: connectionHealthGateSchema,
	}).strict(),
]).superRefine((connection, context) => {
	if (connection.kind === 'remote' && connection.authentication.mode !== 'none' && !connection.authentication.secretRef) context.addIssue({ code: z.ZodIssueCode.custom, path: ['authentication', 'secretRef'], message: 'Authenticated remote connections require a secret reference.' });
});

export const hostComponentSchema = z.object({
	enabled: z.boolean(),
	track: deploymentTrackSchema,
	profile: identifier.optional(),
	aliases: z.record(z.string().min(1), localAlias).default({}),
	configuration: z.record(z.unknown()).default({}),
	resources: z.object({
		cpuCores: z.number().positive().optional(),
		memoryBytes: z.number().int().positive().optional(),
		storageBytes: z.number().int().positive().optional(),
		gpuDevices: z.array(z.string().min(1)).default([]),
	}).strict().default({ gpuDevices: [] }),
	connections: z.record(identifier, hostConnectionBindingSchema).default({}),
}).strict();

export const hostConfigurationSchema = z.object({
	schemaVersion: z.literal('treeseed.host/v1'),
	configurationId: identifier,
	generation: z.number().int().positive(),
	host: z.object({
		id: identifier,
		role: hostRoleSchema,
		architecture: z.literal('amd64'),
	}).strict(),
	runtime: z.object({
		management: z.enum(['managed', 'external']),
		environment: z.enum(['production', 'development']).default('production'),
		dataRoot: z.string().startsWith('/').regex(/\/\.treeseed\/data$/u, 'Development dataRoot must end with /.treeseed/data.').optional(),
	}).strict().superRefine((runtime, context) => {
		if (runtime.environment === 'development' && !runtime.dataRoot) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dataRoot'], message: 'Development hosts require an explicit workspace-visible dataRoot.' });
		if (runtime.environment === 'production' && runtime.dataRoot) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dataRoot'], message: 'Production hosts use manager-owned /var/lib state and cannot override dataRoot.' });
	}),
	updates: z.object({
		defaultTrack: deploymentTrackSchema,
		stable: z.object({
			metadataPollSeconds: z.number().int().min(3600),
			maintenanceWindow: z.object({
				weekday: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
				localTime: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u),
				jitterMinutes: z.number().int().min(0).max(30),
			}).strict(),
		}).strict(),
		development: z.object({ pollSeconds: z.literal(60) }).strict(),
	}).strict(),
	components: z.record(identifier, hostComponentSchema),
	network: z.object({
		manager: z.object({ binding, aliases: z.array(localAlias).default([]), sans: z.array(z.string().min(1)).default([]), trustedLanCidrs: z.array(z.string().min(1)).default([]) }).strict(),
	}).strict(),
	fleet: z.object({
		rolloutGroup: identifier,
		receiptReporting: z.object({
			enabled: z.boolean(),
			connection: hostConnectionBindingSchema.optional(),
			intervalSeconds: z.number().int().min(60).max(86_400),
		}).strict(),
	}).strict().superRefine((fleet, context) => {
		if (fleet.receiptReporting.enabled && fleet.receiptReporting.connection?.kind !== 'remote') context.addIssue({ code: z.ZodIssueCode.custom, path: ['receiptReporting', 'connection'], message: 'Enabled fleet receipt reporting requires an explicit remote connection.' });
	}),
	secrets: z.record(identifier, z.object({
		provider: z.enum(['file', 'systemd-credential', 'vault', 'aws-secrets-manager']),
		reference: z.string().min(1),
	}).strict()),
}).strict();

export const packageEndpointSchema = z.object({
	id: identifier,
	protocol: z.enum(['http', 'https', 'tcp']),
	port: z.number().int().min(1).max(65535),
	visibility: z.enum(['private', 'host']),
	defaultAlias: localAlias.optional(),
	aliasOverride: z.boolean().default(true),
	tls: z.enum(['edge', 'passthrough', 'none']),
	authentication: z.enum(['none', 'application', 'mtls']),
	healthGate: z.object({ protocol: z.enum(['http', 'https', 'tcp']), path: z.string().startsWith('/').optional(), timeoutSeconds: z.number().int().positive().max(600) }).strict().optional(),
}).strict().superRefine((endpoint, context) => {
	if (endpoint.visibility === 'host' && !endpoint.defaultAlias) context.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultAlias'], message: 'Host-visible endpoints require a .localhost alias.' });
	if (endpoint.visibility === 'host' && !endpoint.healthGate) context.addIssue({ code: z.ZodIssueCode.custom, path: ['healthGate'], message: 'Host-visible endpoints require a health gate.' });
	if (endpoint.visibility === 'private' && endpoint.defaultAlias) context.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultAlias'], message: 'Private endpoints cannot declare host aliases.' });
});

export const packageRuntimeSchema = z.object({
	schemaVersion: z.literal('treeseed.package-runtime/v1'),
	componentId: identifier,
	version: packageVersion,
	compose: z.object({
		projectName: identifier,
		files: z.array(z.object({ path: z.string().min(1), digest }).strict()).min(1),
	}).strict(),
	services: z.array(z.object({ id: identifier, composeService: identifier, endpoints: z.array(packageEndpointSchema) }).strict()).min(1),
	stateVolumes: z.array(z.object({ id: identifier, volume: z.string().min(1), backup: z.enum(['required', 'optional', 'none']) }).strict()),
	migrations: z.array(z.object({ id: identifier, order: z.number().int().nonnegative(), backupRequired: z.boolean() }).strict()),
	requiredCapabilities: z.array(identifier),
	dependencies: z.array(z.object({
		id: identifier,
		capability: identifier,
		locality: z.enum(['local', 'remote', 'either']),
		optional: z.boolean().default(false),
	}).strict()).default([]),
}).strict().superRefine((runtime, context) => {
	const endpointIds = runtime.services.flatMap((service) => service.endpoints.map((endpoint) => `${service.id}.${endpoint.id}`));
	if (new Set(endpointIds).size !== endpointIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['services'], message: 'Endpoint identities must be unique within a component.' });
});

const catalogPackageSchema = z.object({ name: z.string().regex(/^treeseed(?:-[a-z0-9-]+)?$/u), version: packageVersion, architecture: z.enum(['amd64', 'all']), origin: z.literal('TreeSeed Deployment'), order: z.number().int().nonnegative() }).strict();
const catalogImageSchema = z.object({ role: identifier, repository: z.string().regex(/^treeseed\/[a-z0-9-]+$/u), digest, platforms: z.array(z.enum(['linux/amd64', 'linux/arm64'])).min(1), consumers: z.array(identifier).min(1) }).strict();

export const componentReleaseSchema = z.object({
	schemaVersion: z.literal('treeseed.component-release/v1'),
	componentId: identifier,
	release: packageVersion,
	applicationVersion: packageVersion,
	revision: z.number().int().positive(),
	track: deploymentTrackSchema,
	source: z.object({ repository: z.string().regex(/^treeseed-ai\/[a-z0-9-]+$/u), commit: gitCommit }).strict(),
	stableBase: z.object({ releaseRange: z.string().min(1), compatibilityId: identifier, catalogDigest: digest.nullable() }).strict().nullable(),
	packages: z.array(catalogPackageSchema).min(1),
	images: z.array(catalogImageSchema),
	runtime: packageRuntimeSchema,
	runtimeDigest: digest,
	rollback: z.object({ compatible: z.boolean(), requiresBackup: z.boolean() }).strict(),
	evidence: z.object({ provenance: z.array(z.string().url()), sboms: z.array(z.string().url()), vulnerabilities: z.array(z.string().url()) }).strict(),
}).strict().superRefine((release, context) => {
	if (release.runtime.componentId !== release.componentId || release.runtime.version !== release.release) context.addIssue({ code: z.ZodIssueCode.custom, path: ['runtime'], message: 'Runtime identity must match its component release.' });
	if (release.track === 'development' && !release.stableBase) context.addIssue({ code: z.ZodIssueCode.custom, path: ['stableBase'], message: 'Development releases require an exact stable-base binding.' });
	if (release.track === 'stable' && release.stableBase) context.addIssue({ code: z.ZodIssueCode.custom, path: ['stableBase'], message: 'Stable releases cannot be overlays.' });
});

const lockedArtifactSchema = z.object({ url: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
export const integrationReleaseSchema = z.object({
	schemaVersion: z.literal('treeseed.integration-release/v1'),
	release: packageVersion,
	generation: z.number().int().positive(),
	track: deploymentTrackSchema,
	compatibilityId: identifier,
	platform: z.object({ repository: z.literal('treeseed-ai/platform'), commit: gitCommit }).strict(),
	deployment: z.object({ repository: z.literal('treeseed-ai/deployment'), commit: gitCommit, tag: z.string().min(1) }).strict(),
	hostPayloads: z.array(z.object({ id: identifier, packageName: z.string().min(1), version: packageVersion, artifact: lockedArtifactSchema }).strict()),
	components: z.array(z.object({
		componentId: identifier,
		release: packageVersion,
		manifest: lockedArtifactSchema,
		files: z.array(z.object({ path: z.string().min(1), artifact: lockedArtifactSchema }).strict()).min(1),
	}).strict()),
	createdAt: z.string().datetime(),
}).strict().superRefine((release, context) => {
	const components = release.components.map((component) => component.componentId);
	if (new Set(components).size !== components.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['components'], message: 'Integration releases cannot select a component more than once.' });
});

export const releaseCatalogSchema = z.object({
	schemaVersion: z.literal('treeseed.release-catalog/v1'),
	release: packageVersion,
	generation: z.number().int().positive(),
	track: deploymentTrackSchema,
	compatibilityId: identifier,
	catalogDigest: digest,
	stableBase: z.object({ release: packageVersion, catalogDigest: digest }).strict().nullable(),
	components: z.array(componentReleaseSchema),
	createdAt: z.string().datetime(),
}).strict().superRefine((catalog, context) => {
	if (catalog.track === 'development' && !catalog.stableBase) context.addIssue({ code: z.ZodIssueCode.custom, path: ['stableBase'], message: 'Development catalogs require an exact stable base.' });
	if (catalog.track === 'stable' && catalog.stableBase) context.addIssue({ code: z.ZodIssueCode.custom, path: ['stableBase'], message: 'Stable catalogs cannot bind another stable base.' });
	if (catalog.track === 'development' && catalog.stableBase) for (const [index, component] of catalog.components.entries()) {
		if (component.track !== 'development' || component.stableBase?.catalogDigest !== catalog.stableBase.catalogDigest) context.addIssue({ code: z.ZodIssueCode.custom, path: ['components', index, 'stableBase', 'catalogDigest'], message: 'Catalog ingestion must bind every development component to the exact selected stable base.' });
	}
});

export const hostPlanSchema = z.object({ schemaVersion: z.literal('treeseed.host-plan/v1'), planId: identifier, configurationDigest: digest, catalogDigest: digest, changes: z.array(z.object({ componentId: identifier, action: z.enum(['install', 'upgrade', 'reconfigure', 'remove', 'noop']), from: packageVersion.nullable(), to: packageVersion.nullable() }).strict()), blockers: z.array(z.object({ code: identifier, message: z.string().min(1) }).strict()) }).strict();
export const hostBootstrapSchema = z.object({
	schemaVersion: z.literal('treeseed.host-bootstrap/v1'),
	bootstrapId: identifier,
	configurationDigest: digest,
	apt: z.object({ origin: z.literal('TreeSeed Deployment'), suite: deploymentTrackSchema, repository: z.string().url(), keyFingerprint: z.string().regex(/^[A-F0-9]{40}$/u) }).strict(),
	packages: z.array(catalogPackageSchema).min(1),
	credentialPolicy: z.object({ noStoreResponse: z.literal(true), redactedLogging: z.literal(true), ephemeralGeneration: z.literal(true), deleteAfterInstall: z.literal(true) }).strict(),
	createdAt: z.string().datetime(),
}).strict();
export const hostUpdateSchema = z.object({
	schemaVersion: z.literal('treeseed.host-update/v1'),
	updateId: identifier,
	track: deploymentTrackSchema,
	fromCatalogDigest: digest,
	toCatalogDigest: digest,
	components: z.array(z.object({ componentId: identifier, from: packageVersion.nullable(), to: packageVersion, imageDigests: z.array(digest) }).strict()).min(1),
	activation: z.object({ policy: z.enum(['maintenance-window', 'continuous']), eligibleAt: z.string().datetime(), jitterSeconds: z.number().int().nonnegative() }).strict(),
	state: z.enum(['planned', 'draining', 'applying', 'healthy', 'failed', 'rolled-back']),
}).strict();
export const hostReceiptSchema = z.object({ schemaVersion: z.literal('treeseed.host-receipt/v1'), receiptId: identifier, planId: identifier, state: z.enum(['known-good', 'degraded', 'rolled-back']), hostId: identifier, role: hostRoleSchema, rolloutGroup: identifier, configurationDigest: digest, catalogDigest: digest, packages: z.array(catalogPackageSchema), images: z.array(catalogImageSchema), runtimes: z.array(z.object({ componentId: identifier, release: packageVersion, runtimeDigest: digest }).strict()), completedAt: z.string().datetime() }).strict();
export const hostBackupSchema = z.object({
	schemaVersion: z.literal('treeseed.host-backup/v1'),
	backupId: identifier,
	componentId: identifier,
	generation: z.number().int().positive(),
	state: z.enum(['pending', 'complete', 'failed', 'verified']),
	artifacts: z.array(z.object({ volumeId: identifier, location: z.string().min(1), digest, encrypted: z.boolean() }).strict()),
	createdAt: z.string().datetime(),
	verifiedAt: z.string().datetime().nullable(),
}).strict();
export const hostMigrationSchema = z.object({
	schemaVersion: z.literal('treeseed.host-migration/v1'),
	migrationId: identifier,
	componentId: identifier,
	operation: identifier,
	fromGeneration: z.number().int().nonnegative(),
	toGeneration: z.number().int().positive(),
	backupId: identifier.nullable(),
	state: z.enum(['pending', 'quiesced', 'copied', 'verified', 'activated', 'failed', 'rolled-back']),
	sourceWritersStopped: z.boolean(),
	completedAt: z.string().datetime().nullable(),
}).strict();
export const hostRecoverySchema = z.object({
	schemaVersion: z.literal('treeseed.host-recovery/v1'),
	recoveryId: identifier,
	receiptId: identifier,
	componentId: identifier.nullable(),
	trigger: z.enum(['health-gate', 'operator', 'boot', 'interrupted-update']),
	action: z.enum(['retry', 'rollback', 'restore']),
	targetGeneration: z.number().int().positive(),
	state: z.enum(['pending', 'running', 'healthy', 'failed']),
	backupId: identifier.nullable(),
	completedAt: z.string().datetime().nullable(),
}).strict();

export type DeploymentTrack = z.infer<typeof deploymentTrackSchema>;
export type HostRole = z.infer<typeof hostRoleSchema>;
export type HostConnectionBinding = z.infer<typeof hostConnectionBindingSchema>;
export type HostConfiguration = z.infer<typeof hostConfigurationSchema>;
export type PackageRuntime = z.infer<typeof packageRuntimeSchema>;
export type PackageEndpoint = z.infer<typeof packageEndpointSchema>;
export type ComponentRelease = z.infer<typeof componentReleaseSchema>;
export type ReleaseCatalog = z.infer<typeof releaseCatalogSchema>;
export type IntegrationRelease = z.infer<typeof integrationReleaseSchema>;
export type HostPlan = z.infer<typeof hostPlanSchema>;
export type HostBootstrap = z.infer<typeof hostBootstrapSchema>;
export type HostUpdate = z.infer<typeof hostUpdateSchema>;
export type HostReceipt = z.infer<typeof hostReceiptSchema>;
export type HostBackup = z.infer<typeof hostBackupSchema>;
export type HostMigration = z.infer<typeof hostMigrationSchema>;
export type HostRecovery = z.infer<typeof hostRecoverySchema>;
