import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
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

function apiCommand(tenantRoot: string, script: string) {
	return {
		command: 'npm',
		args: ['-w', 'packages/api', 'run', script],
		cwd: tenantRoot,
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
	const apiHost = input.options.apiHost ?? '127.0.0.1';
	const apiPort = input.options.apiPort ?? 8787;
	const id = input.surface === 'operations-runner' ? 'operations-runner' : input.surface;
	const logPath = resolve(input.logDir, `${id}.log`);
	const pidPath = resolve(input.stateDir, 'pids', `${id}.pid`);
	const instancePath = resolve(input.stateDir, 'instances', `${id}.json`);
	const env = Object.fromEntries(
		Object.entries(input.options.env ?? {})
			.filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
	);
	if (input.surface === 'api') {
		const command = apiCommand(input.tenantRoot, 'dev:api');
		return {
			id,
			surface: input.surface,
			...command,
			env: { ...env, HOST: apiHost, PORT: String(apiPort) },
			port: apiPort,
			health: [{ id: 'api', kind: 'http', url: `http://${apiHost}:${apiPort}/health` }],
			logPath,
			pidPath,
			instancePath,
		};
	}
	if (input.surface === 'operations-runner') {
		const command = apiCommand(input.tenantRoot, 'dev:runner');
		return {
			id,
			surface: input.surface,
			...command,
			env,
			port: null,
			health: [],
			logPath,
			pidPath,
			instancePath,
		};
	}
	const webRuntime = input.options.webRuntime ?? 'local';
	const webArgs = webRuntime === 'provider'
		? ['--host', host, '--port', String(webPort)]
		: ['dev', '--host', host, '--port', String(webPort)];
	const command = webRuntime === 'provider'
		? scriptCommand(input.tenantRoot, 'build:web', [])
		: {
			command: process.execPath,
			args: ['./packages/sdk/scripts/run-ts.mjs', './packages/sdk/scripts/tenant-astro-command.ts', ...webArgs],
			cwd: input.tenantRoot,
		};
	return {
		id: 'web',
		surface: 'web',
		...command,
		env,
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
	const child = spawn(spec.command, spec.args, {
		cwd: spec.cwd,
		env: { ...process.env, ...spec.env },
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	child.stdout?.on('data', (chunk) => appendFileSync(spec.logPath, chunk));
	child.stderr?.on('data', (chunk) => appendFileSync(spec.logPath, chunk));
	child.unref();
	writeFileSync(spec.pidPath, String(child.pid ?? ''), 'utf8');
	writeFileSync(spec.instancePath, `${JSON.stringify(persistedInstanceRecord(spec, child.pid ?? null), null, 2)}\n`, 'utf8');
	return instanceFromSpec(spec);
}

export async function startTreeseedManagedDev(options: TreeseedManagedDevOptions = {}): Promise<TreeseedManagedDevResult> {
	const plan = createTreeseedIntegratedDevPlan(options);
	const instances = [];
	for (const spec of plan.processes) {
		instances.push(await startSpec(spec, options.force === true));
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
	const instances = plan.processes.map((spec) => instanceFromSpec(spec));
	const logs = action === 'logs' ? readTreeseedDevLogs(options) : undefined;
	return {
		ok: action === 'logs' ? true : instances.every((entry) => entry.running),
		action,
		plan,
		instances,
		output: logs ? JSON.stringify(logs) : undefined,
	};
}
