import type { D1DatabaseLike } from '../types/cloudflare.ts';

export type DatabaseRow = Record<string, unknown>;

export function nowIso() {
	return new Date().toISOString();
}

export function toSqlValue(value: unknown) {
	if (value === null || value === undefined) {
		return 'NULL';
	}
	if (typeof value === 'number') {
		return String(value);
	}
	if (typeof value === 'boolean') {
		return value ? '1' : '0';
	}
	return `'${String(value).replace(/'/g, "''")}'`;
}

export class SqliteStoreBase {
	constructor(protected readonly db: D1DatabaseLike) {}

	protected async selectAll(query: string) {
		const result = await this.db.prepare(query).all<DatabaseRow>();
		return result.results ?? [];
	}

	protected async selectFirst(query: string) {
		return this.db.prepare(query).first<DatabaseRow>();
	}

	protected async execute(query: string) {
		await this.db.prepare(query).run();
	}

	protected async tableExists(tableName: string) {
		const row = await this.selectFirst(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${toSqlValue(tableName)} LIMIT 1`,
		);
		return Boolean(row?.name);
	}
}
