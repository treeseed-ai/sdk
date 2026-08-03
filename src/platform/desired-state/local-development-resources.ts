import { existsSync,readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { redactCapacityProviderEnv,validateAndDigestCapacityProviderManifest } from '../../capacity/providers/capacity-provider.ts';
import {
buildProjectLocalContentResources,
type LocalContentMode,
} from '../content/local-content-materialization.ts';
import { DesiredEnvironment,DesiredResource,TemplateUnit,hashJson } from './desired-environment.ts';
import { localTreeDxContentProjects,localTreeDxTemplateContentProjects } from './safe-tree-dx-repository-name.ts';
import { managedDevSourceClosureDigest } from '../../local-dev/source-closure.ts';
import { dockerSourceClosureDigest } from './docker-source-closure.ts';
import type { DeployConfig } from '../support/contracts.ts';

export function localDevelopmentResources(tenantRoot: string, environment: DesiredEnvironment, localContent: LocalContentMode, templates: TemplateUnit[], capacityConfigPath?: string, deployConfig?: DeployConfig): DesiredResource[] {
	if (environment !== 'local') return [];
	const composeId = 'local-docker-compose:agent-capacity-provider';
	const treeDxComposeId = 'local-docker-compose:treedx';
	const apiPostgresComposeId = 'local-docker-compose:api-postgres';
	const mailpitComposeId = 'local-docker-compose:mailpit';
	const capacityProviderDataDir = resolvePath(tenantRoot, '.treeseed/local-capacity-provider/data');
	const capacityProviderManifest = capacityConfigPath ? resolvePath(tenantRoot, capacityConfigPath) : resolvePath(tenantRoot, 'treeseed.capacity-provider.yaml');
	const capacityProviderManifestState = existsSync(capacityProviderManifest)
		? validateAndDigestCapacityProviderManifest(parseYaml(readFileSync(capacityProviderManifest, 'utf8')))
		: null;
	const capacityProviderManifestDigest = capacityProviderManifestState?.digest ?? null;
	const capacityProviderConnectionCount = capacityProviderManifestState?.manifest.connections.length ?? 0;
	const operationsRunnerDataDir = resolvePath(tenantRoot, '.treeseed/local-operations-runner/data');
	const localSeedPath = resolvePath(tenantRoot, 'seeds/treeseed.yaml');
	const localSeedModulePath = resolvePath(tenantRoot, 'packages/api/src/market/seeds/apply.ts');
	const hostCodexAuthFile = [
		process.env.TREESEED_CODEX_AUTH_FILE,
		process.env.CODEX_AUTH_FILE,
		process.env.HOME ? resolvePath(process.env.HOME, '.codex/auth.json') : '',
	].find((candidate) => candidate && existsSync(candidate)) ?? '';
	const localTreeDxApiEnv = {
		TREESEED_TREEDX_JWT_ISSUER: 'https://api.treeseed.local/treedx',
		TREESEED_TREEDX_JWT_AUDIENCE: 'treedx-local',
		TREESEED_TREEDX_JWT_HS256_SECRET: 'treeseed-local-treedx-jwt-secret',
		TREESEED_TREEDX_PROXY_ACTOR_ID: 'treeseed-api',
		TREESEED_TREEDX_PROXY_TENANT_ID: 'treeseed-control-plane',
	};
	const treeDxSourceClosureDigest = managedDevSourceClosureDigest({ tenantRoot, surface: 'treedx' }) ?? 'unavailable';
	const capacityProviderSourceClosureDigest = dockerSourceClosureDigest(resolvePath(tenantRoot, 'packages/agent'), '@treeseed/agent');
	const localCapacityProviderTreeDxEnv = {
		TREESEED_TREEDX_BASE_URL: 'http://host.docker.internal:4000',
		TREESEED_TREEDX_URL: 'http://host.docker.internal:4000',
		...localTreeDxApiEnv,
	};
	const localCapacityProviderEnv = {
		...localCapacityProviderTreeDxEnv,
		TREESEED_CAPACITY_PROVIDER_MANIFEST: capacityProviderManifest,
		TREESEED_PROVIDER_HOST_DATA_DIR: capacityProviderDataDir,
		...(hostCodexAuthFile ? {
			TREESEED_HOST_CODEX_AUTH_FILE: hostCodexAuthFile,
			TREESEED_CODEX_AUTH_FILE: '/data/codex/auth.json',
		} : {}),
		TREESEED_PROVIDER_CONTAINER_UID: String(process.getuid?.() ?? 1000),
		TREESEED_PROVIDER_CONTAINER_GID: String(process.getgid?.() ?? 1000),
		TREESEED_MARKET_URL: 'http://host.docker.internal:3000',
		TREESEED_MARKET_PROFILE_LOCAL_URL: 'http://host.docker.internal:3000',
		TREESEED_MARKET_PROFILE_LOCAL_AUDIENCE: 'http://127.0.0.1:3000',
	};
	const tunnel = deployConfig?.cloudflare.tunnel?.local;
	const tunnelResource: DesiredResource[] = tunnel?.enabled === true ? [{
		id: 'cloudflare-tunnel:local-connectors', kind: 'cloudflare-tunnel', provider: 'cloudflare', environment,
		packageId: '@treeseed/sdk', serviceId: 'provider-connectors', logicalName: 'local provider connector tunnel',
		dependencies: ['local-process:api'], spec: {
			accountId: deployConfig?.cloudflare.accountId ?? '', zoneId: tunnel.zoneId ?? deployConfig?.cloudflare.zoneId ?? '',
			name: tunnel.name ?? 'treeseed-local-connectors', hostname: tunnel.hostname ?? '', originUrl: tunnel.originUrl ?? 'http://127.0.0.1:3000',
			allowedPaths: ['/v1/provider-connectors/github/repository/setup', '/v1/provider-connectors/github/workflow/setup',
				'/v1/provider-connectors/github/repository/callback', '/v1/provider-connectors/github/workflow/callback',
				'/v1/provider-webhooks/github/repository', '/v1/provider-webhooks/github/workflow'],
		}, source: { type: 'package-adapter', id: '@treeseed/sdk' },
	}] : [];
	return [
		{
			id: apiPostgresComposeId,
			kind: 'local-docker-compose',
			provider: 'local',
			environment,
			packageId: '@treeseed/api',
			serviceId: 'api-postgres',
			logicalName: 'local API PostgreSQL compose',
			dependencies: [],
				spec: {
				composeFile: 'packages/api/compose.postgres.yml',
				projectName: 'treeseed-local-api-postgres',
				cwd: '.',
				dataDir: '.treeseed/local-api-postgres/data',
				env: {
					TREESEED_LOCAL_POSTGRES_PASSWORD: 'treeseed-local-dev',
					TREESEED_LOCAL_POSTGRES_PORT: '54329',
				},
				ports: [{ host: 54329, container: 5432 }],
				volumes: [{ name: 'treeseed-api-postgres-volume', mountPath: '/var/lib/postgresql/data', sharedLocalOnly: true }],
				healthChecks: [
					{ id: 'api-postgres-compose', kind: 'container', service: 'treeseed-api-postgres' },
				],
			},
			source: { type: 'package-adapter', id: '@treeseed/api' },
		},
		{
			id: mailpitComposeId,
			kind: 'local-docker-compose',
			provider: 'local',
			environment,
			packageId: '@treeseed/sdk',
			serviceId: 'mailpit',
			logicalName: 'local Mailpit email capture compose',
			dependencies: [],
			spec: {
				composeFile: 'packages/sdk/src/treeseed/services/compose.yml',
				projectName: 'treeseed-local-mailpit',
				cwd: '.',
				env: {
					TREESEED_MAILPIT_SMTP_BIND: '127.0.0.1',
					TREESEED_MAILPIT_SMTP_PORT: '1025',
					TREESEED_MAILPIT_UI_BIND: '127.0.0.1',
					TREESEED_MAILPIT_UI_PORT: '8025',
				},
				ports: [
					{ host: 1025, container: 1025 },
					{ host: 8025, container: 8025 },
				],
				healthChecks: [
					{ id: 'mailpit-ui', kind: 'http', url: 'http://127.0.0.1:8025' },
				],
			},
			source: { type: 'package-adapter', id: '@treeseed/sdk' },
		},
		{
			id: 'local-treedx:team-primary',
			kind: 'local-treedx',
			provider: 'local',
			environment,
			packageId: 'treedx',
			serviceId: 'treedx',
			logicalName: 'local TreeDX team content repository plane',
			dependencies: [treeDxComposeId],
			spec: {
				contentSyncVersion: 2,
				mode: 'private-team',
				contentRepositoryAccessMode: 'treedx',
				siteRepositoryAccessMode: 'filesystem',
				projectRepositoryAccessMode: 'filesystem',
				baseUrl: 'http://127.0.0.1:4000',
				dataDir: '.treeseed/local-treedx/data',
				managedStorage: {
					custody: 'treedx',
					hostPath: resolvePath(tenantRoot, '.treeseed/local-treedx/data'),
					servicePath: '/var/lib/treedx',
				},
				healthEndpoint: 'http://127.0.0.1:4000/api/v1/health',
				auth: localTreeDxApiEnv,
				projects: [
					...localTreeDxContentProjects(tenantRoot),
					...localTreeDxTemplateContentProjects(tenantRoot, templates),
				],
			},
			source: { type: 'package-adapter', id: 'treedx' },
		},
		{
			id: treeDxComposeId,
			kind: 'local-docker-compose',
			provider: 'local',
			environment,
			packageId: 'treedx',
			serviceId: 'treedx',
			logicalName: 'local TreeDX compose',
			dependencies: [],
			spec: {
				composeFile: 'packages/treedx/compose.yaml',
				projectName: 'treeseed-local-treedx',
				cwd: 'packages/treedx',
				dataDir: '.treeseed/local-treedx/data',
				managedStorage: {
					custody: 'treedx',
					hostPath: resolvePath(tenantRoot, '.treeseed/local-treedx/data'),
					servicePath: '/var/lib/treedx',
				},
				ports: [{ host: 4000, container: 4000 }],
				env: {
					TREEDX_ALLOW_DEV_VERIFIER_IN_PROD: 'true',
					TREESEED_TREEDX_HOST_DATA_DIR: resolvePath(tenantRoot, '.treeseed/local-treedx/data'),
					TREESEED_TREEDX_SOURCE_CLOSURE_DIGEST: treeDxSourceClosureDigest,
					...localTreeDxApiEnv,
				},
				volumes: [{ name: 'treeseed-local-treedx-data', mountPath: '/var/lib/treedx', sharedLocalOnly: true }],
				healthChecks: [
					{ id: 'treedx-api', kind: 'http', url: 'http://127.0.0.1:4000/api/v1/health', attempts: 240, intervalMs: 2_000 },
				],
			},
			source: { type: 'package-adapter', id: 'treedx' },
		},
		{
			id: 'capacity-provider:local',
			kind: 'capacity-provider',
			provider: 'local',
			environment,
			packageId: '@treeseed/agent',
			serviceId: 'capacity-provider',
			logicalName: 'local capacity provider',
			dependencies: [composeId],
			spec: {
				mode: 'local',
				roles: ['manager', 'runner'],
				volumePolicy: 'shared-local',
				manifestDigest: capacityProviderManifestDigest,
				sourceClosureDigest: capacityProviderSourceClosureDigest,
				expectedConnectionCount: capacityProviderConnectionCount,
				runtimeStatus: {
					path: '.treeseed/local-capacity-provider/data/runtime/manager.json',
					maxAgeSeconds: 180,
					attempts: 60,
					intervalMs: 500,
				},
			},
			source: { type: 'package-adapter', id: '@treeseed/agent' },
		},
		{
			id: composeId,
			kind: 'local-docker-compose',
			provider: 'local',
			environment,
			packageId: '@treeseed/agent',
			serviceId: 'agent-capacity-provider',
			logicalName: 'agent capacity provider compose',
			dependencies: ['local-process:api', treeDxComposeId],
			spec: {
				composeFile: 'packages/agent/compose.capacity-provider.yml',
				composeFiles: [
					'packages/agent/compose.capacity-provider.yml',
					'packages/agent/compose.capacity-provider.dev.yml',
				],
				projectName: 'treeseed-capacity-provider',
				cwd: '.',
				dataDir: '.treeseed/local-capacity-provider/data',
				managedStorage: {
					custody: 'capacity-provider',
					hostPath: capacityProviderDataDir,
					servicePath: '/data',
				},
				manifestDigest: capacityProviderManifestDigest,
				buildPolicy: 'missing',
				devMode: 'typescript',
				requiredHostPaths: [{
					path: capacityProviderManifest,
					kind: 'file',
					description: 'Capacity provider manifest',
				}],
				redactedEnv: redactCapacityProviderEnv(localCapacityProviderEnv),
				envKeys: Object.keys(localCapacityProviderEnv).sort(),
				env: localCapacityProviderEnv,
				services: ['manager', 'runner'],
				volumes: [{ name: 'treeseed-capacity-provider-data', mountPath: '/data', sharedLocalOnly: true }],
				healthChecks: [
					{ id: 'compose-services', kind: 'container', service: 'manager' },
				],
			},
			source: { type: 'package-adapter', id: '@treeseed/agent' },
		},
		...[
			['market-web', 'Market web dev process'],
			['api', 'API dev process'],
			['operations-runner', 'Operations runner dev process'],
		].map(([id, label]) => ({
			id: `local-process:${id}`,
			kind: 'local-process' as const,
			provider: 'local',
			environment,
			packageId: id === 'market-web' ? '@treeseed/market' : '@treeseed/api',
			serviceId: id,
			logicalName: label,
			dependencies: id === 'market-web'
				? ['local-process:api', mailpitComposeId]
				: id === 'api'
					? [apiPostgresComposeId, mailpitComposeId]
					: ['local-process:api'],
			spec: {
				processId: id,
				surfaces: id === 'market-web' ? ['web'] : id === 'api' ? ['api'] : ['operations-runner'],
				supervisor: 'sdk-managed-dev',
				action: 'start',
				options: {
					apiPort: 3000,
				},
				stateDir: '.treeseed/dev',
				logDir: '.treeseed/logs',
				cwd: id === 'market-web' ? '.' : 'packages/api',
				...(id === 'operations-runner' ? {
					managedStorage: {
						custody: 'operations-runner',
						hostPath: operationsRunnerDataDir,
						servicePath: operationsRunnerDataDir,
					},
					env: {
						TREESEED_PLATFORM_RUNNER_DATA_DIR: operationsRunnerDataDir,
					},
				} : {}),
				},
			source: { type: 'package-adapter' as const, id },
		})),
		...(existsSync(localSeedPath) && existsSync(localSeedModulePath) ? [{
			id: 'local-seed-bootstrap:treeseed',
			kind: 'local-seed-bootstrap' as const,
			provider: 'local',
			environment,
			packageId: '@treeseed/api',
			serviceId: 'seed-bootstrap',
			logicalName: 'local Treeseed seed bootstrap',
			dependencies: ['local-process:api', 'local-treedx:team-primary'],
			spec: {
				seedName: 'treeseed',
				environments: 'local',
				manifestPath: localSeedPath,
				manifestDigest: hashJson(readFileSync(localSeedPath, 'utf8')),
				applyModulePath: localSeedModulePath,
				compiledApplyModulePath: resolvePath(tenantRoot, 'packages/api/dist/market/seeds/apply.js'),
			},
			source: { type: 'package-adapter' as const, id: '@treeseed/api' },
		}] : []),
		...buildProjectLocalContentResources({ tenantRoot, environment, localContent }),
		...tunnelResource,
	];
}
