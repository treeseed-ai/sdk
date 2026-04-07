export interface KvNamespacePutOptions {
	expirationTtl?: number;
}

export interface KvNamespaceLike {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: KvNamespacePutOptions): Promise<void>;
}

export interface D1PreparedStatementLike {
	bind(...values: unknown[]): D1PreparedStatementLike;
	run(): Promise<unknown>;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
	raw<T = unknown[]>(): Promise<T[]>;
}

export interface D1DatabaseLike {
	prepare(query: string): D1PreparedStatementLike;
	batch?(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
	exec?(query: string): Promise<unknown>;
}

export interface CloudflareRuntimeAssets {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface CloudflareRuntime {
	env: {
		FORM_GUARD_KV: KvNamespaceLike;
		SITE_DATA_DB: D1DatabaseLike;
		SESSION: KvNamespaceLike;
		ASSETS?: CloudflareRuntimeAssets;
	};
}
