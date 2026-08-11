import { existsSync,readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
buildProjectLocalContentResources,
type LocalContentMode,
} from '../content/local-content-materialization.ts';
import { DesiredEnvironment,DesiredResource,TemplateUnit,hashJson } from './desired-environment.ts';
import { localTreeDxContentProjects } from './safe-tree-dx-repository-name.ts';
import { managedDevSourceClosureDigest } from '../../local-dev/source-closure.ts';
import { dockerSourceClosureDigest } from './docker-source-closure.ts';
import { scopedLocalTunnelIdentity } from './local-tunnel-identity.ts';
import type { DeployConfig } from '../support/contracts.ts';
import { localProviderResources } from './local-provider-resources.ts';

export function localDevelopmentResources(tenantRoot: string, environment: DesiredEnvironment, localContent: LocalContentMode, templates: TemplateUnit[], capacityConfigPath?: string, deployConfig?: DeployConfig, seedNames?: string[]): DesiredResource[] {
	if (environment !== 'local') return [];
	const treeDxComposeId = 'local-docker-compose:treedx';
	const apiPostgresComposeId = 'local-docker-compose:api-postgres';
	const mailpitComposeId = 'local-docker-compose:mailpit';
	const localSeedPath = resolvePath(tenantRoot, 'seeds/treeseed.yaml');
	const localSeedModulePath = resolvePath(tenantRoot, 'packages/api/src/market/seeds/apply.ts');
	const seedBootstrapAvailable = existsSync(localSeedPath) && existsSync(localSeedModulePath);
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
	const tunnel = deployConfig?.cloudflare.tunnel?.local;
	const tunnelIdentity = tunnel?.enabled === true
		? scopedLocalTunnelIdentity(tenantRoot, tunnel.name ?? 'treeseed-local-connectors', tunnel.hostname ?? '')
		: null;
	const tunnelResource: DesiredResource[] = tunnel?.enabled === true ? [{
		id: 'cloudflare-tunnel:local-connectors', kind: 'cloudflare-tunnel', provider: 'cloudflare', environment,
		packageId: '@treeseed/sdk', serviceId: 'provider-connectors', logicalName: 'local provider connector tunnel',
		dependencies: ['local-process:api'], spec: {
			accountId: deployConfig?.cloudflare.accountId ?? '', zoneId: tunnel.zoneId ?? deployConfig?.cloudflare.zoneId ?? '',
			name: tunnelIdentity!.name, hostname: tunnelIdentity!.hostname,
			baseName: tunnelIdentity!.baseName, baseHostname: tunnelIdentity!.baseHostname,
			deploymentScope: tunnelIdentity!.scope, originUrl: tunnel.originUrl ?? 'http://127.0.0.1:3000',
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
				contentSyncVersion: 3,
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
				projects: localTreeDxContentProjects(tenantRoot),
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
		...localProviderResources({ tenantRoot, environment, capacityConfigPath, sourceClosureDigest: capacityProviderSourceClosureDigest,
			treeDxEnvironment: localCapacityProviderTreeDxEnv, hostCodexAuthFile, seedBootstrapAvailable, seedNames,
			r2Bucket: deployConfig?.cloudflare.r2?.bucketName ?? 'treeseed-market-content' }),
		...[
			['market-web', 'Market web dev process'],
			['api', 'API dev process'],
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
				: [apiPostgresComposeId, mailpitComposeId],
			spec: {
				processId: id,
				surfaces: id === 'market-web' ? ['web'] : ['api'],
				supervisor: 'sdk-managed-dev',
				action: 'start',
				options: {
					apiPort: 3000,
				},
				stateDir: '.treeseed/dev',
				logDir: '.treeseed/logs',
				cwd: id === 'market-web' ? '.' : 'packages/api',
				},
			source: { type: 'package-adapter' as const, id },
		})),
		...(seedBootstrapAvailable ? [{
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
