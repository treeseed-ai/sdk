import { describe, expect, it } from 'vitest';
import { canonicalDeploymentJson, collectHostAliases, componentReleaseSchema, deploymentDigest, hostBackupSchema, hostBootstrapSchema, hostConfigurationSchema, hostMigrationSchema, hostRecoverySchema, hostUpdateSchema, packageRuntimeSchema, resolveMixedTrackCatalog, type ComponentRelease, type HostConfiguration, type ReleaseCatalog } from '../../../src/deployment/index.ts';

const hash = (value: string) => `sha256:${value.repeat(64)}`;

function runtime(componentId: string, version: string, alias: string) {
	return packageRuntimeSchema.parse({
		schemaVersion: 'treeseed.package-runtime/v1', componentId, version,
		compose: { projectName: `treeseed-${componentId}`, files: ['compose.yml'] },
		services: [{ id: 'service', composeService: 'service', endpoints: [{ id: 'http', protocol: 'http', port: 3000, visibility: 'host', defaultAlias: alias, aliasOverride: true, tls: 'edge', authentication: 'application', healthGate: { protocol: 'http', path: '/healthz', timeoutSeconds: 30 } }] }],
		stateVolumes: [], migrations: [], requiredCapabilities: ['docker-compose'],
	});
}

function release(componentId: string, track: 'stable' | 'development', marker: string): ComponentRelease {
	const version = track === 'stable' ? '1.0.0' : '1.1.0~rc1';
	return componentReleaseSchema.parse({
		schemaVersion: 'treeseed.component-release/v1', componentId, release: version, track,
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
		host: { id: 'local-host', role: 'development', architecture: 'amd64' }, runtime: { management: 'managed' },
		updates: { defaultTrack: 'stable', stable: { metadataPollSeconds: 86400, maintenanceWindow: { weekday: 'sunday', localTime: '03:00', jitterMinutes: 30 } }, development: { pollSeconds: 60 } },
		components: { api: { enabled: true, track: 'stable', configuration: {} }, agent: { enabled: true, track: 'development', configuration: {} } },
		network: { manager: { binding: '0.0.0.0:4790', aliases: ['manager.treeseed.localhost'], sans: ['localhost'], trustedLanCidrs: [] } }, secrets: {},
	});
}

describe('deployment contracts', () => {
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

	it('publishes bootstrap, update, backup, migration, and recovery receipt contracts', () => {
		const now = '2026-08-23T00:00:00.000Z';
		expect(hostBootstrapSchema.parse({ schemaVersion: 'treeseed.host-bootstrap/v1', bootstrapId: 'bootstrap-1', configurationDigest: hash('a'), apt: { origin: 'TreeSeed Deployment', suite: 'development', repository: 'https://apt.treeseed.ai/deployment', keyFingerprint: 'A'.repeat(40) }, packages: [{ name: 'treeseed', version: '0.1.0~rc1', architecture: 'amd64', origin: 'TreeSeed Deployment', order: 0 }], credentialPolicy: { noStoreResponse: true, redactedLogging: true, ephemeralGeneration: true, deleteAfterInstall: true }, createdAt: now }).credentialPolicy.deleteAfterInstall).toBe(true);
		expect(hostUpdateSchema.parse({ schemaVersion: 'treeseed.host-update/v1', updateId: 'update-1', track: 'development', fromCatalogDigest: hash('a'), toCatalogDigest: hash('b'), components: [{ componentId: 'agent', from: '1.0.0', to: '1.1.0~rc1', imageDigests: [hash('c')] }], activation: { policy: 'continuous', eligibleAt: now, jitterSeconds: 0 }, state: 'planned' }).track).toBe('development');
		expect(hostBackupSchema.parse({ schemaVersion: 'treeseed.host-backup/v1', backupId: 'backup-1', componentId: 'api', generation: 1, state: 'verified', artifacts: [{ volumeId: 'postgres', location: '/var/lib/treeseed/backups/api', digest: hash('d'), encrypted: true }], createdAt: now, verifiedAt: now }).state).toBe('verified');
		expect(hostMigrationSchema.parse({ schemaVersion: 'treeseed.host-migration/v1', migrationId: 'migration-1', componentId: 'agent', operation: 'provider-identity', fromGeneration: 0, toGeneration: 1, backupId: 'backup-1', state: 'verified', sourceWritersStopped: true, completedAt: now }).sourceWritersStopped).toBe(true);
		expect(hostRecoverySchema.parse({ schemaVersion: 'treeseed.host-recovery/v1', recoveryId: 'recovery-1', receiptId: 'receipt-1', componentId: 'api', trigger: 'health-gate', action: 'rollback', targetGeneration: 1, state: 'healthy', backupId: 'backup-1', completedAt: now }).action).toBe('rollback');
	});
});
