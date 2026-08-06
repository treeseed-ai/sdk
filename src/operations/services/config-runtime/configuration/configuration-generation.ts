import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getMachineConfigPaths } from '../hosting/load-tenant-deploy-config.ts';

export interface ConfigurationGeneration {
	schemaVersion: 1;
	id: string;
	createdAt: string;
	configDigest: string;
	scopes: string[];
	status: 'pending' | 'applied' | 'failed';
	previousGenerationId: string | null;
	result?: Record<string, unknown>;
}

export interface MachineConfigurationSnapshot {
	path: string;
	existed: boolean;
	content: Buffer | null;
}

function atomicJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
	renameSync(temporary, path);
}

export function captureMachineConfiguration(tenantRoot: string): MachineConfigurationSnapshot {
	const { configPath } = getMachineConfigPaths(tenantRoot);
	return {
		path: configPath,
		existed: existsSync(configPath),
		content: existsSync(configPath) ? readFileSync(configPath) : null,
	};
}

export function restoreMachineConfiguration(snapshot: MachineConfigurationSnapshot) {
	if (!snapshot.existed) {
		if (existsSync(snapshot.path)) unlinkSync(snapshot.path);
		return;
	}
	if (!snapshot.content) throw new Error('The previous machine configuration snapshot is unavailable.');
	mkdirSync(dirname(snapshot.path), { recursive: true });
	const temporary = `${snapshot.path}.${process.pid}.${randomUUID()}.rollback`;
	writeFileSync(temporary, snapshot.content, { mode: 0o600 });
	renameSync(temporary, snapshot.path);
}

export function configurationGenerationPaths(tenantRoot: string) {
	const root = resolve(tenantRoot, '.treeseed', 'config', 'generations');
	return { root, current: resolve(root, 'current.json'), runtime: resolve(root, 'runtime.json') };
}

export function readConfigurationGeneration(tenantRoot: string): ConfigurationGeneration | null {
	try { return JSON.parse(readFileSync(configurationGenerationPaths(tenantRoot).current, 'utf8')) as ConfigurationGeneration; } catch { return null; }
}

export function recordConfigurationGeneration(tenantRoot: string, scopes: string[]): ConfigurationGeneration {
	const { configPath } = getMachineConfigPaths(tenantRoot);
	if (!existsSync(configPath)) throw new Error('A configuration generation cannot be created before machine configuration exists.');
	const configDigest = createHash('sha256').update(readFileSync(configPath)).digest('hex');
	const previous = readConfigurationGeneration(tenantRoot);
	if (previous?.configDigest === configDigest) return previous;
	const createdAt = new Date().toISOString();
	const generation: ConfigurationGeneration = { schemaVersion: 1, id: `config-${createdAt.replace(/[^0-9]/gu, '')}-${configDigest.slice(0, 12)}`, createdAt, configDigest, scopes: [...new Set(scopes)].sort(), status: 'pending', previousGenerationId: previous?.id ?? null };
	const paths = configurationGenerationPaths(tenantRoot);
	atomicJson(resolve(paths.root, `${generation.id}.json`), generation);
	atomicJson(paths.current, generation);
	return generation;
}

export function settleConfigurationGeneration(tenantRoot: string, id: string, status: 'applied' | 'failed', result: Record<string, unknown>): ConfigurationGeneration {
	const current = readConfigurationGeneration(tenantRoot);
	if (!current || current.id !== id) throw new Error(`Configuration generation ${id} is no longer current.`);
	const generation = { ...current, status, result: { ...result, settledAt: new Date().toISOString() } };
	const paths = configurationGenerationPaths(tenantRoot);
	atomicJson(resolve(paths.root, `${generation.id}.json`), generation);
	atomicJson(paths.current, generation);
	return generation;
}
