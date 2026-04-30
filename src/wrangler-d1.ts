import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { D1DatabaseLike, D1PreparedStatementLike } from './types/cloudflare.ts';
import { resolveTreeseedToolCommand } from './managed-dependencies.ts';

const execFileAsync = promisify(execFile);

function toSqlValue(value: unknown) {
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

function interpolateBindings(query: string, values: unknown[]) {
	let result = query;
	for (const value of values) {
		result = result.replace(/\?/, toSqlValue(value));
	}
	return result;
}

class WranglerD1PreparedStatement implements D1PreparedStatementLike {
	private bindings: unknown[] = [];

	constructor(
		private readonly databaseName: string,
		private readonly cwd: string,
		private readonly persistTo?: string,
		private readonly query = '',
	) {}

	bind(...values: unknown[]) {
		this.bindings = values;
		return this;
	}

	private async execute() {
		const args = ['d1', 'execute', this.databaseName, '--json', '--command', interpolateBindings(this.query, this.bindings)];
		if (this.persistTo) {
			args.splice(3, 0, '--local', '--persist-to', this.persistTo);
		}

		const wrangler = resolveTreeseedToolCommand('wrangler');
		if (!wrangler) {
			throw new Error('Wrangler CLI is unavailable.');
		}
		const { stdout } = await execFileAsync(wrangler.command, [...wrangler.argsPrefix, ...args], {
			cwd: this.cwd,
			env: process.env,
		});
		const parsed = JSON.parse(stdout);
		return Array.isArray(parsed) ? parsed : [parsed];
	}

	async run() {
		return this.execute();
	}

	async all<T = Record<string, unknown>>() {
		const results = await this.execute();
		return {
			results: results.flatMap((entry) => entry.results ?? []) as T[],
		};
	}

	async first<T = Record<string, unknown>>() {
		const { results } = await this.all<T>();
		return results[0] ?? null;
	}

	async raw<T = unknown[]>() {
		const { results } = await this.all<Record<string, unknown>>();
		return results.map((entry) => Object.values(entry)) as T[];
	}
}

export class WranglerD1Database implements D1DatabaseLike {
	constructor(
		private readonly databaseName: string,
		private readonly cwd: string,
		private readonly persistTo?: string,
	) {}

	prepare(query: string) {
		return new WranglerD1PreparedStatement(this.databaseName, this.cwd, this.persistTo, query);
	}
}
