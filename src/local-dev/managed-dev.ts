import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { discoverTreeseedPackageAdapters, type TreeseedPackageAdapter } from '../operations/services/package-adapters.ts';

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
	setup: TreeseedManagedDevSetup;
	processes: TreeseedManagedDevProcessSpec[];
};

export type TreeseedManagedDevSetup = {
	apiPackageRoot: string | null;
	apiPackageRelativeDir: string | null;
	apiPackageId: string | null;
	localDev: Record<string, unknown>;
	services: Record<string, unknown>;
	database: {
		managed: boolean;
		host: string;
		port: string;
		url: string;
		urlEnv: string;
		compatibilityUrlEnv: string | null;
		containerName: string;
		volumeName: string;
		user: string;
		password: string;
		database: string;
	} | null;
	migrations: {
		command: string;
		args: string[];
		cwd: string;
	} | null;
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
	reset?: boolean;
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

function sleep(ms: number) {
	return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function childProcessMap() {
	try {
		const output = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
		const children = new Map<number, number[]>();
		for (const line of output.split('\n')) {
			const [pidText, ppidText] = line.trim().split(/\s+/u);
			const pid = Number(pidText);
			const ppid = Number(ppidText);
			if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
			const entries = children.get(ppid) ?? [];
			entries.push(pid);
			children.set(ppid, entries);
		}
		return children;
	} catch {
		return new Map<number, number[]>();
	}
}

function processTreePids(rootPid: number) {
	const children = childProcessMap();
	const result = new Set<number>();
	const visit = (pid: number) => {
		if (result.has(pid)) return;
		result.add(pid);
		for (const child of children.get(pid) ?? []) {
			visit(child);
		}
	};
	visit(rootPid);
	return [...result].sort((a, b) => b - a);
}

function terminatePidTree(pid: number) {
	if (!pidAlive(pid)) return;
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		// The process may not be a group leader; fall back to explicit tree traversal.
	}
	for (const entry of processTreePids(pid)) {
		try {
			process.kill(entry, 'SIGTERM');
		} catch {
			// Process may have exited between tree collection and termination.
		}
	}
}

async function waitForPidTreeExit(pid: number, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!pidAlive(pid) && processTreePids(pid).every((entry) => !pidAlive(entry))) {
			return true;
		}
		await sleep(100);
	}
	return false;
}

function forceKillPidTree(pid: number) {
	for (const entry of processTreePids(pid)) {
		try {
			process.kill(entry, 'SIGKILL');
		} catch {
			// Process may have exited after the graceful stop attempt.
		}
	}
	try {
		process.kill(pid, 'SIGKILL');
	} catch {
		// Process may already be gone.
	}
}

function procCommandLine(pid: number) {
	try {
		return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/gu, ' ').trim();
	} catch {
		return '';
	}
}

function procCwdLink(pid: number) {
	try {
		return resolve(readlinkSync(`/proc/${pid}/cwd`));
	} catch {
		return null;
	}
}

function ownedDevCommand(command: string) {
	return /tenant-astro-command\.ts|astro\.js dev|npm .* (-w|--workspace) packages\/api .* dev:(api|runner)|npm .* run dev:(api|runner)/u.test(command);
}

function ownedDevProcessPids(tenantRoot: string) {
	const root = resolve(tenantRoot);
	const pids: number[] = [];
	if (!existsSync('/proc')) return pids;
	for (const entry of readdirSync('/proc')) {
		if (!/^\d+$/u.test(entry)) continue;
		const pid = Number(entry);
		if (!Number.isFinite(pid) || pid === process.pid) continue;
		const command = procCommandLine(pid);
		const cwd = procCwdLink(pid);
		if (!ownedDevCommand(command)) continue;
		if (!command.includes(root) && (!cwd || !cwd.startsWith(root))) continue;
		pids.push(pid);
	}
	return [...new Set(pids)].sort((a, b) => b - a);
}

async function stopOwnedDevProcesses(tenantRoot: string) {
	for (const pid of ownedDevProcessPids(tenantRoot)) {
		terminatePidTree(pid);
		if (!await waitForPidTreeExit(pid)) {
			forceKillPidTree(pid);
		}
	}
}

function portOwnerPids(port: number) {
	try {
		const output = execFileSync('ss', ['-ltnp', `sport = :${port}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
		return [...output.matchAll(/pid=(\d+)/gu)]
			.map((match) => Number(match[1]))
			.filter((pid) => Number.isFinite(pid));
	} catch {
		return [];
	}
}

function runDocker(args: string[], timeout = 30_000) {
	return spawnSync('docker', args, { encoding: 'utf8', stdio: 'pipe', timeout });
}

function resultText(result: ReturnType<typeof spawnSync>) {
	return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function ensureManagedPostgres(database: NonNullable<TreeseedManagedDevSetup['database']>) {
	if (!database.managed) return;
	const inspect = runDocker(['inspect', database.containerName]);
	if ((inspect.status ?? 1) !== 0) {
		const run = runDocker([
			'run',
			'-d',
			'--name',
			database.containerName,
			'-e',
			`POSTGRES_USER=${database.user}`,
			'-e',
			`POSTGRES_PASSWORD=${database.password}`,
			'-e',
			`POSTGRES_DB=${database.database}`,
			'-p',
			`${database.host}:${database.port}:5432`,
			'-v',
			`${database.volumeName}:/var/lib/postgresql/data`,
			'postgres:16',
		], 60_000);
		if ((run.status ?? 1) !== 0) {
			throw new Error(resultText(run) || `Unable to start ${database.containerName}.`);
		}
	} else {
		const start = runDocker(['start', database.containerName]);
		if ((start.status ?? 1) !== 0) {
			throw new Error(resultText(start) || `Unable to start ${database.containerName}.`);
		}
	}
	const deadline = Date.now() + 45_000;
	let last = '';
	while (Date.now() < deadline) {
		const ready = runDocker(['exec', database.containerName, 'pg_isready', '-U', database.user, '-d', database.database], 5_000);
		last = resultText(ready);
		if ((ready.status ?? 1) === 0) return;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
	}
	throw new Error(last || `Timed out waiting for ${database.containerName}.`);
}

function resetManagedPostgres(database: NonNullable<TreeseedManagedDevSetup['database']>) {
	if (!database.managed) return;
	runDocker(['rm', '-f', database.containerName]);
	runDocker(['volume', 'rm', '-f', database.volumeName]);
}

function runMigrations(setup: TreeseedManagedDevSetup) {
	if (!setup.migrations || !setup.database) return;
	const env = {
		...process.env,
		[setup.database.urlEnv]: setup.database.url,
		...(setup.database.compatibilityUrlEnv ? { [setup.database.compatibilityUrlEnv]: setup.database.url } : {}),
	};
	const result = spawnSync(setup.migrations.command, setup.migrations.args, {
		cwd: setup.migrations.cwd,
		env,
		encoding: 'utf8',
		stdio: 'pipe',
		timeout: 120_000,
	});
	if ((result.status ?? 1) !== 0) {
		throw new Error(resultText(result) || 'API database migrations failed.');
	}
}

function prepareManagedDevSetup(plan: TreeseedIntegratedDevPlan, options: TreeseedManagedDevOptions) {
	const needsApi = plan.processes.some((process) => process.surface === 'api' || process.surface === 'operations-runner');
	const ownsApiRuntime = plan.processes.some((process) => process.surface === 'api');
	if (!needsApi || !plan.setup.database) return;
	const ownsApiPackagePostgres = plan.setup.apiPackageId === '@treeseed/api'
		&& existsSync(resolve(plan.tenantRoot, 'packages', 'api', 'compose.postgres.yml'));
	if (options.reset && ownsApiRuntime) {
		if (ownsApiPackagePostgres) {
			resetApiPostgres(plan);
		} else {
			resetManagedPostgres(plan.setup.database);
		}
	}
	if (ownsApiPackagePostgres) {
		ensureApiPostgres(plan);
	} else {
		ensureManagedPostgres(plan.setup.database);
	}
	runMigrations(plan.setup);
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

function recordValue(value: unknown) {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function worktreeScopedNumber(seed: string, modulo: number) {
	let value = 0;
	for (const char of seed) {
		value = (value * 31 + char.charCodeAt(0)) % modulo;
	}
	return value;
}

function worktreeScopedPort(defaultPort: number, tenantRoot: string) {
	return defaultPort + (worktreeScopedNumber(scopeId(tenantRoot), 100) * 10);
}

function stringArray(value: unknown) {
	return Array.isArray(value) ? value.map((entry) => stringValue(entry)).filter((entry): entry is string => Boolean(entry)) : [];
}

function localDevMetadata(adapter: TreeseedPackageAdapter) {
	return recordValue(adapter.metadata.localDev);
}

function localDevServices(adapter: TreeseedPackageAdapter) {
	return recordValue(localDevMetadata(adapter).services);
}

function hasLocalDevService(adapter: TreeseedPackageAdapter, serviceId: string) {
	return Object.keys(recordValue(localDevServices(adapter)[serviceId])).length > 0;
}

function discoverApiLocalDevPackage(tenantRoot: string) {
	const adapters = discoverTreeseedPackageAdapters(tenantRoot);
	const matches = adapters.filter((adapter) => hasLocalDevService(adapter, 'api') || hasLocalDevService(adapter, 'operationsRunner'));
	const apiAdapter = adapters.find((entry) => entry.id === '@treeseed/api') ?? null;
	const adapter = matches.find((entry) => entry.id === '@treeseed/api')
		?? matches.find((entry) => hasLocalDevService(entry, 'api'))
		?? matches[0]
		?? apiAdapter
		?? null;
	if (!adapter) {
		return {
			packageId: '@treeseed/api',
			packageRoot: resolve(tenantRoot, 'packages', 'api'),
			packageRelativeDir: 'packages/api',
			localDev: {},
			services: {
				api: { script: 'dev:api', healthPath: '/healthz' },
				operationsRunner: { script: 'dev:runner' },
			},
		};
	}
	const services = localDevServices(adapter);
	return {
		packageId: adapter.id,
		packageRoot: adapter.dir,
		packageRelativeDir: adapter.relativeDir,
		localDev: localDevMetadata(adapter),
		services: Object.keys(services).length > 0
			? services
			: {
				api: { script: 'dev:api', healthPath: '/healthz' },
				operationsRunner: { script: 'dev:runner' },
			},
	};
}

function apiLocalDevSetup(tenantRoot: string, options: TreeseedManagedDevOptions): TreeseedManagedDevSetup {
	const apiPackage = discoverApiLocalDevPackage(tenantRoot);
	if (!apiPackage) {
		return {
			apiPackageRoot: null,
			apiPackageRelativeDir: null,
			apiPackageId: null,
			localDev: {},
			services: {},
			database: null,
			migrations: null,
		};
	}
	const env = recordValue(options.env);
	const database = recordValue(apiPackage.localDev.database);
	const migrations = recordValue(apiPackage.localDev.migrations);
	const managed = database.managed !== false;
	const host = stringValue(database.host) ?? '127.0.0.1';
	const portEnv = stringValue(database.portEnv) ?? 'TREESEED_MARKET_LOCAL_POSTGRES_PORT';
	const urlEnv = stringValue(database.urlEnv) ?? 'TREESEED_DATABASE_URL';
	const compatibilityUrlEnv = stringValue(database.compatibilityUrlEnv);
	const defaultPort = numberValue(database.defaultPort) ?? 55432;
	const port = stringValue(env[portEnv]) ?? String(worktreeScopedPort(defaultPort, tenantRoot));
	const user = stringValue(database.user) ?? 'treeseed';
	const password = stringValue(database.password) ?? 'treeseed';
	const dbName = stringValue(database.database) ?? 'market_local';
	const configuredUrl = stringValue(env[urlEnv]) ?? (compatibilityUrlEnv ? stringValue(env[compatibilityUrlEnv]) : null);
	const url = configuredUrl ?? `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
	const scopedId = scopeId(tenantRoot);
	const baseContainerName = stringValue(database.containerName) ?? 'treeseed-market-local-postgres';
	const baseVolumeName = stringValue(database.volumeName) ?? 'treeseed-market-local-postgres-data';
	return {
		apiPackageRoot: apiPackage.packageRoot,
		apiPackageRelativeDir: apiPackage.packageRelativeDir,
		apiPackageId: apiPackage.packageId,
		localDev: apiPackage.localDev,
		services: apiPackage.services,
		database: {
			managed: managed && !configuredUrl,
			host,
			port,
			url,
			urlEnv,
			compatibilityUrlEnv,
			containerName: stringValue(env.TREESEED_MARKET_LOCAL_POSTGRES_CONTAINER) ?? `${baseContainerName}-${scopedId}`,
			volumeName: stringValue(env.TREESEED_MARKET_LOCAL_POSTGRES_VOLUME) ?? `${baseVolumeName}-${scopedId}`,
			user,
			password,
			database: dbName,
		},
		migrations: {
			command: stringValue(migrations.command) ?? process.execPath,
			args: stringArray(migrations.args).length > 0 ? stringArray(migrations.args) : ['scripts/migrate-db.mjs'],
			cwd: apiPackage.packageRoot,
		},
	};
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

function postgresManaged(env: Record<string, string>) {
	return env.TREESEED_MARKET_LOCAL_POSTGRES_MANAGED !== 'false';
}

function worktreeInstanceSuffix(tenantRoot: string) {
	return createHash('sha256').update(resolve(tenantRoot)).digest('hex').slice(0, 10);
}

function postgresComposeEnv(env: Record<string, string>, tenantRoot: string) {
	const suffix = worktreeInstanceSuffix(tenantRoot);
	return {
		...process.env,
		...env,
		TREESEED_LOCAL_POSTGRES_DB: env.TREESEED_LOCAL_POSTGRES_DB ?? 'market_local',
		TREESEED_LOCAL_POSTGRES_USER: env.TREESEED_LOCAL_POSTGRES_USER ?? 'treeseed',
		TREESEED_LOCAL_POSTGRES_PASSWORD: env.TREESEED_LOCAL_POSTGRES_PASSWORD ?? 'treeseed',
		TREESEED_MARKET_LOCAL_POSTGRES_PORT: env.TREESEED_MARKET_LOCAL_POSTGRES_PORT ?? '55432',
		TREESEED_MARKET_LOCAL_POSTGRES_CONTAINER:
			env.TREESEED_MARKET_LOCAL_POSTGRES_CONTAINER ?? `treeseed-market-local-postgres-${suffix}`,
		TREESEED_MARKET_LOCAL_POSTGRES_VOLUME:
			env.TREESEED_MARKET_LOCAL_POSTGRES_VOLUME ?? `treeseed-market-local-postgres-data-${suffix}`,
	};
}

function resetApiPostgres(plan: TreeseedIntegratedDevPlan) {
	const apiSpec = plan.processes.find((process) => process.surface === 'api' || process.surface === 'operations-runner');
	const composeFile = resolve(plan.tenantRoot, 'packages', 'api', 'compose.postgres.yml');
	if (!apiSpec || !existsSync(composeFile)) return;
	const env = postgresComposeEnv(apiSpec.env, plan.tenantRoot);
	const projectName = 'treeseed-local-api-postgres';
	spawnSync('docker', ['compose', '-f', composeFile, '-p', projectName, 'down', '-v'], {
		cwd: resolve(plan.tenantRoot, 'packages', 'api'),
		env,
		encoding: 'utf8',
		timeout: 60_000,
	});
}

function ensureApiPostgres(plan: TreeseedIntegratedDevPlan) {
	const needsApiDatabase = plan.processes.some((process) => process.surface === 'api' || process.surface === 'operations-runner');
	if (!needsApiDatabase) return;
	const apiSpec = plan.processes.find((process) => process.surface === 'api' || process.surface === 'operations-runner');
	if (!apiSpec || !postgresManaged(apiSpec.env)) return;
	const composeFile = resolve(plan.tenantRoot, 'packages', 'api', 'compose.postgres.yml');
	if (!existsSync(composeFile)) {
		throw new Error(`API-owned local PostgreSQL compose file is missing: ${composeFile}`);
	}
	const env = postgresComposeEnv(apiSpec.env, plan.tenantRoot);
	const projectName = 'treeseed-local-api-postgres';
	const baseArgs = ['compose', '-f', composeFile, '-p', projectName];
	const up = spawnSync('docker', [...baseArgs, 'up', '-d'], {
		cwd: resolve(plan.tenantRoot, 'packages', 'api'),
		env,
		encoding: 'utf8',
		timeout: 60_000,
	});
	if ((up.status ?? 1) !== 0) {
		throw new Error([up.stdout, up.stderr].filter(Boolean).join('\n').trim() || 'Unable to start API-owned local PostgreSQL.');
	}
	const user = env.TREESEED_LOCAL_POSTGRES_USER ?? 'treeseed';
	const database = env.TREESEED_LOCAL_POSTGRES_DB ?? 'market_local';
	let last = '';
	const startedAt = Date.now();
	while (Date.now() - startedAt < 45_000) {
		const ready = spawnSync('docker', [...baseArgs, 'exec', '-T', 'treeseed-api-postgres', 'pg_isready', '-U', user, '-d', database], {
			cwd: resolve(plan.tenantRoot, 'packages', 'api'),
			env,
			encoding: 'utf8',
			timeout: 5_000,
		});
		last = [ready.stdout, ready.stderr].filter(Boolean).join('\n').trim();
		if ((ready.status ?? 1) === 0) return;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
	}
	throw new Error(last || 'Timed out waiting for API-owned local PostgreSQL.');
}

function scriptCommand(tenantRoot: string, script: string, args: string[] = []) {
	return {
		command: 'npm',
		args: ['run', script, '--', ...args],
		cwd: tenantRoot,
	};
}

function packageCommand(input: { tenantRoot: string; setup: TreeseedManagedDevSetup; script: string }) {
	if (!input.setup.apiPackageRelativeDir && !input.setup.apiPackageRoot) {
		throw new Error('No embedded API package with localDev metadata was discovered.');
	}
	if (input.setup.apiPackageRelativeDir) {
		return {
			command: 'npm',
			args: ['-w', input.setup.apiPackageRelativeDir, 'run', input.script],
			cwd: input.tenantRoot,
		};
	}
	return {
		command: 'npm',
		args: ['run', input.script],
		cwd: input.setup.apiPackageRoot ?? input.tenantRoot,
	};
}

function processSpec(input: {
	tenantRoot: string;
	stateDir: string;
	logDir: string;
	surface: string;
	options: TreeseedManagedDevOptions;
	setup: TreeseedManagedDevSetup;
}): TreeseedManagedDevProcessSpec {
	const host = input.options.webHost ?? '127.0.0.1';
	const webPort = input.options.webPort ?? 4321;
	const apiHost = input.options.apiHost ?? '127.0.0.1';
	const apiPort = input.options.apiPort ?? 3000;
	const id = input.surface === 'operations-runner' ? 'operations-runner' : input.surface;
	const logPath = resolve(input.logDir, `${id}.log`);
	const pidPath = resolve(input.stateDir, 'pids', `${id}.pid`);
	const instancePath = resolve(input.stateDir, 'instances', `${id}.json`);
	const env = Object.fromEntries(
		Object.entries(input.options.env ?? {})
			.filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
	);
	const apiService = recordValue(input.setup.services.api);
	const runnerService = recordValue(input.setup.services.operationsRunner);
	const databaseEnv = input.setup.database
		? {
			[input.setup.database.urlEnv]: input.setup.database.url,
			...(input.setup.database.compatibilityUrlEnv ? { [input.setup.database.compatibilityUrlEnv]: input.setup.database.url } : {}),
			TREESEED_MARKET_LOCAL_POSTGRES_CONTAINER: input.setup.database.containerName,
			TREESEED_MARKET_LOCAL_POSTGRES_VOLUME: input.setup.database.volumeName,
			TREESEED_MARKET_LOCAL_POSTGRES_PORT: input.setup.database.port,
		}
		: {};
	const localDatabaseUrl = databaseEnv.TREESEED_DATABASE_URL
		?? env.TREESEED_DATABASE_URL
		?? env.TREESEED_MARKET_DATABASE_URL
		?? 'postgres://treeseed:treeseed@127.0.0.1:55432/market_local';
	const localSharedEnv = {
		...env,
		...databaseEnv,
		TREESEED_SITE_URL: env.TREESEED_SITE_URL ?? `http://${host}:${webPort}`,
		BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? `http://${host}:${webPort}`,
		TREESEED_API_BASE_URL: env.TREESEED_API_BASE_URL ?? `http://${apiHost}:${apiPort}`,
		TREESEED_MARKET_API_BASE_URL: env.TREESEED_MARKET_API_BASE_URL ?? `http://${apiHost}:${apiPort}`,
		TREESEED_DATABASE_URL: localDatabaseUrl,
		TREESEED_MARKET_DATABASE_URL: env.TREESEED_MARKET_DATABASE_URL ?? localDatabaseUrl,
		TREESEED_MARKET_LOCAL_POSTGRES_PORT: env.TREESEED_MARKET_LOCAL_POSTGRES_PORT ?? databaseEnv.TREESEED_MARKET_LOCAL_POSTGRES_PORT ?? '55432',
		TREESEED_MARKET_LOCAL_POSTGRES_MANAGED: env.TREESEED_MARKET_LOCAL_POSTGRES_MANAGED ?? (input.setup.database?.managed === false ? 'false' : 'true'),
		TREESEED_WEB_SERVICE_ID: env.TREESEED_WEB_SERVICE_ID ?? env.TREESEED_API_WEB_SERVICE_ID ?? 'web',
		TREESEED_WEB_SERVICE_SECRET: env.TREESEED_WEB_SERVICE_SECRET ?? env.TREESEED_API_WEB_SERVICE_SECRET ?? 'treeseed-web-service-dev-secret',
		TREESEED_API_WEB_SERVICE_ID: env.TREESEED_API_WEB_SERVICE_ID ?? env.TREESEED_WEB_SERVICE_ID ?? 'web',
		TREESEED_API_WEB_SERVICE_SECRET: env.TREESEED_API_WEB_SERVICE_SECRET ?? env.TREESEED_WEB_SERVICE_SECRET ?? 'treeseed-web-service-dev-secret',
		TREESEED_PLATFORM_RUNNER_SECRET: env.TREESEED_PLATFORM_RUNNER_SECRET ?? 'treeseed-platform-runner-dev-secret',
		TREESEED_BETTER_AUTH_SECRET: env.TREESEED_BETTER_AUTH_SECRET ?? 'treeseed-local-better-auth-secret-minimum-32-characters',
		TREESEED_ACCEPTANCE_EXPOSE_AUTH_TOKENS: env.TREESEED_ACCEPTANCE_EXPOSE_AUTH_TOKENS ?? '1',
		TREESEED_FORM_TOKEN_SECRET: env.TREESEED_FORM_TOKEN_SECRET ?? 'treeseed-local-form-token-secret',
		TREESEED_SMTP_HOST: env.TREESEED_SMTP_HOST ?? '127.0.0.1',
		TREESEED_SMTP_PORT: env.TREESEED_SMTP_PORT ?? '1025',
		TREESEED_SMTP_USERNAME: env.TREESEED_SMTP_USERNAME ?? '',
		TREESEED_SMTP_PASSWORD: env.TREESEED_SMTP_PASSWORD ?? '',
		TREESEED_MAILPIT_SMTP_HOST: env.TREESEED_MAILPIT_SMTP_HOST ?? '127.0.0.1',
		TREESEED_MAILPIT_SMTP_PORT: env.TREESEED_MAILPIT_SMTP_PORT ?? '1025',
		TREESEED_MAILPIT_UI_PORT: env.TREESEED_MAILPIT_UI_PORT ?? '8025',
	};
	if (input.surface === 'api') {
		const command = packageCommand({ tenantRoot: input.tenantRoot, setup: input.setup, script: stringValue(apiService.script) ?? 'dev:api' });
		const healthPath = stringValue(apiService.healthPath) ?? '/healthz';
		return {
			id,
			surface: input.surface,
			...command,
			env: { ...localSharedEnv, HOST: apiHost, PORT: String(apiPort), TREESEED_API_ENVIRONMENT: localSharedEnv.TREESEED_API_ENVIRONMENT ?? 'local' },
			port: apiPort,
			health: [{ id: 'api', kind: 'http', url: `http://${apiHost}:${apiPort}${healthPath.startsWith('/') ? healthPath : `/${healthPath}`}` }],
			logPath,
			pidPath,
			instancePath,
		};
	}
	if (input.surface === 'operations-runner') {
		const command = packageCommand({ tenantRoot: input.tenantRoot, setup: input.setup, script: stringValue(runnerService.script) ?? 'dev:runner' });
		return {
			id,
			surface: input.surface,
			...command,
			env: { ...localSharedEnv, TREESEED_PLATFORM_RUNNER_ENVIRONMENT: localSharedEnv.TREESEED_PLATFORM_RUNNER_ENVIRONMENT ?? 'local' },
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
			args: [`./packages/sdk/scripts/run-ts.${'mjs'}`, `./packages/sdk/scripts/tenant-astro-command.${'ts'}`, ...webArgs],
			cwd: input.tenantRoot,
		};
	return {
		id: 'web',
		surface: 'web',
		...command,
		env: localSharedEnv,
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
	const setup = apiLocalDevSetup(tenantRoot, options);
	const requestedSurfaces = splitSurfaces(options.surfaces);
	const surfaces = requestedSurfaces.filter((surface) => {
		if (surface === 'web') return true;
		if (surface === 'api') return Object.keys(recordValue(setup.services.api)).length > 0;
		if (surface === 'operations-runner') return Object.keys(recordValue(setup.services.operationsRunner)).length > 0;
		return true;
	});
	return {
		tenantRoot,
		scopeId: id,
		worktreeRoot: tenantRoot,
		stateDir,
		logDir,
		setup,
		processes: surfaces.map((surface) => processSpec({ tenantRoot, stateDir, logDir, surface, options, setup })),
	};
}

function instanceFromSpec(spec: TreeseedManagedDevProcessSpec): TreeseedDevInstance {
	const pid = existsSync(spec.pidPath) ? Number(readFileSync(spec.pidPath, 'utf8').trim()) : null;
	const record = readJson(spec.instancePath);
	const normalizedPid = Number.isFinite(pid) ? pid : null;
	const running = pidAlive(normalizedPid);
	if (normalizedPid !== null && !running) {
		rmSync(spec.pidPath, { force: true });
		rmSync(spec.instancePath, { force: true });
	}
	return {
		...spec,
		pid: running ? normalizedPid : null,
		running,
		startedAt: typeof record?.startedAt === 'string' ? record.startedAt : null,
	};
}

function candidateFamilyWorktreeRoots(cwd: string) {
	const root = resolve(cwd);
	const roots = new Set<string>([root]);
	const parent = dirname(root);
	if (parent.endsWith('/.treeseed/worktrees')) {
		try {
			for (const entry of readdirSync(parent, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const candidate = resolve(parent, entry.name);
				if (existsSync(resolve(candidate, '.treeseed', 'dev'))) {
					roots.add(candidate);
				}
			}
		} catch {
			// Best-effort repository-family discovery; current worktree remains covered.
		}
	}
	return [...roots].sort();
}

async function stopManagedDevForRoots(options: TreeseedManagedDevOptions, roots: string[]) {
	const allInstances: TreeseedDevInstance[] = [];
	let plan = createTreeseedIntegratedDevPlan(options);
	for (const root of roots) {
		const scopedOptions = { ...options, cwd: root, all: false };
		const scopedPlan = createTreeseedIntegratedDevPlan(scopedOptions);
		plan = root === resolve(options.cwd ?? process.cwd()) ? scopedPlan : plan;
		for (const spec of scopedPlan.processes) {
			allInstances.push(await stopSpec(spec));
		}
		await stopOwnedDevProcesses(root);
	}
	return { ok: true, action: 'stop' as const, plan, instances: allInstances };
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
		terminatePidTree(instance.pid);
		if (!await waitForPidTreeExit(instance.pid)) {
			forceKillPidTree(instance.pid);
		}
	}
	rmSync(spec.pidPath, { force: true });
	rmSync(spec.instancePath, { force: true });
	return instance;
}

async function stopConflictingPortOwners(plan: TreeseedIntegratedDevPlan) {
	const ports = [...new Set(plan.processes
		.map((spec) => spec.port)
		.filter((port): port is number => typeof port === 'number' && Number.isFinite(port)))];
	for (const port of ports) {
		for (const pid of portOwnerPids(port)) {
			terminatePidTree(pid);
			if (!await waitForPidTreeExit(pid)) {
				forceKillPidTree(pid);
			}
		}
	}
}

async function startSpec(spec: TreeseedManagedDevProcessSpec, force = false) {
	const existing = instanceFromSpec(spec);
	if (existing.running && !force) {
		return existing;
	}
	if (existing.running && force) {
		await stopSpec(spec);
	}
	mkdirSync(resolve(spec.pidPath, '..'), { recursive: true });
	mkdirSync(resolve(spec.instancePath, '..'), { recursive: true });
	mkdirSync(resolve(spec.logPath, '..'), { recursive: true });
	appendFileSync(spec.logPath, `\n[treeseed-dev] starting ${spec.id} ${new Date().toISOString()}\n`, 'utf8');
	const stdoutFd = openSync(spec.logPath, 'a');
	const stderrFd = openSync(spec.logPath, 'a');
	const child = spawn(spec.command, spec.args, {
		cwd: spec.cwd,
		env: { ...process.env, ...spec.env },
		detached: true,
		stdio: ['ignore', stdoutFd, stderrFd],
	});
	child.on('error', (error) => appendFileSync(spec.logPath, `[treeseed-dev] ${spec.id} spawn failed: ${error.message}\n`, 'utf8'));
	child.on('exit', (code, signal) => appendFileSync(spec.logPath, `[treeseed-dev] ${spec.id} exited code=${code ?? 'null'} signal=${signal ?? 'null'} ${new Date().toISOString()}\n`, 'utf8'));
	closeSync(stdoutFd);
	closeSync(stderrFd);
	child.unref();
	writeFileSync(spec.pidPath, String(child.pid ?? ''), 'utf8');
	writeFileSync(spec.instancePath, `${JSON.stringify(persistedInstanceRecord(spec, child.pid ?? null), null, 2)}\n`, 'utf8');
	await waitForSpecReady(spec, child.pid ?? null);
	return instanceFromSpec(spec);
}

async function checkSpecReady(spec: TreeseedManagedDevProcessSpec, pid: number | null) {
	if (!pid || !pidAlive(pid)) return false;
	const checks = spec.health ?? [];
	if (checks.length === 0) return true;
	for (const check of checks) {
		try {
			const response = await fetch(check.url, { signal: AbortSignal.timeout(check.timeoutMs ?? 2_000) });
			if (!response.ok) return false;
		} catch {
			return false;
		}
	}
	return true;
}

async function waitForSpecReady(spec: TreeseedManagedDevProcessSpec, pid: number | null) {
	if (!pid) return false;
	const deadline = Date.now() + 120_000;
	const checks = spec.health ?? [];
	while (Date.now() < deadline) {
		if (!pidAlive(pid)) return false;
		if (checks.length === 0) {
			await sleep(1_000);
			return pidAlive(pid);
		}
		if (await checkSpecReady(spec, pid)) return true;
		await sleep(500);
	}
	appendFileSync(spec.logPath, `[treeseed-dev] ${spec.id} did not become ready before timeout.\n`, 'utf8');
	return false;
}

async function allSpecsReady(instances: TreeseedDevInstance[]) {
	const readiness = await Promise.all(instances.map((instance) => checkSpecReady(instance, instance.pid)));
	return readiness.every(Boolean);
}

export async function startTreeseedManagedDev(options: TreeseedManagedDevOptions = {}): Promise<TreeseedManagedDevResult> {
	const plan = createTreeseedIntegratedDevPlan(options);
	if (options.forceConflicts === true) {
		await stopConflictingPortOwners(plan);
	}
	prepareManagedDevSetup(plan, options);
	const instances = [];
	for (const spec of plan.processes) {
		instances.push(await startSpec(spec, options.force === true));
	}
	return { ok: await allSpecsReady(instances), action: 'start', plan, instances };
}

export async function stopTreeseedManagedDev(options: TreeseedManagedDevOptions = {}): Promise<TreeseedManagedDevResult> {
	if (options.all === true) {
		return stopManagedDevForRoots(options, candidateFamilyWorktreeRoots(options.cwd ?? process.cwd()));
	}
	const plan = createTreeseedIntegratedDevPlan(options);
	const instances = [];
	for (const spec of plan.processes) {
		instances.push(await stopSpec(spec));
	}
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
		ok: action === 'logs' ? true : await allSpecsReady(instances),
		action,
		plan,
		instances,
		output: logs ? JSON.stringify(logs) : undefined,
	};
}
