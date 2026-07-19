import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildManagedDevProcessSpec } from './managed-dev-process-spec.ts';

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
	sourceClosureDigest: string | null;
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
	startedSourceClosureDigest: string | null;
	sourceClosureMatches: boolean;
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

function portListenerPids(port: number | null | undefined) {
	if (!port || !Number.isFinite(port)) return [];
	try {
		const output = execFileSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN', '-n', '-P'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		return output
			.split(/\r?\n/u)
			.map((entry) => Number(entry.trim()))
			.filter((pid) => Number.isInteger(pid) && pid > 0);
	} catch {
		return [];
	}
}

async function waitForPidsToExit(pids: number[], timeoutMs = 3_000) {
	const startedAt = Date.now();
	while (pids.some((pid) => pidAlive(pid)) && Date.now() - startedAt < timeoutMs) {
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
}

function processGroupAlive(pid: number) {
	if (process.platform === 'win32') return pidAlive(pid);
	try {
		process.kill(-pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function terminateManagedProcess(pid: number) {
	const signal = (value: NodeJS.Signals) => {
		try {
			process.kill(process.platform === 'win32' ? pid : -pid, value);
		} catch {
			// The managed process group may already have exited.
		}
	};
	signal('SIGTERM');
	const startedAt = Date.now();
	while (processGroupAlive(pid) && Date.now() - startedAt < 3_000) {
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	if (processGroupAlive(pid)) {
		signal('SIGKILL');
	}
}

async function stopConflictingPortListeners(spec: TreeseedManagedDevProcessSpec, allowedPid: number | null = null) {
	const conflicts = portListenerPids(spec.port)
		.filter((pid) => pid !== process.pid && pid !== allowedPid);
	if (conflicts.length === 0) return [];
	for (const pid of conflicts) {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {
			// Process may have exited between lsof and termination.
		}
	}
	await waitForPidsToExit(conflicts);
	const remaining = conflicts.filter((pid) => pidAlive(pid));
	for (const pid of remaining) {
		try {
			process.kill(pid, 'SIGKILL');
		} catch {
			// Process may have exited between checks.
		}
	}
	await waitForPidsToExit(remaining, 1_000);
	return conflicts;
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
		sourceClosureDigest: spec.sourceClosureDigest,
		pid,
		startedAt: new Date().toISOString(),
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
		processes: surfaces.map((surface) => buildManagedDevProcessSpec({ tenantRoot, stateDir, logDir, surface, options })),
	};
}

function instanceFromSpec(spec: TreeseedManagedDevProcessSpec): TreeseedDevInstance {
	const pid = existsSync(spec.pidPath) ? Number(readFileSync(spec.pidPath, 'utf8').trim()) : null;
	const record = readJson(spec.instancePath);
	const startedSourceClosureDigest = typeof record?.sourceClosureDigest === 'string'
		? record.sourceClosureDigest
		: null;
	return {
		...spec,
		pid: Number.isFinite(pid) ? pid : null,
		running: Number.isFinite(pid) ? processGroupAlive(pid as number) : false,
		startedAt: typeof record?.startedAt === 'string' ? record.startedAt : null,
		startedSourceClosureDigest,
		sourceClosureMatches: spec.sourceClosureDigest === startedSourceClosureDigest,
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
	const running = healthStatus.length > 0 ? instance.running && healthy : instance.running;
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

async function stopSpec(spec: TreeseedManagedDevProcessSpec) {
	const instance = instanceFromSpec(spec);
	if (instance.pid && instance.running) {
		await terminateManagedProcess(instance.pid);
	}
	rmSync(spec.pidPath, { force: true });
	rmSync(spec.instancePath, { force: true });
	return instance;
}

async function startSpec(spec: TreeseedManagedDevProcessSpec, force = false, forceConflicts = false) {
	const existingProcess = instanceFromSpec(spec);
	const existing = await instanceFromSpecWithHealth(spec);
	if (existing.running && existing.sourceClosureMatches && !force) {
		return existing;
	}
	if (existingProcess.running) {
		await stopSpec(spec);
	}
	if (forceConflicts) {
		await stopConflictingPortListeners(spec, existing.pid);
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
		await startSpec(spec, options.force === true, options.forceConflicts === true);
		instances.push(await waitForHealthySpec(spec));
	}
	return { ok: instances.every((entry) => entry.running && entry.sourceClosureMatches), action: 'start', plan, instances };
}

export async function stopTreeseedManagedDev(options: TreeseedManagedDevOptions = {}): Promise<TreeseedManagedDevResult> {
	const plan = createTreeseedIntegratedDevPlan(options);
	const instances = await Promise.all(plan.processes.map((spec) => stopSpec(spec)));
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
		ok: action === 'logs' ? true : instances.every((entry) => entry.running && entry.sourceClosureMatches),
		action,
		plan,
		instances,
		output: logs ? JSON.stringify(logs) : undefined,
	};
}
