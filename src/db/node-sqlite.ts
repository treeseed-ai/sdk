import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../types/cloudflare.ts';
import { treeseedSchema } from './schema.ts';

function isDirectoryLike(path: string) {
	return !/\.(sqlite|sqlite3|db)$/iu.test(path);
}

export function resolveTreeseedSqlitePath(input?: string | null) {
	const base = input?.trim() || '.treeseed/generated/environments/local/site-data.sqlite';
	return isDirectoryLike(base) ? resolve(base, 'site-data.sqlite') : resolve(base);
}

function toD1Result(result: { changes?: number; lastInsertRowid?: number | bigint } | undefined, rows: Record<string, unknown>[] = []) {
	const changes = Number(result?.changes ?? 0);
	return {
		success: true,
		results: rows,
		meta: {
			duration: 0,
			size_after: 0,
			rows_read: rows.length,
			rows_written: changes,
			last_row_id: Number(result?.lastInsertRowid ?? 0),
			changed_db: changes > 0,
			changes,
		},
	};
}

class NodeSqliteD1PreparedStatement implements D1PreparedStatementLike {
	private bindings: unknown[] = [];

	constructor(
		private readonly client: DatabaseSync,
		private readonly query: string,
	) {}

	bind(...values: unknown[]) {
		this.bindings = values;
		return this;
	}

	async run() {
		const statement = this.client.prepare(this.query);
		return toD1Result(statement.run(...this.bindings) as { changes?: number; lastInsertRowid?: number | bigint });
	}

	async all<T = Record<string, unknown>>() {
		const statement = this.client.prepare(this.query);
		const rows = statement.all(...this.bindings) as Record<string, unknown>[];
		return toD1Result(undefined, rows) as {
			success: true;
			results: T[];
			meta: Record<string, unknown>;
		};
	}

	async first<T = Record<string, unknown>>() {
		const statement = this.client.prepare(this.query);
		return (statement.get(...this.bindings) ?? null) as T | null;
	}

	async raw<T = unknown[]>() {
		const { results } = await this.all<Record<string, unknown>>();
		return results.map((entry) => Object.values(entry)) as T[];
	}
}

export class NodeSqliteD1Database implements D1DatabaseLike {
	readonly client: DatabaseSync;
	readonly path: string;

	constructor(path?: string | null) {
		this.path = resolveTreeseedSqlitePath(path);
		mkdirSync(dirname(this.path), { recursive: true });
		this.client = new DatabaseSync(this.path);
		this.client.exec('PRAGMA foreign_keys = ON;');
		this.client.exec('PRAGMA journal_mode = WAL;');
	}

	prepare(query: string) {
		return new NodeSqliteD1PreparedStatement(this.client, query);
	}

	async exec(query: string) {
		this.client.exec(query);
		return toD1Result(undefined);
	}

	async batch(statements: D1PreparedStatementLike[]) {
		const results: unknown[] = [];
		this.client.exec('BEGIN');
		try {
			for (const statement of statements) {
				results.push(await statement.run());
			}
			this.client.exec('COMMIT');
			return results;
		} catch (error) {
			this.client.exec('ROLLBACK');
			throw error;
		}
	}

	close() {
		this.client.close();
	}
}

export function createTreeseedNodeSqliteDrizzle(path?: string | null) {
	const database = new NodeSqliteD1Database(path);
	return {
		d1: database,
		db: drizzle(async (sql, params, method) => {
			const statement = database.client.prepare(sql);
			if (method === 'run') {
				statement.run(...params);
				return { rows: [] };
			}
			if (method === 'get') {
				const row = statement.get(...params);
				return { rows: row ? [row] : [] };
			}
			if (method === 'values') {
				return { rows: statement.all(...params).map((row) => Object.values(row as Record<string, unknown>)) };
			}
			return { rows: statement.all(...params) };
		}, { schema: treeseedSchema }),
	};
}
