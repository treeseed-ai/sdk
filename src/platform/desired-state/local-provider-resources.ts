import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { redactCapacityProviderEnv, validateAndDigestCapacityProviderManifest } from '../../capacity/providers/capacity-provider.ts';
import type { DesiredEnvironment, DesiredResource } from './desired-environment.ts';

type ProviderClass = 'agent' | 'platform-operation';
type ProviderSeed = { key: string; providerClass: ProviderClass; manifest: string; seedName: string };

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function persistedSeedNames(tenantRoot: string) {
	const path = resolve(tenantRoot, '.treeseed/run/state.json');
	if (!existsSync(path)) return [];
	try {
		const state = record(JSON.parse(readFileSync(path, 'utf8')));
		return Array.isArray(state.seeds) ? state.seeds.map(String).filter(Boolean) : [];
	} catch {
		return [];
	}
}

function providerSeeds(tenantRoot: string, selectedSeedNames?: string[]): ProviderSeed[] {
	const seedNames = selectedSeedNames?.length ? selectedSeedNames : persistedSeedNames(tenantRoot);
	const parsed = (seedNames.length ? seedNames : ['treeseed']).flatMap((seedName): ProviderSeed[] => {
		const seedPath = resolve(tenantRoot, 'seeds', `${seedName}.yaml`);
		if (!existsSync(seedPath)) return [];
		const seed = record(parseYaml(readFileSync(seedPath, 'utf8')));
		const runtime = record(seed.runtime);
		const providers = Array.isArray(runtime.capacityProviders) ? runtime.capacityProviders : [];
		return providers.flatMap((entry): ProviderSeed[] => {
			const value = record(entry);
			const environments = Array.isArray(value.environments) ? value.environments.map(String) : ['local'];
			if (!environments.includes('local') || typeof value.key !== 'string' || typeof value.manifest !== 'string') return [];
			return [{ key: value.key, providerClass: value.providerClass === 'platform-operation' ? 'platform-operation' : 'agent', manifest: value.manifest, seedName }];
		});
	});
	return parsed;
}

function safeIdentity(value: string) {
	return value.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').toLowerCase();
}

export function localProviderResources(input: {
	tenantRoot: string;
	environment: DesiredEnvironment;
	capacityConfigPath?: string;
	sourceClosureDigest: string;
	treeDxEnvironment: Record<string, string>;
	hostCodexAuthFile: string;
	r2Bucket: string;
	seedBootstrapAvailable: boolean;
	seedNames?: string[];
}): DesiredResource[] {
	if (input.environment !== 'local') return [];
	return providerSeeds(input.tenantRoot, input.seedNames).flatMap((provider) => {
		const identity = `${provider.providerClass}-${safeIdentity(provider.key)}`;
		const relativeDataDir = `.treeseed/local-capacity-providers/${identity}`;
		const dataDir = resolve(input.tenantRoot, relativeDataDir);
		const manifestPath = resolve(input.tenantRoot, provider.manifest);
		const runtimeManifestPath = resolve(dataDir, 'runtime/provider-manifest.yaml');
		const manifestState = existsSync(manifestPath)
			? validateAndDigestCapacityProviderManifest(parseYaml(readFileSync(manifestPath, 'utf8')))
			: null;
		const manifestDigest = manifestState?.digest ?? null;
		const composeId = `local-docker-compose:capacity-provider:${identity}`;
		const providerId = `capacity-provider:${identity}`;
		const imageBuildIds = ['docker-image-build:treeseed/agent-runtime'];
		const env = {
			...input.treeDxEnvironment,
			TREESEED_CAPACITY_PROVIDER_MANIFEST: runtimeManifestPath,
			TREESEED_PROVIDER_HOST_DATA_DIR: dataDir,
			TREESEED_PROVIDER_CLASS: provider.providerClass,
			TREESEED_PROVIDER_SOURCE_CLOSURE_DIGEST: input.sourceClosureDigest,
			...(provider.providerClass === 'platform-operation' ? { TREESEED_CONTENT_BUCKET_NAME: input.r2Bucket } : {}),
			...(provider.providerClass === 'agent' ? {
				TREESEED_CODEX_AUTH_FILE: '/run/treeseed-secrets/codex-auth.json',
				...(input.hostCodexAuthFile ? { TREESEED_HOST_CODEX_AUTH_FILE: input.hostCodexAuthFile } : {}),
			} : {}),
			TREESEED_PROVIDER_CONTAINER_UID: String(process.getuid?.() ?? 1000),
			TREESEED_PROVIDER_CONTAINER_GID: String(process.getgid?.() ?? 1000),
			TREESEED_MARKET_URL: 'http://host.docker.internal:3000',
			TREESEED_MARKET_PROFILE_LOCAL_URL: 'http://host.docker.internal:3000',
			TREESEED_MARKET_PROFILE_LOCAL_AUDIENCE: 'http://127.0.0.1:3000',
		};
		return [{
			id: providerId, kind: 'capacity-provider', provider: 'local', environment: input.environment,
			packageId: '@treeseed/agent', serviceId: provider.providerClass, logicalName: `local ${provider.providerClass} capacity provider`,
			dependencies: [composeId], spec: {
				mode: 'local', providerClass: provider.providerClass, roles: ['manager', 'runner'], volumePolicy: 'isolated',
				manifestDigest, sourceClosureDigest: input.sourceClosureDigest, expectedConnectionCount: input.seedBootstrapAvailable ? 1 : manifestState?.manifest.connections.length ?? 0,
				runtimeStatus: { path: `${relativeDataDir}/runtime/manager.json`, maxAgeSeconds: 180, attempts: 60, intervalMs: 500 },
				baseManifestPath: provider.manifest, runtimeManifestPath: `${relativeDataDir}/runtime/provider-manifest.yaml`, seedName: provider.seedName,
				managedStorage: { custody: 'capacity-provider', hostPath: dataDir, servicePath: '/data', providerClass: provider.providerClass },
			}, source: { type: 'package-adapter', id: '@treeseed/agent' },
		}, {
			id: composeId, kind: 'local-docker-compose', provider: 'local', environment: input.environment,
			packageId: '@treeseed/agent', serviceId: provider.providerClass, logicalName: `${provider.providerClass} capacity provider compose`,
			dependencies: [...imageBuildIds, 'local-process:api', 'local-docker-compose:treedx', ...(input.seedBootstrapAvailable ? ['local-seed-bootstrap:treeseed'] : [])],
			spec: {
				composeFile: 'packages/agent/compose.capacity-provider.yml', composeFiles: ['packages/agent/compose.capacity-provider.yml'],
				projectName: `treeseed-${identity}`, cwd: '.', dataDir: relativeDataDir,
				managedStorage: { custody: 'capacity-provider', hostPath: dataDir, servicePath: '/data', providerClass: provider.providerClass },
				manifestDigest, sourceClosureDigest: input.sourceClosureDigest, buildPolicy: 'never', devMode: 'container-image',
				baseManifestPath: provider.manifest, runtimeManifestPath: `${relativeDataDir}/runtime/provider-manifest.yaml`,
				requiredHostPaths: [{ path: runtimeManifestPath, kind: 'file', description: `${provider.providerClass} capacity provider manifest` }],
				serviceImages: { manager: 'treeseed/agent-manager:local', runner: 'treeseed/agent-runner:local' },
				redactedEnv: redactCapacityProviderEnv(env), envKeys: Object.keys(env).sort(), env,
				services: ['manager', 'runner'], volumes: [{ name: `${identity}-data`, mountPath: '/data', sharedLocalOnly: false }],
				healthChecks: [{ id: 'compose-services', kind: 'container', service: 'manager' }],
			}, source: { type: 'package-adapter', id: '@treeseed/agent' },
		}];
	});
}
