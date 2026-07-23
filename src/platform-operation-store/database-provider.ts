import { randomUUID } from 'node:crypto';
import { NodeSqliteD1Database } from '../db/node-sqlite.ts';
import {
	type PlatformOperation,
	type PlatformOperationEvent,
	type PlatformRunnerClaimRequest,
	type PlatformRunnerHeartbeatRequest,
	type PlatformRunnerJobUpdateRequest,
	type PlatformRunnerRegistrationRequest,
} from '../platform-operations.ts';
import { PlatformOperationStore } from './platform-operation-store.ts';

export type DatabaseProvider = 'd1' | 'sqlite' | 'postgres';

export interface RelationalDatabaseAdapter {
	readonly provider: DatabaseProvider;
	run(query: string, params?: unknown[]): Promise<void>;
	first<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T | null>;
	all<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
	exec?(query: string): Promise<void>;
	transaction?<T>(callback: () => Promise<T>): Promise<T>;
	close?(): Promise<void> | void;
}

export interface PlatformOperationStoreOptions {
	database: RelationalDatabaseAdapter;
	initializeSchema?: boolean;
	now?: () => Date;
}

export interface CreatePlatformOperationStoreFromEnvOptions {
	databaseUrl?: string | null;
	initializeSchema?: boolean;
}

export const PLATFORM_OPERATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS platform_operations (
	id TEXT PRIMARY KEY,
	namespace TEXT NOT NULL,
	operation TEXT NOT NULL,
	status TEXT NOT NULL,
	target TEXT NOT NULL,
	idempotency_key TEXT,
	input_json TEXT NOT NULL DEFAULT '{}',
	output_json TEXT,
	error_json TEXT,
	requested_by_type TEXT NOT NULL,
	requested_by_id TEXT,
	assigned_runner_id TEXT,
	lease_expires_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	started_at TEXT,
	finished_at TEXT,
	cancelled_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_operations_idempotency
	ON platform_operations(namespace, operation, idempotency_key)
	WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_platform_operations_runnable
	ON platform_operations(status, created_at ASC);

CREATE TABLE IF NOT EXISTS platform_operation_events (
	id TEXT PRIMARY KEY,
	operation_id TEXT NOT NULL,
	seq INTEGER NOT NULL,
	kind TEXT NOT NULL,
	data_json TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL,
	FOREIGN KEY (operation_id) REFERENCES platform_operations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_operation_events_seq
	ON platform_operation_events(operation_id, seq);

CREATE TABLE IF NOT EXISTS market_operation_runners (
	id TEXT PRIMARY KEY,
	runner_key TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	environment TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'online',
	version TEXT,
	capabilities_json TEXT NOT NULL DEFAULT '[]',
	active_job_count INTEGER NOT NULL DEFAULT 0,
	max_concurrent_jobs INTEGER NOT NULL DEFAULT 1,
	heartbeat_at TEXT,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_repository_claims (
	id TEXT PRIMARY KEY,
	repository_key TEXT NOT NULL,
	runner_id TEXT NOT NULL,
	workspace_path TEXT NOT NULL,
	branch TEXT,
	commit_sha TEXT,
	claim_state TEXT NOT NULL DEFAULT 'active',
	lease_expires_at TEXT,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_repository_claims_active
	ON platform_repository_claims(repository_key, runner_id)
	WHERE claim_state = 'active';

CREATE INDEX IF NOT EXISTS idx_platform_repository_claims_runner
	ON platform_repository_claims(runner_id, claim_state);
`;

export function isoNow(now: () => Date) {
	return now().toISOString();
}

export function parseJson(value: unknown, fallback: unknown) {
	if (typeof value !== 'string' || !value) return fallback;
	try {
		return JSON.parse(value);
	} catch {
		return fallback;
	}
}

export function rowOperation(row: Record<string, unknown> | null): PlatformOperation | null {
	if (!row) return null;
	return {
		id: String(row.id),
		namespace: String(row.namespace),
		operation: String(row.operation),
		status: String(row.status),
		target: String(row.target),
		idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
		input: parseJson(row.input_json, {}) as Record<string, unknown>,
		output: parseJson(row.output_json, null),
		error: parseJson(row.error_json, null),
		requestedByType: String(row.requested_by_type),
		requestedById: row.requested_by_id == null ? null : String(row.requested_by_id),
		assignedRunnerId: row.assigned_runner_id == null ? null : String(row.assigned_runner_id),
		leaseExpiresAt: row.lease_expires_at == null ? null : String(row.lease_expires_at),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
		startedAt: row.started_at == null ? null : String(row.started_at),
		finishedAt: row.finished_at == null ? null : String(row.finished_at),
		cancelledAt: row.cancelled_at == null ? null : String(row.cancelled_at),
	};
}

export function rowEvent(row: Record<string, unknown> | null): PlatformOperationEvent | null {
	if (!row) return null;
	return {
		id: String(row.id),
		operationId: String(row.operation_id),
		seq: Number(row.seq),
		kind: String(row.kind),
		data: parseJson(row.data_json, {}) as Record<string, unknown>,
		createdAt: String(row.created_at),
	};
}

export function repositoryKey(repository: Record<string, unknown> = {}) {
	return [repository.provider ?? 'git', repository.owner ?? 'local', repository.name ?? 'repository']
		.join('-')
		.toLowerCase()
		.replace(/[^a-z0-9.-]+/gu, '-')
		.replace(/^-+|-+$/gu, '') || 'repository';
}

export function repositoryWorkspacePath(workspaceRoot: unknown, repository: Record<string, unknown> = {}) {
	const root = String(workspaceRoot ?? '/data').replace(/\/+$/u, '') || '/data';
	return `${root}/repositories/${repositoryKey(repository)}/repo`;
}

export function normalizeOperationCapabilities(capabilities: unknown) {
	return Array.isArray(capabilities)
		? capabilities.map((entry) => String(entry ?? '').trim()).filter(Boolean)
		: [];
}

export function convertQuestionPlaceholders(query: string) {
	let index = 0;
	return query.replace(/\?/gu, () => `$${++index}`);
}

export function createD1RelationalAdapter(db: { prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results?: T[] } | T[]> } }; exec?(query: string): Promise<unknown> }): RelationalDatabaseAdapter {
	return {
		provider: 'd1',
		async run(query, params = []) {
			await db.prepare(query).bind(...params).run();
		},
		async first(query, params = []) {
			return db.prepare(query).bind(...params).first();
		},
		async all(query, params = []) {
			const result = await db.prepare(query).bind(...params).all();
			return Array.isArray(result) ? result : result.results ?? [];
		},
		async exec(query) {
			if (!db.exec) {
				for (const statement of query.split(/;\s*/u).map((entry) => entry.trim()).filter(Boolean)) {
					await this.run(statement);
				}
				return;
			}
			await db.exec(query);
		},
	};
}

export function createSqliteRelationalAdapter(path?: string | null): RelationalDatabaseAdapter {
	const database = new NodeSqliteD1Database(path);
	return {
		...createD1RelationalAdapter(database),
		provider: 'sqlite',
		close: () => database.close(),
	};
}

export async function createPostgresRelationalAdapter(databaseUrl: string): Promise<RelationalDatabaseAdapter> {
	const importer = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
	const { Pool } = await importer('pg');
	const pool = new Pool({ connectionString: databaseUrl });
	return {
		provider: 'postgres',
		async run(query, params = []) {
			await pool.query(convertQuestionPlaceholders(query), params);
		},
		async first(query, params = []) {
			const result = await pool.query(convertQuestionPlaceholders(query), params);
			return (result.rows[0] ?? null) as Record<string, unknown> | null;
		},
		async all(query, params = []) {
			const result = await pool.query(convertQuestionPlaceholders(query), params);
			return result.rows as Record<string, unknown>[];
		},
		async exec(query) {
			await pool.query(query);
		},
		async transaction(callback) {
			await pool.query('BEGIN');
			try {
				const result = await callback();
				await pool.query('COMMIT');
				return result;
			} catch (error) {
				await pool.query('ROLLBACK');
				throw error;
			}
		},
		close: () => pool.end(),
	};
}

export async function createRelationalAdapterFromUrl(databaseUrl: string): Promise<RelationalDatabaseAdapter> {
	const value = databaseUrl.trim();
	if (/^postgres(ql)?:\/\//iu.test(value)) return createPostgresRelationalAdapter(value);
	if (/^sqlite:\/\//iu.test(value)) return createSqliteRelationalAdapter(value.replace(/^sqlite:\/\//iu, ''));
	return createSqliteRelationalAdapter(value);
}

export async function createPlatformOperationStoreFromEnv(options: CreatePlatformOperationStoreFromEnvOptions = {}) {
	const databaseUrl = options.databaseUrl ?? globalThis.process?.env?.TREESEED_DATABASE_URL ?? null;
	if (!databaseUrl?.trim()) throw new Error('TREESEED_DATABASE_URL is required for direct database platform operations.');
	const database = await createRelationalAdapterFromUrl(databaseUrl);
	return new PlatformOperationStore({ database, initializeSchema: options.initializeSchema ?? true });
}
