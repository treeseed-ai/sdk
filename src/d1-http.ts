import type { D1DatabaseLike, D1PreparedStatementLike } from './types/cloudflare.ts';

type D1QueryResult<T = Record<string, unknown>> = {
	success?: boolean;
	results?: T[];
	meta?: Record<string, unknown>;
};

type D1ApiResponse<T = Record<string, unknown>> = {
	success?: boolean;
	errors?: Array<{ message?: string }>;
	result?: Array<D1QueryResult<T>>;
};

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

export interface CloudflareHttpD1DatabaseOptions {
	accountId: string;
	databaseId: string;
	apiToken: string;
	fetchImpl?: typeof fetch;
}

class CloudflareHttpD1PreparedStatement implements D1PreparedStatementLike {
	private bindings: unknown[] = [];

	constructor(
		private readonly endpoint: string,
		private readonly apiToken: string,
		private readonly fetchImpl: typeof fetch,
		private readonly query: string,
	) {}

	bind(...values: unknown[]) {
		this.bindings = values;
		return this;
	}

	private async execute<T = Record<string, unknown>>() {
		const response = await this.fetchImpl(this.endpoint, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${this.apiToken}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				sql: this.query,
				params: this.bindings,
			}),
		});
		const payload = await response.json().catch(() => ({})) as D1ApiResponse<T>;
		if (!response.ok || payload.success === false || payload.errors?.length) {
			const message = payload.errors?.[0]?.message || `Cloudflare D1 request failed with ${response.status}.`;
			throw new Error(message);
		}
		return payload.result ?? [];
	}

	async run() {
		return this.execute();
	}

	async all<T = Record<string, unknown>>() {
		const result = await this.execute<T>();
		return {
			results: result.flatMap((entry) => entry.results ?? []),
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

export class CloudflareHttpD1Database implements D1DatabaseLike {
	private readonly endpoint: string;
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly options: CloudflareHttpD1DatabaseOptions) {
		this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/d1/database/${options.databaseId}/query`;
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	prepare(query: string) {
		return new CloudflareHttpD1PreparedStatement(this.endpoint, this.options.apiToken, this.fetchImpl, query);
	}

	async exec(query: string) {
		return this.prepare(query).run();
	}
}

export function interpolateD1Query(query: string, bindings: unknown[]) {
	return interpolateBindings(query, bindings);
}
