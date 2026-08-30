import { describe, expect, it } from 'vitest';
import { canonicalDeploymentJson, collectHostAliases, collectTopologyBlockers, componentReleaseSchema, deploymentDigest, hostBackupSchema, hostBootstrapSchema, hostConfigurationSchema, hostCredentialInitializerSchema, hostMigrationSchema, hostNeedsEdge, hostRecoverySchema, hostUpdateSchema, integrationReleaseSchema, packageRuntimeSchema, releaseCatalogSchema, resolveMixedTrackCatalog, type ComponentRelease, type HostConfiguration, type ReleaseCatalog } from '../../../src/deployment/index.ts';

const hash = (value: string) => `sha256:${value.repeat(64)}`;

function runtime(componentId: string, version: string, alias: string) {
	return packageRuntimeSchema.parse({
		schemaVersion: 'treeseed.package-runtime/v1', componentId, version,
		compose: { projectName: `treeseed-${componentId}`, files: [{ path: 'compose.yml', digest: hash('f') }] },
		services: [{ id: 'service', composeService: 'service', endpoints: [{ id: 'http', protocol: 'http', port: 3000, visibility: 'host', defaultAlias: alias, aliasOverride: true, tls: 'edge', authentication: 'application', healthGate: { protocol: 'http', path: '/healthz', timeoutSeconds: 30 } }] }],
		stateVolumes: [], migrations: [], requiredCapabilities: ['docker-compose'], dependencies: [],
	});
}

function release(componentId: string, track: 'stable' | 'development', marker: string): ComponentRelease {
	const version = track === 'stable' ? '1.0.0' : '1.1.0~rc1';
	return componentReleaseSchema.parse({
		schemaVersion: 'treeseed.component-release/v1', componentId, release: version, applicationVersion: version, revision: 1, track,
		source: { repository: `treeseed-ai/${componentId}`, commit: marker.repeat(40) },
		stableBase: track === 'development' ? { releaseRange: '^1.0.0', compatibilityId: 'linux-amd64-v1', catalogDigest: hash('a') } : null,
		packages: [{ name: `treeseed-component-${componentId}`, version, architecture: 'amd64', origin: 'TreeSeed Deployment', order: 1 }],
		images: [{ role: `${componentId}-service`, repository: `treeseed/${componentId}`, digest: hash(marker), platforms: ['linux/amd64', 'linux/arm64'], consumers: [componentId] }],
		runtime: runtime(componentId, version, `${componentId}.treeseed.localhost`), runtimeDigest: hash(marker),
		rollback: { compatible: true, requiresBackup: false }, evidence: { provenance: [], sboms: [], vulnerabilities: [] },
	});
}

function host(): HostConfiguration {
	return hostConfigurationSchema.parse({
		schemaVersion: 'treeseed.host/v1', configurationId: 'local-host', generation: 1,
		host: { id: 'local-host', role: 'integrated', architecture: 'amd64' }, runtime: { management: 'managed', environment: 'production' },
		updates: { defaultTrack: 'stable', stable: { metadataPollSeconds: 86400, maintenanceWindow: { weekday: 'sunday', localTime: '03:00', jitterMinutes: 30 } }, development: { pollSeconds: 60 } },
		components: { api: { enabled: true, track: 'stable', configuration: {} }, agent: { enabled: true, track: 'development', configuration: {} } },
		network: { manager: { binding: '0.0.0.0:4790', aliases: ['manager.treeseed.localhost'], sans: ['localhost'], trustedLanCidrs: [] } },
		fleet: { rolloutGroup: 'development', receiptReporting: { enabled: false, intervalSeconds: 300 } }, secrets: {},
	});
}

describe('deployment contracts', () => {
	it('validates provider-neutral host credential initializer registrations', () => {
		const initializer = hostCredentialInitializerSchema.parse({ schemaVersion: 'treeseed.host-credential-initializer/v1', id: 'provider.adapter', displayName: 'Provider adapter', description: 'Initializes a registered adapter credential.', credentialId: 'provider-adapter-auth',
			sources: [{ id: 'service-token', label: 'Service token', kind: 'secret', prompt: 'Service token', suggestedPaths: [], contentType: 'text/plain', minimumBytes: 16, maximumBytes: 4096 }],
			activation: { kind: 'sandbox-model-gateway', authenticationModes: { 'service-token': 'api-key' } } });
		expect(initializer.id).toBe('provider.adapter');
		expect(() => hostCredentialInitializerSchema.parse({ ...initializer, activation: { ...initializer.activation, authenticationModes: {} } })).toThrow(/Every credential source/u);
	});
	it('canonicalizes host configuration and produces a stable digest', () => {
		const value = host();
		expect(canonicalDeploymentJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}\n');
		expect(deploymentDigest(value)).toMatch(/^sha256:[a-f0-9]{64}$/u);
	});

	it('rejects unsafe host endpoint declarations', () => {
		const value = runtime('api', '1.0.0', 'api.treeseed.localhost');
		const endpoint = value.services[0]!.endpoints[0]!;
		expect(() => packageRuntimeSchema.parse({ ...value, services: [{ ...value.services[0], endpoints: [{ ...endpoint, defaultAlias: 'api.example.com' }] }] })).toThrow(/localhost/u);
		expect(() => packageRuntimeSchema.parse({ ...value, services: [{ ...value.services[0], endpoints: [{ ...endpoint, healthGate: undefined }] }] })).toThrow(/health gate/u);
		expect(packageRuntimeSchema.parse({ ...value, services: [{ ...value.services[0], endpoints: [{ ...endpoint, healthGate: { ...endpoint.healthGate!, timeoutSeconds: 1_200 } }] }] }).services[0]!.endpoints[0]!.healthGate?.timeoutSeconds).toBe(1_200);
		expect(() => packageRuntimeSchema.parse({ ...value, services: [{ ...value.services[0], endpoints: [{ ...endpoint, healthGate: { ...endpoint.healthGate!, timeoutSeconds: 1_201 } }] }] })).toThrow(/less than or equal to 1200/u);
	});

	it('declares manager-owned runtime configuration inputs', () => {
		const value = runtime('api', '1.0.0', 'api.treeseed.localhost');
		value.configuration = {
			environment: [{ name: 'TREESEED_PUBLIC_URL', required: true, source: 'configuration', default: 'https://api.treeseed.localhost' }],
			secretEnvironment: [{ name: 'TREESEED_DATABASE_URL', required: true }],
			secretFiles: [{ id: 'signing-key', path: '/etc/treeseed/credentials/api-signing-key', required: true }],
			files: [{ id: 'policy', path: '/etc/treeseed/components/api/policy.json', required: true, sensitive: false }],
		};
		expect(packageRuntimeSchema.parse(value).configuration).toEqual(value.configuration);
	});

	it('binds AI GPU components to fixed gates and declared Compose services', () => {
		const value = runtime('ai-inference', '1.0.0', 'inference.ai.treeseed.localhost');
		value.services.push({ id: 'gpu', composeService: 'inference-vllm', endpoints: [] });
		value.modeControl = { resource: 'ai-gpu', role: 'inference', gate: { service: 'service', executable: '/usr/local/bin/treeseed-ai-gpu-gate' }, services: { base: ['service'], gpu: ['inference-vllm'], warm: 'inference-vllm' } };
		expect(packageRuntimeSchema.parse(value).modeControl?.resource).toBe('ai-gpu');
		expect(() => packageRuntimeSchema.parse({ ...value, modeControl: { ...value.modeControl, services: { base: ['service'], gpu: ['arbitrary-container'] } } })).toThrow(/not declared/u);
	});

	it('rejects ambiguous or escaped runtime configuration custody', () => {
		const value = runtime('api', '1.0.0', 'api.treeseed.localhost');
		expect(() => packageRuntimeSchema.parse({ ...value, configuration: { environment: [{ name: 'DATABASE_URL', required: true }], secretEnvironment: [{ name: 'DATABASE_URL', required: true }], secretFiles: [], files: [] } })).toThrow(/both public and secret custody/u);
		expect(() => packageRuntimeSchema.parse({ ...value, configuration: { environment: [], secretEnvironment: [], secretFiles: [{ id: 'key', path: '/tmp/key', required: true }], files: [] } })).toThrow(/manager-owned credential paths/u);
		expect(() => packageRuntimeSchema.parse({ ...value, configuration: { environment: [], secretEnvironment: [], secretFiles: [], files: [{ id: 'policy', path: '/etc/treeseed/components/agent/policy.json', required: true, sensitive: false }] } })).toThrow(/outside component api custody/u);
		expect(() => packageRuntimeSchema.parse({ ...value, configuration: { environment: [{ name: 'RUNTIME_GID', required: true, source: 'manager', default: '0' }], secretEnvironment: [], secretFiles: [], files: [] } })).toThrow(/cannot declare configuration defaults/u);
	});

	it('inventories project-owned and pinned upstream OCI repositories without mutable reference syntax', () => {
		for (const repository of ['treeseed/inference-api', 'postgres', 'docker.io/library/postgres', 'ghcr.io/open-webui/open-webui']) {
			const candidate = release('api', 'stable', 'a');
			candidate.images[0]!.repository = repository;
			expect(componentReleaseSchema.parse(candidate).images[0]?.repository).toBe(repository);
		}
		for (const repository of ['https://ghcr.io/open-webui/open-webui', 'ghcr.io/Open-WebUI/open-webui', 'postgres:17', 'user:password@registry.example/repository', 'registry.example/repository@sha256:deadbeef', '../postgres']) {
			const candidate = release('api', 'stable', 'a');
			candidate.images[0]!.repository = repository;
			expect(() => componentReleaseSchema.parse(candidate), repository).toThrow(/OCI repositories/u);
		}
	});

	it('selects only explicitly compatible development overlays', () => {
		const api = release('api', 'stable', 'b'), agent = release('agent', 'development', 'c');
		const stable: ReleaseCatalog = { schemaVersion: 'treeseed.release-catalog/v1', release: '1.0.0', generation: 1, track: 'stable', compatibilityId: 'linux-amd64-v1', catalogDigest: hash('a'), stableBase: null, components: [api], createdAt: '2026-08-23T00:00:00.000Z' };
		const development: ReleaseCatalog = { schemaVersion: 'treeseed.release-catalog/v1', release: '1.1.0~rc1', generation: 2, track: 'development', compatibilityId: 'linux-amd64-v1', catalogDigest: hash('d'), stableBase: { release: stable.release, catalogDigest: stable.catalogDigest }, components: [agent], createdAt: '2026-08-23T00:00:00.000Z' };
		const selected = resolveMixedTrackCatalog({ host: host(), stable, development });
		expect(selected.components.map((component) => `${component.componentId}:${component.track}`)).toEqual(['agent:development', 'api:stable']);
		expect(selected.warnings).toEqual(['agent follows the continuous development track.']);
	});

	it('rejects alias collisions across otherwise valid components', () => {
		const left = release('api', 'stable', 'b'), right = release('agent', 'stable', 'c');
		right.runtime.services[0]!.endpoints[0]!.defaultAlias = 'api.treeseed.localhost';
		expect(() => collectHostAliases([left, right])).toThrow(/Duplicate host alias/u);
	});

	it('rejects unknown, private, and forbidden alias override identities', () => {
		const api = release('api', 'stable', 'a');
		expect(() => collectHostAliases([api], { 'api.http': 'api-alt.treeseed.localhost' })).toThrow(/does not identify an accepted host endpoint/u);
		api.runtime.services[0]!.endpoints.push({ id: 'internal', protocol: 'tcp', port: 4000, visibility: 'private', aliasOverride: false, tls: 'none', authentication: 'none' });
		expect(() => collectHostAliases([api], { 'api.service.internal': 'internal.treeseed.localhost' })).toThrow(/does not identify an accepted host endpoint/u);
		api.runtime.services[0]!.endpoints[0]!.aliasOverride = false;
		expect(() => collectHostAliases([api], { 'api.service.http': 'api-alt.treeseed.localhost' })).toThrow(/does not permit alias overrides/u);
	});

	it('applies a fully qualified host endpoint override', () => {
		const aliases = collectHostAliases([release('api', 'stable', 'a')], { 'api.service.http': 'api-alt.treeseed.localhost' });
		expect([...aliases.keys()]).toEqual(['api-alt.treeseed.localhost']);
	});

	it('requires explicit local or remote bindings for component dependencies', () => {
		const api = release('api', 'stable', 'a'), agent = release('agent', 'development', 'b');
		agent.runtime.dependencies = [{ id: 'control-plane', capability: 'control-plane-api', locality: 'either', optional: false }];
		const configuration = host();
		expect(collectTopologyBlockers(configuration, [api, agent])).toMatchObject([{ code: 'missing-connection', componentId: 'agent' }]);
		configuration.components.agent!.connections['control-plane'] = { kind: 'local', componentId: 'api', serviceId: 'service', endpointId: 'http' };
		expect(collectTopologyBlockers(configuration, [api, agent])).toEqual([]);
		configuration.components.agent!.connections['control-plane'] = { kind: 'remote', url: 'https://api.example.test', audience: 'https://api.example.test', tls: { trust: 'system' }, authentication: { mode: 'bearer', secretRef: 'provider-membership' }, healthGate: { protocol: 'https', path: '/v1/health', timeoutSeconds: 30 } };
		expect(collectTopologyBlockers(configuration, [api, agent])).toEqual([]);
	});

	it('allows an edge-free provider host with no local aliases', () => {
		const configuration = host();
		configuration.host.role = 'capacity-provider';
		configuration.components.api!.enabled = false;
		configuration.network.manager.aliases = [];
		configuration.network.manager.sans = [];
		const agent = release('agent', 'development', 'b');
		agent.runtime.services[0]!.endpoints = [];
		expect(hostConfigurationSchema.parse(configuration).network.manager.aliases).toEqual([]);
		expect(hostNeedsEdge(configuration, [agent])).toBe(false);
	});

	it('binds Platform integration selections to exact release assets', () => {
		const artifact = { url: 'https://github.com/treeseed-ai/agent/releases/download/1.0.0/component-release.json', sha256: 'a'.repeat(64) };
		const value = integrationReleaseSchema.parse({ schemaVersion: 'treeseed.integration-release/v1', release: '1.0.0', generation: 1, track: 'stable', compatibilityId: 'linux-amd64-v1', platform: { repository: 'treeseed-ai/platform', commit: 'a'.repeat(40) }, deployment: { repository: 'treeseed-ai/deployment', commit: 'b'.repeat(40), tag: '1.0.0' }, hostPayloads: [], components: [{ componentId: 'agent', release: '1.0.0-1', manifest: artifact, files: [{ path: 'compose.yml', artifact: { ...artifact, url: artifact.url.replace('component-release.json', 'compose.yml') } }] }], createdAt: '2026-08-24T00:00:00.000Z' });
		expect(value.components[0]?.files[0]?.path).toBe('compose.yml');
	});

	it('allows project release candidates to defer catalog binding but requires it at catalog ingestion', () => {
		const candidate = release('agent', 'development', 'c');
		candidate.stableBase!.catalogDigest = null;
		expect(componentReleaseSchema.parse(candidate).stableBase?.catalogDigest).toBeNull();
		const unbound = { schemaVersion: 'treeseed.release-catalog/v1', release: '1.1.0~rc1', generation: 2, track: 'development', compatibilityId: 'linux-amd64-v1', catalogDigest: hash('d'), stableBase: { release: '1.0.0', catalogDigest: hash('a') }, components: [candidate], createdAt: '2026-08-23T00:00:00.000Z' };
		expect(() => releaseCatalogSchema.parse(unbound)).toThrow(/exact selected stable base/u);
	});

	it('publishes bootstrap, update, backup, migration, and recovery receipt contracts', () => {
		const now = '2026-08-23T00:00:00.000Z';
		expect(hostBootstrapSchema.parse({ schemaVersion: 'treeseed.host-bootstrap/v1', bootstrapId: 'bootstrap-1', configurationDigest: hash('a'), apt: { origin: 'TreeSeed Deployment', suite: 'development', repository: 'https://apt.treeseed.ai/deployment', keyFingerprint: 'A'.repeat(40) }, packages: [{ name: 'treeseed', version: '0.1.0~rc1', architecture: 'amd64', origin: 'TreeSeed Deployment', order: 0 }], credentialPolicy: { noStoreResponse: true, redactedLogging: true, ephemeralGeneration: true, deleteAfterInstall: true }, createdAt: now }).credentialPolicy.deleteAfterInstall).toBe(true);
		expect(hostUpdateSchema.parse({ schemaVersion: 'treeseed.host-update/v1', updateId: 'update-1', track: 'development', fromCatalogDigest: hash('a'), toCatalogDigest: hash('b'), components: [{ componentId: 'agent', from: '1.0.0', to: '1.1.0~rc1', imageDigests: [hash('c')] }], activation: { policy: 'continuous', eligibleAt: now, jitterSeconds: 0 }, state: 'planned' }).track).toBe('development');
		expect(hostBackupSchema.parse({ schemaVersion: 'treeseed.host-backup/v1', backupId: 'backup-1', componentId: 'api', generation: 1, state: 'verified', artifacts: [{ volumeId: 'postgres', location: '/var/lib/treeseed/backups/api', digest: hash('d'), encrypted: true }], createdAt: now, verifiedAt: now }).state).toBe('verified');
		expect(hostMigrationSchema.parse({ schemaVersion: 'treeseed.host-migration/v1', migrationId: 'migration-1', componentId: 'agent', operation: 'provider-identity', fromGeneration: 0, toGeneration: 1, backupId: 'backup-1', state: 'verified', sourceWritersStopped: true, completedAt: now }).sourceWritersStopped).toBe(true);
		expect(hostRecoverySchema.parse({ schemaVersion: 'treeseed.host-recovery/v1', recoveryId: 'recovery-1', receiptId: 'receipt-1', componentId: 'api', trigger: 'health-gate', action: 'rollback', targetGeneration: 1, state: 'healthy', backupId: 'backup-1', completedAt: now }).action).toBe('rollback');
	});
});
