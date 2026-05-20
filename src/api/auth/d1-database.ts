import { CloudflareHttpD1Database } from '../../d1-http.ts';
import { NodeSqliteD1Database } from '../../db/node-sqlite.ts';
import type { D1DatabaseLike } from '../../types/cloudflare.ts';
import type { ApiConfig } from '../types.ts';

export function resolveApiD1Database(config: ApiConfig): D1DatabaseLike {
	if (config.cloudflareAccountId && config.cloudflareApiToken && config.d1DatabaseId) {
		return new CloudflareHttpD1Database({
			accountId: config.cloudflareAccountId,
			apiToken: config.cloudflareApiToken,
			databaseId: config.d1DatabaseId,
		});
	}

	if (config.d1LocalPersistTo || config.d1DatabaseName) {
		return new NodeSqliteD1Database(config.d1LocalPersistTo);
	}

	throw new Error(
		'Treeseed API auth requires either CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN + TREESEED_API_D1_DATABASE_ID for remote D1 access, or TREESEED_API_D1_LOCAL_PERSIST_TO for local SQLite-backed D1-compatible access.',
	);
}
