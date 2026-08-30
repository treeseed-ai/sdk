import { z } from 'zod';
import { AI_MODE_INTERNAL_PATH } from './ai-mode.ts';

const identifier = z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/u);
const packageVersion = z.string().min(1).regex(/^[0-9][0-9A-Za-z.+:~-]*$/u);
// OCI distribution references keep the registry and repository separate from
// the immutable digest. Unqualified single-segment names cover Docker Hub's
// official library images (for example `postgres`).
const ociRepository = z.string().min(1).max(255).regex(
	/^(?:(?:localhost|[a-z0-9]+(?:[.-][a-z0-9]+)+)(?::[1-9][0-9]{0,4})?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/u,
	'OCI repositories must be normalized lowercase names without a scheme, tag, digest, credentials, or traversal.',
);
const localAlias = z.string().regex(
	/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.localhost$/u,
	'Host aliases must use the .localhost namespace.',
);
const binding = z.string().regex(/^(?:\[[0-9a-f:]+\]|[^:]+):[1-9][0-9]{0,4}$/iu);
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === 'https:', 'Remote TreeSeed connections require HTTPS.');

export const deploymentTrackSchema = z.enum(['stable', 'development']);

export const hostCredentialInitializerSchema = z.object({
	schemaVersion: z.literal('treeseed.host-credential-initializer/v1'),
	id: identifier,
	displayName: z.string().min(1).max(128),
	description: z.string().min(1).max(1_024),
	credentialId: identifier,
	sources: z.array(z.object({
		id: identifier,
		label: z.string().min(1).max(128),
		kind: z.enum(['file', 'secret']),
		prompt: z.string().min(1).max(256),
		suggestedPaths: z.array(z.string().min(1).max(4_096)).max(16).default([]),
		contentType: z.enum(['application/json', 'text/plain']),
		minimumBytes: z.number().int().positive().max(1_048_576),
		maximumBytes: z.number().int().positive().max(1_048_576),
	}).strict().refine((source) => source.maximumBytes >= source.minimumBytes, 'Credential source maximum must be at least its minimum.')).min(1),
	activation: z.object({
		kind: z.literal('sandbox-model-gateway'),
		authenticationModes: z.record(identifier, z.enum(['api-key', 'subscription-file'])),
	}).strict(),
}).strict().superRefine((initializer, context) => {
	for (const source of initializer.sources) if (!initializer.activation.authenticationModes[source.id]) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['activation', 'authenticationModes', source.id], message: 'Every credential source requires an activation mode.' });
	}
});

export type HostCredentialInitializer = z.infer<typeof hostCredentialInitializerSchema>;
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
	security: z.object({
		sandbox: z.object({ required: z.boolean(), runtime: z.literal('kata-runtime-rs-qemu'), brokerSocket: z.string().startsWith('/run/treeseed/'),
			modelGateway: z.object({ provider: z.literal('openai'), upstreamBaseUrl: z.literal('https://api.openai.com'), allowedModels: z.array(z.string().min(1)).min(1) }).strict(),
			profiles: z.array(z.object({ id: identifier, guestImage: z.string().min(1), guestImageDigest: digest }).strict()).min(1) }).strict(),
		providerVolume: z.object({ encryption: z.literal('luks2'), backingPath: z.string().startsWith('/'), mountPath: z.string().startsWith('/'), sizeBytes: z.number().int().min(1_073_741_824), unlock: z.enum(['tpm2', 'systemd-credential']), recoveryRequired: z.literal(true) }).strict(),
		applicationEncryption: z.object({ provider: z.literal('systemd-credential'), activeKeyVersion: z.number().int().positive(), diagnosticsKeyVersion: z.number().int().positive() }).strict(),
	}).strict().optional(),
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
	healthGate: z.object({ protocol: z.enum(['http', 'https', 'tcp']), path: z.string().startsWith('/').optional(), timeoutSeconds: z.number().int().positive().max(1_200) }).strict().optional(),
}).strict().superRefine((endpoint, context) => {
	if (endpoint.visibility === 'host' && !endpoint.defaultAlias) context.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultAlias'], message: 'Host-visible endpoints require a .localhost alias.' });
	if (endpoint.visibility === 'host' && !endpoint.healthGate) context.addIssue({ code: z.ZodIssueCode.custom, path: ['healthGate'], message: 'Host-visible endpoints require a health gate.' });
	if (endpoint.visibility === 'private' && endpoint.defaultAlias) context.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultAlias'], message: 'Private endpoints cannot declare host aliases.' });
});

const environmentName = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u, 'Environment names must use portable uppercase identifiers.');
const componentSecretPath = z.string().regex(/^\/etc\/treeseed\/credentials\/[a-z0-9][a-z0-9._-]{0,127}$/u, 'Secret inputs must use manager-owned credential paths.');
const componentConfigurationPath = z.string().regex(/^\/etc\/treeseed\/components\/[a-z][a-z0-9.-]*\/[a-z0-9][a-z0-9._-]{0,127}$/u, 'Configuration inputs must use manager-owned component paths.');
const componentRuntimeConfigurationSchema = z.object({
	environment: z.array(z.object({ name: environmentName, required: z.boolean(), source: z.enum(['configuration', 'manager']).default('configuration'), default: z.string().max(16_384).optional() }).strict().superRefine((input, context) => {
		if (input.source === 'manager' && input.default !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['default'], message: 'Manager-derived environment inputs cannot declare configuration defaults.' });
	})).default([]),
	secretEnvironment: z.array(z.object({ name: environmentName, required: z.boolean() }).strict()).default([]),
	secretFiles: z.array(z.object({ id: identifier, path: componentSecretPath, required: z.boolean() }).strict()).default([]),
	files: z.array(z.object({ id: identifier, path: componentConfigurationPath, required: z.boolean(), sensitive: z.boolean().default(false) }).strict()).default([]),
}).strict().default({ environment: [], secretEnvironment: [], secretFiles: [], files: [] }).superRefine((configuration, context) => {
	const environment = configuration.environment.map(({ name }) => name);
	const secretEnvironment = configuration.secretEnvironment.map(({ name }) => name);
	for (const [path, values] of [['environment', environment], ['secretEnvironment', secretEnvironment]] as const) {
		if (new Set(values).size !== values.length) context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `Duplicate ${path} inputs are not allowed.` });
	}
	const overlap = environment.filter((name) => secretEnvironment.includes(name));
	if (overlap.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['secretEnvironment'], message: `Environment inputs cannot have both public and secret custody: ${overlap.join(', ')}.` });
	const filePaths = [...configuration.secretFiles.map(({ path }) => path), ...configuration.files.map(({ path }) => path)];
	if (new Set(filePaths).size !== filePaths.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['files'], message: 'Component file input paths must be unique.' });
});

export const packageRuntimeSchema = z.object({
	schemaVersion: z.literal('treeseed.package-runtime/v1'),
	componentId: identifier,
	version: packageVersion,
	compose: z.object({
		projectName: identifier,
		files: z.array(z.object({ path: z.string().min(1), digest }).strict()).min(1),
	}).strict(),
	configuration: componentRuntimeConfigurationSchema,
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
	modeControl: z.object({
		resource: z.literal('ai-gpu'),
		role: z.enum(['inference', 'training', 'controller']),
		gate: z.object({
			service: identifier,
			executable: z.literal('/usr/local/bin/treeseed-ai-gpu-gate'),
		}).strict().optional(),
		services: z.object({
			base: z.array(identifier).min(1),
			gpu: z.array(identifier).max(2),
			warm: identifier.optional(),
		}).strict(),
		internalControl: z.object({
			transport: z.literal('mtls'),
			clientCommonName: z.literal('client-ai-lab-mode'),
			path: z.literal(AI_MODE_INTERNAL_PATH),
		}).strict().optional(),
	}).strict().optional(),
}).strict().superRefine((runtime, context) => {
	const endpointIds = runtime.services.flatMap((service) => service.endpoints.map((endpoint) => `${service.id}.${endpoint.id}`));
	if (new Set(endpointIds).size !== endpointIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['services'], message: 'Endpoint identities must be unique within a component.' });
	for (const file of runtime.configuration.files) if (!file.path.startsWith(`/etc/treeseed/components/${runtime.componentId}/`)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['configuration', 'files'], message: `Configuration file ${file.id} is outside component ${runtime.componentId} custody.` });
	if (runtime.modeControl) {
		const services = new Set(runtime.services.map(({ composeService }) => composeService));
		for (const service of [...runtime.modeControl.services.base, ...runtime.modeControl.services.gpu, ...(runtime.modeControl.services.warm ? [runtime.modeControl.services.warm] : [])]) if (!services.has(service)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['modeControl', 'services'], message: `AI mode service ${service} is not declared by the component runtime.` });
		if (runtime.modeControl.gate && !services.has(runtime.modeControl.gate.service)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['modeControl', 'gate'], message: `AI mode gate service ${runtime.modeControl.gate.service} is not declared by the component runtime.` });
		if (runtime.modeControl.role === 'controller' && (!runtime.modeControl.internalControl || runtime.modeControl.gate || runtime.modeControl.services.gpu.length)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['modeControl'], message: 'The AI controller may declare only the scoped internal control surface.' });
		if (runtime.modeControl.role !== 'controller' && (!runtime.modeControl.gate || runtime.modeControl.internalControl || runtime.modeControl.services.gpu.length === 0)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['modeControl'], message: 'AI GPU components require a fixed gate and at least one GPU service.' });
	}
});

const catalogPackageSchema = z.object({ name: z.string().regex(/^treeseed(?:-[a-z0-9-]+)?$/u), version: packageVersion, architecture: z.enum(['amd64', 'all']), origin: z.literal('TreeSeed Deployment'), order: z.number().int().nonnegative() }).strict();
const catalogImageSchema = z.object({ role: identifier, repository: ociRepository, digest, platforms: z.array(z.enum(['linux/amd64', 'linux/arm64'])).min(1), consumers: z.array(identifier).min(1) }).strict();

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

export const hostSecurityReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.host-security-receipt/v1'), receiptId: identifier, hostId: identifier,
	sandbox: z.object({ runtime: z.literal('kata-runtime-rs-qemu'), kvmReady: z.boolean(), brokerReady: z.boolean(), guestImageDigests: z.array(digest) }).strict(),
	providerVolume: z.object({ encrypted: z.boolean(), format: z.literal('luks2'), mountPath: z.string().startsWith('/'), unlock: z.enum(['tpm2', 'systemd-credential']) }).strict(),
	keys: z.object({ provider: z.literal('systemd-credential'), activeCredentialVersion: z.number().int().positive(), activeDiagnosticsVersion: z.number().int().positive(), recoveryBundleVerified: z.boolean() }).strict(),
	state: z.enum(['planned', 'migrating', 'known-good', 'blocked']), completedAt: z.string().datetime(),
}).strict();
export type HostSecurityReceipt = z.infer<typeof hostSecurityReceiptSchema>;
