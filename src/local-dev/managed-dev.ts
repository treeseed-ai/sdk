import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, openSync } from 'node:fs';
import { resolve } from 'node:path';

export type TreeseedManagedDevSurface = 'web' | 'api' | 'operations-runner' | string;
export type TreeseedManagedDevAction = 'start' | 'status' | 'logs' | 'stop' | 'restart';

export type TreeseedManagedDevProcessSpec = {
	id: string;
	surface: TreeseedManagedDevSurface;
	cwd: string;
	command: string;
	args: string[];
	env: Record<string, string>;
	port?: number | null;
	health?: Array<{ id: string; kind: 'http'; url: string; timeoutMs?: number }>;
	logPath: string;
	pidPath: string;
	instancePath: string;
};

export type TreeseedIntegratedDevPlan = {
	tenantRoot: string;
	scopeId: string;
	worktreeRoot: string;
	stateDir: string;
	logDir: string;
	processes: TreeseedManagedDevProcessSpec[];
};

export type TreeseedManagedDevOptions = {
	action?: TreeseedManagedDevAction;
	cwd?: string;
	surfaces?: string;
	webRuntime?: 'auto' | 'provider' | 'local';
	webHost?: string;
	webPort?: number;
	apiHost?: string;
	apiPort?: number;
	force?: boolean;
	forceConflicts?: boolean;
	all?: boolean;
	follow?: boolean;
	json?: boolean;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

export type TreeseedDevInstance = TreeseedManagedDevProcessSpec & {
	pid: number | null;
	running: boolean;
	healthStatus?: Array<{ id: string; ok: boolean; status: number | null; url: string; error?: string }>;
	startedAt?: string | null;
};

export type TreeseedManagedDevResult = {
	ok: boolean;
	action: TreeseedManagedDevAction;
	plan: TreeseedIntegratedDevPlan;
	instances: TreeseedDevInstance[];
	output?: string;
};

export type TreeseedDevLogReadResult = {
	logs: Array<{ id: string; path: string; content: string }>;
};

function splitSurfaces(value: string | undefined) {
	return (value ?? 'web,api')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function pidAlive(pid: number | null | undefined) {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function scopeId(tenantRoot: string) {
	return Buffer.from(tenantRoot).toString('base64url').slice(0, 32);
}

function readJson(path: string) {
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function redactedEnvShape(env: Record<string, string>) {
	return Object.fromEntries(Object.keys(env).sort().map((key) => [key, key === 'PATH' || key === 'NODE_ENV' ? env[key] : '<redacted>']));
}

function persistedInstanceRecord(spec: TreeseedManagedDevProcessSpec, pid: number | null) {
	return {
		id: spec.id,
		surface: spec.surface,
		cwd: spec.cwd,
		command: spec.command,
		args: spec.args,
		redactedEnv: redactedEnvShape(spec.env),
		envKeys: Object.keys(spec.env).sort(),
		port: spec.port ?? null,
		health: spec.health ?? [],
		logPath: spec.logPath,
		pidPath: spec.pidPath,
		instancePath: spec.instancePath,
		pid,
		startedAt: new Date().toISOString(),
	};
}

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
		TREESEED_CAPACITY_ACCEPTANCE_TEAM_ID: 'd8a613c2-bbdb-4474-9c96-31e985beafd4',
		TREESEED_CAPACITY_ACCEPTANCE_PROJECT_ID: '90764af2-5a13-42b9-a2fa-fb3af5882323',
		TREESEED_CAPACITY_ACCEPTANCE_PROVIDER_ID: 'ff48ce97-6959-46b5-be9f-9b7062161fe3',
		TREESEED_CAPACITY_ACCEPTANCE_AGENT_CLASS_ID: 'planning',
		TREESEED_CAPACITY_ACCEPTANCE_ENVIRONMENT: 'local',
		TREESEED_CAPACITY_PROVIDER_API_KEY: 'tsp_local_treeseed_demo_capacity_provider',
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
		TREESEED_PLATFORM_RUNNER_ID: 'treeseed-ops-local-1',
		TREESEED_PLATFORM_RUNNER_SECRET: 'treeseed-platform-runner-dev-secret',
		TREESEED_PLATFORM_RUNNER_ENVIRONMENT: 'local',
		TREESEED_ENVIRONMENT: 'local',
		TREESEED_API_ENVIRONMENT: 'local',
		TREESEED_LOCAL_DEV_MODE: '1',
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
		TREESEED_CAPACITY_ACCEPTANCE_TEAM_ID: 'd8a613c2-bbdb-4474-9c96-31e985beafd4',
		TREESEED_CAPACITY_ACCEPTANCE_PROJECT_ID: '90764af2-5a13-42b9-a2fa-fb3af5882323',
		TREESEED_CAPACITY_ACCEPTANCE_PROVIDER_ID: 'ff48ce97-6959-46b5-be9f-9b7062161fe3',
		TREESEED_CAPACITY_ACCEPTANCE_AGENT_CLASS_ID: 'planning',
		TREESEED_CAPACITY_ACCEPTANCE_ENVIRONMENT: 'local',
		TREESEED_CAPACITY_PROVIDER_API_KEY: 'tsp_local_treeseed_demo_capacity_provider',
		TREESEED_API_WEB_SERVICE_ID: 'web',
		TREESEED_API_WEB_SERVICE_SECRET: 'treeseed-web-service-dev-secret',
		TREESEED_API_WEB_ASSERTION_SECRET: 'treeseed-web-assertion-dev-secret',
		TREESEED_ENVIRONMENT: 'local',
		TREESEED_LOCAL_DEV_MODE: '1',
	};
}

function processSpec(input: {
	tenantRoot: string;
	stateDir: string;
	logDir: string;
	surface: string;
	options: TreeseedManagedDevOptions;
}): TreeseedManagedDevProcessSpec {
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
	if (input.surface === 'api') {
		const command = apiCommand(input.tenantRoot, 'api');
		return {
			id,
			surface: input.surface,
			...command,
			env: { ...localApiEnvironment(apiPort), ...env, HOST: apiHost, PORT: String(apiPort) },
			port: apiPort,
			health: [{ id: 'api', kind: 'http', url: `http://${apiHost}:${apiPort}/healthz` }],
			logPath,
			pidPath,
			instancePath,
		};
	}
	if (input.surface === 'operations-runner') {
		const runnerPort = Number(env.TREESEED_OPERATIONS_RUNNER_PORT ?? 3001);
		const command = apiCommand(input.tenantRoot, 'runner');
		return {
			id,
			surface: input.surface,
			...command,
			env: { ...localApiEnvironment(apiPort), ...env, PORT: String(runnerPort) },
			port: runnerPort,
			health: [{ id: 'operations-runner', kind: 'http', url: `http://127.0.0.1:${runnerPort}/readyz` }],
			logPath,
			pidPath,
			instancePath,
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
	};
}

export function createTreeseedIntegratedDevPlan(options: TreeseedManagedDevOptions = {}): TreeseedIntegratedDevPlan {
	const tenantRoot = resolve(options.cwd ?? process.cwd());
	const id = scopeId(tenantRoot);
	const stateDir = resolve(tenantRoot, '.treeseed', 'dev');
	const logDir = resolve(tenantRoot, '.treeseed', 'logs', 'dev');
	const surfaces = splitSurfaces(options.surfaces);
	return {
		tenantRoot,
		scopeId: id,
		worktreeRoot: tenantRoot,
		stateDir,
		logDir,
		processes: surfaces.map((surface) => processSpec({ tenantRoot, stateDir, logDir, surface, options })),
	};
}

function instanceFromSpec(spec: TreeseedManagedDevProcessSpec): TreeseedDevInstance {
	const pid = existsSync(spec.pidPath) ? Number(readFileSync(spec.pidPath, 'utf8').trim()) : null;
	const record = readJson(spec.instancePath);
	return {
		...spec,
		pid: Number.isFinite(pid) ? pid : null,
		running: pidAlive(Number.isFinite(pid) ? pid : null),
		startedAt: typeof record?.startedAt === 'string' ? record.startedAt : null,
	};
}

async function checkHealth(spec: TreeseedManagedDevProcessSpec) {
	const checks = spec.health ?? [];
	return Promise.all(checks.map(async (check) => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), check.timeoutMs ?? 2_000);
		try {
			const response = await fetch(check.url, { signal: controller.signal });
			return { id: check.id, ok: response.ok, status: response.status, url: check.url };
		} catch (error) {
			return {
				id: check.id,
				ok: false,
				status: null,
				url: check.url,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			clearTimeout(timeout);
		}
	}));
}

async function instanceFromSpecWithHealth(spec: TreeseedManagedDevProcessSpec): Promise<TreeseedDevInstance> {
	const instance = instanceFromSpec(spec);
	const healthStatus = await checkHealth(spec);
	const healthy = healthStatus.length === 0 || healthStatus.every((entry) => entry.ok);
	const running = healthStatus.length > 0 ? healthy : instance.running;
	return {
		...instance,
		healthStatus,
		running,
	};
}

export function readTreeseedDevInstance(input: { cwd?: string; surface?: string } = {}) {
	const plan = createTreeseedIntegratedDevPlan({ cwd: input.cwd, surfaces: input.surface ?? 'web,api,operations-runner' });
	const match = plan.processes.find((process) => !input.surface || process.surface === input.surface || process.id === input.surface);
	return match ? instanceFromSpec(match) : null;
}

export function listTreeseedDevInstances(input: { cwd?: string; all?: boolean } = {}) {
	const plan = createTreeseedIntegratedDevPlan({ cwd: input.cwd, surfaces: 'web,api,operations-runner' });
	const instanceDir = resolve(plan.stateDir, 'instances');
	if (!existsSync(instanceDir)) return [];
	return readdirSync(instanceDir)
		.filter((entry) => entry.endsWith('.json'))
		.map((entry) => entry.slice(0, -'.json'.length))
		.map((surface) => readTreeseedDevInstance({ cwd: input.cwd, surface }))
		.filter((entry): entry is TreeseedDevInstance => Boolean(entry));
}

function stopSpec(spec: TreeseedManagedDevProcessSpec) {
	const instance = instanceFromSpec(spec);
	if (instance.pid && instance.running) {
		try {
			process.kill(instance.pid, 'SIGTERM');
		} catch {
			// Process may have exited between status and stop.
		}
	}
	rmSync(spec.pidPath, { force: true });
	rmSync(spec.instancePath, { force: true });
	return instance;
}

async function startSpec(spec: TreeseedManagedDevProcessSpec, force = false) {
	const existing = instanceFromSpec(spec);
	if (existing.running && !force) {
		return existing;
	}
	if (existing.running && force) {
		stopSpec(spec);
	}
	mkdirSync(resolve(spec.pidPath, '..'), { recursive: true });
	mkdirSync(resolve(spec.instancePath, '..'), { recursive: true });
	mkdirSync(resolve(spec.logPath, '..'), { recursive: true });
	appendFileSync(spec.logPath, `\n[treeseed-dev] starting ${spec.id} ${new Date().toISOString()}\n`, 'utf8');
	const logFd = openSync(spec.logPath, 'a');
	const child = spawn(spec.command, spec.args, {
		cwd: spec.cwd,
		env: { ...process.env, ...spec.env },
		detached: true,
		stdio: ['ignore', logFd, logFd],
	});
	closeSync(logFd);
	child.unref();
	writeFileSync(spec.pidPath, String(child.pid ?? ''), 'utf8');
	writeFileSync(spec.instancePath, `${JSON.stringify(persistedInstanceRecord(spec, child.pid ?? null), null, 2)}\n`, 'utf8');
	return instanceFromSpec(spec);
}

async function waitForHealthySpec(spec: TreeseedManagedDevProcessSpec, timeoutMs = 90_000) {
	const startedAt = Date.now();
	let instance = await instanceFromSpecWithHealth(spec);
	while (!instance.running && Date.now() - startedAt < timeoutMs) {
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
		instance = await instanceFromSpecWithHealth(spec);
	}
	return instance;
}

export async function startTreeseedManagedDev(options: TreeseedManagedDevOptions = {}): Promise<TreeseedManagedDevResult> {
	const plan = createTreeseedIntegratedDevPlan(options);
	const instances = [];
	for (const spec of plan.processes) {
		await startSpec(spec, options.force === true);
		instances.push(await waitForHealthySpec(spec));
	}
	return { ok: instances.every((entry) => entry.running), action: 'start', plan, instances };
}

export async function stopTreeseedManagedDev(options: TreeseedManagedDevOptions = {}): Promise<TreeseedManagedDevResult> {
	const plan = createTreeseedIntegratedDevPlan(options);
	const instances = plan.processes.map((spec) => stopSpec(spec));
	return { ok: true, action: 'stop', plan, instances };
}

export function stopTreeseedDevInstance(options: Omit<TreeseedManagedDevOptions, 'action'> = {}) {
	return stopTreeseedManagedDev(options);
}

export async function restartTreeseedManagedDev(options: TreeseedManagedDevOptions = {}): Promise<TreeseedManagedDevResult> {
	await stopTreeseedManagedDev(options);
	const result = await startTreeseedManagedDev({ ...options, force: true });
	return { ...result, action: 'restart' };
}

export function readTreeseedDevLogs(options: TreeseedManagedDevOptions = {}): TreeseedDevLogReadResult {
	const plan = createTreeseedIntegratedDevPlan(options);
	return {
		logs: plan.processes.map((spec) => ({
			id: spec.id,
			path: spec.logPath,
			content: existsSync(spec.logPath) ? readFileSync(spec.logPath, 'utf8') : '',
		})),
	};
}

export async function runTreeseedManagedDev(options: TreeseedManagedDevOptions): Promise<TreeseedManagedDevResult> {
	const action = options.action ?? 'status';
	if (action === 'start') return startTreeseedManagedDev(options);
	if (action === 'stop') return stopTreeseedManagedDev(options);
	if (action === 'restart') return restartTreeseedManagedDev(options);
	const plan = createTreeseedIntegratedDevPlan(options);
	const instances = await Promise.all(plan.processes.map((spec) => instanceFromSpecWithHealth(spec)));
	const logs = action === 'logs' ? readTreeseedDevLogs(options) : undefined;
	return {
		ok: action === 'logs' ? true : instances.every((entry) => entry.running),
		action,
		plan,
		instances,
		output: logs ? JSON.stringify(logs) : undefined,
	};
}
