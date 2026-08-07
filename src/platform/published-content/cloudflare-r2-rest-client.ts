export interface CloudflareR2RestConfig {
	authMode: 'api-token';
	accountId: string;
	bucket: string;
	apiToken: string;
}

interface PutOptions { contentType: string; ifMatch?: string; ifNoneMatch?: '*'; }

const encodeKey = (value: string) => value.split('/').map(encodeURIComponent).join('/');

export class CloudflareR2RestClient {
	constructor(private readonly config: CloudflareR2RestConfig, private readonly fetchImpl: typeof fetch = fetch) {}

	private url(key: string) {
		return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.accountId)}/r2/buckets/${encodeURIComponent(this.config.bucket)}/objects/${encodeKey(key)}`;
	}
	private collectionUrl(query?: URLSearchParams) {
		const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.accountId)}/r2/buckets/${encodeURIComponent(this.config.bucket)}/objects`;
		return query?.size ? `${base}?${query}` : base;
	}

	private async request(method: string, key: string, body?: string, headers: Record<string, string> = {}) {
		return this.fetchImpl(this.url(key), { method, body, headers: { authorization: `Bearer ${this.config.apiToken}`, ...headers } });
	}

	async get(key: string) {
		const response = await this.request('GET', key);
		if (response.status === 404) return null;
		if (!response.ok) throw new Error(`R2 REST read failed for ${key} (HTTP ${response.status}).`);
		return { body: await response.text(), etag: response.headers.get('etag') ?? response.headers.get('cf-r2-object-version') };
	}

	async exists(key: string) {
		const response = await this.request('HEAD', key);
		if (response.status === 404) return false;
		if (!response.ok) throw new Error(`R2 REST head failed for ${key} (HTTP ${response.status}).`);
		return true;
	}

	async put(key: string, body: string, options: PutOptions) {
		const headers: Record<string, string> = { 'content-type': options.contentType };
		if (options.ifMatch) headers['if-match'] = options.ifMatch;
		if (options.ifNoneMatch) headers['if-none-match'] = options.ifNoneMatch;
		const response = await this.request('PUT', key, body, headers);
		if (response.status === 409 || response.status === 412) throw new Error(`R2 REST conditional write conflict for ${key}.`);
		if (!response.ok) throw new Error(`R2 REST write failed for ${key} (HTTP ${response.status}).`);
	}

	async delete(key: string) {
		const response = await this.request('DELETE', key);
		if (!response.ok && response.status !== 404) throw new Error(`R2 REST delete failed for ${key} (HTTP ${response.status}).`);
	}

	async list(prefix: string) {
		const keys: string[] = [];
		let cursor = '';
		for (let page = 0; page < 10_000; page += 1) {
			const query = new URLSearchParams({ prefix, per_page: '1000' });
			if (cursor) query.set('cursor', cursor);
			const response = await this.fetchImpl(this.collectionUrl(query), { headers: { authorization: `Bearer ${this.config.apiToken}` } });
			if (!response.ok) throw new Error(`R2 REST list failed for ${prefix} (HTTP ${response.status}).`);
			const envelope = await response.json() as { result?: { objects?: Array<{ key?: string }>; cursor?: string }; success?: boolean };
			if (envelope.success === false) throw new Error(`R2 REST list failed for ${prefix}.`);
			keys.push(...(envelope.result?.objects ?? []).map((entry) => String(entry.key ?? '')).filter(Boolean));
			const next = String(envelope.result?.cursor ?? '');
			if (!next) return keys;
			if (next === cursor) throw new Error('R2 REST list repeated its cursor.');
			cursor = next;
		}
		throw new Error('R2 REST list exceeded the bounded pagination limit.');
	}
}
