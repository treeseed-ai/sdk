import {
	runTreeseedManagedDev,
	type TreeseedManagedDevAction,
	type TreeseedManagedDevOptions,
	type TreeseedManagedDevResult,
} from '../../local-dev/managed-dev.ts';

export function runManagedDevAction(input: {
	tenantRoot: string;
	action: TreeseedManagedDevAction;
	surfaces: string[];
	options?: Record<string, unknown>;
	env?: NodeJS.ProcessEnv;
}) {
	return runTreeseedManagedDev({
		action: input.action,
		cwd: input.tenantRoot,
		surfaces: input.surfaces.join(','),
		webRuntime: input.options?.webRuntime as TreeseedManagedDevOptions['webRuntime'],
		webHost: typeof input.options?.host === 'string' ? input.options.host : undefined,
		webPort: typeof input.options?.port === 'number' ? input.options.port : undefined,
		apiHost: typeof input.options?.apiHost === 'string' ? input.options.apiHost : undefined,
		apiPort: typeof input.options?.apiPort === 'number' ? input.options.apiPort : undefined,
		force: input.options?.force === true,
		forceConflicts: input.options?.forceConflicts === true,
		reset: input.options?.reset === true,
		all: input.options?.all === true,
		follow: input.options?.follow === true,
		env: input.env,
	}).then((result) => {
		const safeResult = summarizeManagedDevResult(result);
		return {
		ok: safeResult.ok,
		status: safeResult.ok ? 0 : 1,
		stdout: `${JSON.stringify(safeResult)}\n`,
		stderr: '',
		output: JSON.stringify(safeResult),
		parsed: safeResult,
		args: [input.action, '--surfaces', input.surfaces.join(',')],
	};
	});
}

function summarizeManagedDevResult(result: TreeseedManagedDevResult) {
	return {
		ok: result.ok,
		action: result.action,
		scopeId: result.plan.scopeId,
		tenantRoot: result.plan.tenantRoot,
		setup: {
			apiPackageRoot: result.plan.setup.apiPackageRoot,
			apiPackageRelativeDir: result.plan.setup.apiPackageRelativeDir,
			apiPackageId: result.plan.setup.apiPackageId,
			database: result.plan.setup.database
				? {
					managed: result.plan.setup.database.managed,
					host: result.plan.setup.database.host,
					port: result.plan.setup.database.port,
					containerName: result.plan.setup.database.containerName,
					volumeName: result.plan.setup.database.volumeName,
					urlEnv: result.plan.setup.database.urlEnv,
					compatibilityUrlEnv: result.plan.setup.database.compatibilityUrlEnv,
				}
				: null,
			migrations: result.plan.setup.migrations
				? {
					command: result.plan.setup.migrations.command,
					args: result.plan.setup.migrations.args,
					cwd: result.plan.setup.migrations.cwd,
				}
				: null,
		},
		processes: result.plan.processes.map((process) => ({
			id: process.id,
			surface: process.surface,
			cwd: process.cwd,
			command: process.command,
			args: process.args,
			port: process.port ?? null,
			health: process.health ?? [],
			logPath: process.logPath,
			pidPath: process.pidPath,
			instancePath: process.instancePath,
		})),
		instances: result.instances.map((instance) => ({
			id: instance.id,
			surface: instance.surface,
			pid: instance.pid,
			running: instance.running,
			port: instance.port ?? null,
			health: instance.health ?? [],
			logPath: instance.logPath,
			startedAt: instance.startedAt ?? null,
		})),
		output: result.output ?? null,
	};
}

export async function checkHttpHealth(url: string, timeoutMs = 2_000) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		return {
			ok: response.ok,
			status: response.status,
			url,
		};
	} catch (error) {
		return {
			ok: false,
			status: null,
			url,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timeout);
	}
}
