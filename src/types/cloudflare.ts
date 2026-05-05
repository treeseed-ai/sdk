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

export interface R2ObjectBodyLike {
	text(): Promise<string>;
	arrayBuffer(): Promise<ArrayBuffer>;
	json<T = unknown>(): Promise<T>;
}

export interface R2ObjectLike extends R2ObjectBodyLike {
	httpEtag?: string;
	etag?: string;
	size?: number;
	uploaded?: Date;
	writeHttpMetadata?(headers: Headers): void;
}

export interface R2PutOptionsLike {
	httpMetadata?: Record<string, unknown>;
	customMetadata?: Record<string, string>;
}

export interface R2BucketLike {
	get(key: string): Promise<R2ObjectLike | null>;
	head?(key: string): Promise<R2ObjectLike | null>;
	put(
		key: string,
		value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
		options?: R2PutOptionsLike,
	): Promise<unknown>;
	delete?(key: string | string[]): Promise<void>;
}

export interface CloudflareRuntime {
	env: {
		FORM_GUARD_KV: KvNamespaceLike;
		SITE_DATA_DB: D1DatabaseLike;
		ASSETS?: CloudflareRuntimeAssets;
		[key: string]: unknown;
	};
}
