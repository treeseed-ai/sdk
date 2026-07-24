import { resolve } from 'node:path';
import type { ManagedDevOptions, ManagedDevProcessSpec } from './managed-dev.ts';
import { managedDevSourceClosureDigest } from './source-closure.ts';

function scriptCommand(tenantRoot: string, script: string, args: string[] = []) {
	return {
		command: 'npm',
		args: ['run', script, '--', ...args],
		cwd: tenantRoot,
	};
}

function apiCommand(tenantRoot: string, script: 'api' | 'runner') {
	return {
		command: 'npm',
		args: ['-w', 'packages/api', 'run', script === 'api' ? 'dev:api' : 'dev:runner'],
		cwd: tenantRoot,
	};
}

function localApiEnvironment(apiPort: number) {
	const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
	return {
		TREESEED_DATABASE_URL: 'postgresql://treeseed:treeseed-local-dev@127.0.0.1:54329/treeseed_api',
		TREESEED_API_BASE_URL: apiBaseUrl,
		TREESEED_CAPACITY_ACCEPTANCE_API_URL: apiBaseUrl,
		TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN: 'tsk_local_treeseed_acceptance_admin',
		TREESEED_CAPACITY_ACCEPTANCE_AGENT_CLASS_ID: 'planning',
		TREESEED_CAPACITY_ACCEPTANCE_ENVIRONMENT: 'local',
		TREESEED_API_PROVIDER_AUTH: 'market-postgres',
		TREESEED_API_AUTH_SECRET: 'treeseed-api-dev-secret',
		TREESEED_API_WEB_SERVICE_ID: 'web',
		TREESEED_API_WEB_SERVICE_SECRET: 'treeseed-web-service-dev-secret',
		TREESEED_API_WEB_ASSERTION_SECRET: 'treeseed-web-assertion-dev-secret',
		TREESEED_TREEDX_URL: 'http://127.0.0.1:4000',
		TREESEED_TREEDX_JWT_ISSUER: 'https://api.treeseed.local/treedx',
		TREESEED_TREEDX_JWT_AUDIENCE: 'treedx-local',
		TREESEED_TREEDX_JWT_HS256_SECRET: 'treeseed-local-treedx-jwt-secret',
		TREESEED_TREEDX_PROXY_ACTOR_ID: 'treeseed-api',
		TREESEED_TREEDX_PROXY_TENANT_ID: 'treeseed-control-plane',
		TREESEED_SMTP_HOST: '127.0.0.1',
		TREESEED_SMTP_PORT: '1025',
		TREESEED_SMTP_USERNAME: '',
		TREESEED_SMTP_PASSWORD: '',
		TREESEED_SMTP_FROM: 'TreeSeed Local <noreply@treeseed.local>',
		TREESEED_SMTP_REPLY_TO: 'noreply@treeseed.local',
		TREESEED_MAILPIT_SMTP_HOST: '127.0.0.1',
		TREESEED_MAILPIT_SMTP_PORT: '1025',
		TREESEED_MAILPIT_UI_URL: 'http://127.0.0.1:8025',
		TREESEED_PLATFORM_RUNNER_ID: 'treeseed-ops-local-1',
		TREESEED_PLATFORM_RUNNER_SECRET: 'treeseed-platform-runner-dev-secret',
		TREESEED_PLATFORM_RUNNER_ENVIRONMENT: 'local',
		TREESEED_ENVIRONMENT: 'local',
		TREESEED_API_ENVIRONMENT: 'local',
		LOCAL_DEV_MODE: '1',
	};
}

function localWebEnvironment(apiPort: number) {
	const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
	return {
		TREESEED_MARKET_API_BASE_URL: apiBaseUrl,
		TREESEED_CENTRAL_MARKET_API_BASE_URL: apiBaseUrl,
		TREESEED_API_BASE_URL: apiBaseUrl,
		TREESEED_CAPACITY_ACCEPTANCE_API_URL: apiBaseUrl,
		TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN: 'tsk_local_treeseed_acceptance_admin',
		TREESEED_CAPACITY_ACCEPTANCE_AGENT_CLASS_ID: 'planning',
		TREESEED_CAPACITY_ACCEPTANCE_ENVIRONMENT: 'local',
		TREESEED_API_WEB_SERVICE_ID: 'web',
		TREESEED_API_WEB_SERVICE_SECRET: 'treeseed-web-service-dev-secret',
		TREESEED_API_WEB_ASSERTION_SECRET: 'treeseed-web-assertion-dev-secret',
		TREESEED_SMTP_HOST: '127.0.0.1',
		TREESEED_SMTP_PORT: '1025',
		TREESEED_SMTP_USERNAME: '',
		TREESEED_SMTP_PASSWORD: '',
		TREESEED_SMTP_FROM: 'TreeSeed Local <noreply@treeseed.local>',
		TREESEED_SMTP_REPLY_TO: 'noreply@treeseed.local',
		TREESEED_MAILPIT_SMTP_HOST: '127.0.0.1',
		TREESEED_MAILPIT_SMTP_PORT: '1025',
		TREESEED_MAILPIT_UI_URL: 'http://127.0.0.1:8025',
		TREESEED_ENVIRONMENT: 'local',
		LOCAL_DEV_MODE: '1',
	};
}

export function buildManagedDevProcessSpec(input: {
	tenantRoot: string;
	stateDir: string;
	logDir: string;
	surface: string;
	options: ManagedDevOptions;
}): ManagedDevProcessSpec {
	const host = input.options.webHost ?? '127.0.0.1';
	const webPort = input.options.webPort ?? 4321;
	const apiHost = input.options.apiHost ?? '0.0.0.0';
	const apiPort = input.options.apiPort ?? 3000;
	const id = input.surface === 'operations-runner' ? 'operations-runner' : input.surface;
	const logPath = resolve(input.logDir, `${id}.log`);
	const pidPath = resolve(input.stateDir, 'pids', `${id}.pid`);
	const instancePath = resolve(input.stateDir, 'instances', `${id}.json`);
	const env = Object.fromEntries(
		Object.entries(input.options.env ?? {})
			.filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
	);
	const sourceClosureDigest = managedDevSourceClosureDigest({
		tenantRoot: input.tenantRoot,
		surface: input.surface,
	});
	if (input.surface === 'api') {
		return {
			id,
			surface: input.surface,
			...apiCommand(input.tenantRoot, 'api'),
			env: { ...localApiEnvironment(apiPort), ...env, HOST: apiHost, PORT: String(apiPort) },
			port: apiPort,
			health: [{ id: 'api', kind: 'http', url: `http://${apiHost}:${apiPort}/healthz` }],
			logPath,
			pidPath,
			instancePath,
			sourceClosureDigest,
		};
	}
	if (input.surface === 'operations-runner') {
		const runnerPort = Number(env.TREESEED_OPERATIONS_RUNNER_PORT ?? 3001);
		return {
			id,
			surface: input.surface,
			...apiCommand(input.tenantRoot, 'runner'),
			env: { ...localApiEnvironment(apiPort), ...env, PORT: String(runnerPort) },
			port: runnerPort,
			health: [{ id: 'operations-runner', kind: 'http', url: `http://127.0.0.1:${runnerPort}/readyz`, timeoutMs: 10_000 }],
			logPath,
			pidPath,
			instancePath,
			sourceClosureDigest,
		};
	}
	const webRuntime = input.options.webRuntime ?? 'local';
	const tenantAstroCommand = `./packages/sdk/scripts/tenant-astro-command.${'ts'}`;
	const webArgs = webRuntime === 'provider'
		? ['--host', host, '--port', String(webPort)]
		: ['dev', '--host', host, '--port', String(webPort)];
	const command = webRuntime === 'provider'
		? scriptCommand(input.tenantRoot, 'build:web', [])
		: {
			command: process.execPath,
			args: ['--import', 'tsx', tenantAstroCommand, ...webArgs],
			cwd: input.tenantRoot,
		};
	return {
		id: 'web',
		surface: 'web',
		...command,
		env: { ...localWebEnvironment(apiPort), ...env },
		port: webPort,
		health: [{ id: 'web', kind: 'http', url: `http://${host}:${webPort}` }],
		logPath,
		pidPath,
		instancePath,
		sourceClosureDigest,
	};
}
