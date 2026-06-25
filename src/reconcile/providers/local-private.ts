import { runTreeseedManagedDev, type TreeseedManagedDevAction, type TreeseedManagedDevOptions } from '../../local-dev/managed-dev.ts';

export function runManagedDevAction(input: { tenantRoot: string; action: TreeseedManagedDevAction; surfaces: string[]; options?: Record<string, unknown>; env?: NodeJS.ProcessEnv }) {
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
		all: input.options?.all === true,
		follow: input.options?.follow === true,
		env: input.env,
	}).then((result) => {
		const safeResult = sanitizeManagedDevResult(result);
		return {
			ok: safeResult.ok,
			status: safeResult.ok ? 0 : 1,
			stdout: `${JSON.stringify(safeResult)}\n`,
			stderr: '',
			output: JSON.stringify(safeResult),
			parsed: safeResult,
			args: [input.action],
			surfaces: input.surfaces,
		};
	});
}

function sanitizeManagedDevResult<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((entry) => sanitizeManagedDevResult(entry)) as T;
	}
	if (!value || typeof value !== 'object') {
		return value;
	}
	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (key === 'env') {
			continue;
		}
		if (key === 'redactedEnv' || key === 'envKeys') {
			continue;
		}
		result[key] = sanitizeManagedDevResult(entry);
	}
	return result as T;
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
