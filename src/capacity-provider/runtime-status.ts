import { readFileSync } from 'node:fs';

export function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export interface ObservedCapacityProviderRuntimeStatus {
	path: string;
	exists: boolean;
	valid: boolean;
	fresh: boolean;
	connected: boolean;
	ageSeconds: number | null;
	status: Record<string, unknown> | null;
	issues: string[];
}

export function observeCapacityProviderRuntimeStatus(path: string, maxAgeSeconds: number, now = new Date(), requireConnected = true): ObservedCapacityProviderRuntimeStatus {
	let status: Record<string, unknown>;
	try {
		status = record(JSON.parse(readFileSync(path, 'utf8')));
	} catch (error) {
		return {
			path,
			exists: (error as NodeJS.ErrnoException).code !== 'ENOENT',
			valid: false,
			fresh: false,
			connected: false,
			ageSeconds: null,
			status: null,
			issues: [`Capacity provider runtime status is unavailable or invalid: ${path}`],
		};
	}
	const updatedAt = typeof status.updatedAt === 'string' ? Date.parse(status.updatedAt) : Number.NaN;
	const ageSeconds = Number.isFinite(updatedAt) ? Math.max(0, (now.getTime() - updatedAt) / 1_000) : null;
	const valid = status.schemaVersion === 1 && status.role === 'manager' && status.ok === true && ageSeconds !== null;
	const fresh = valid && ageSeconds <= maxAgeSeconds;
	const result = record(status.result);
	const connections = Array.isArray(result.connections) ? result.connections.map(record) : [];
	const connected = fresh && connections.some((connection) => connection.ok !== false && connection.action === 'availability-session-published');
	const issues = [
		...(!valid ? ['Manager runtime status is malformed or reports failure.'] : []),
		...(valid && !fresh ? [`Manager runtime status is stale (${ageSeconds?.toFixed(1)} seconds old).`] : []),
		...(fresh && requireConnected && !connected ? ['Manager has not published an availability session for any approved provider connection.'] : []),
	];
	return { path, exists: true, valid, fresh, connected, ageSeconds, status, issues };
}
