import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveApiConfig } from '../../src/api/config.ts';
import { D1AuthProvider } from '../../src/api/auth/d1-provider.ts';
import { NodeSqliteD1Database } from '../../src/db/node-sqlite.ts';

function createAuthHarness() {
	const sqlite = new NodeSqliteD1Database(join(mkdtempSync(join(tmpdir(), 'treeseed-auth-session-')), 'auth.sqlite'));
	const provider = new D1AuthProvider(resolveApiConfig({
		HOST: '127.0.0.1',
		PORT: '3000',
		TREESEED_API_AUTH_SECRET: 'test-auth-secret',
		TREESEED_API_REPO_ROOT: process.cwd(),
	}), { db: sqlite });
	return { provider, sqlite };
}

describe('D1 auth session state', () => {
	it('requires issued web-session access tokens to still have a live session row', async () => {
		const { provider, sqlite } = createAuthHarness();
		try {
			const user = await provider.createUser({
				email: 'dev@example.test',
				displayName: 'Dev User',
			});
			const session = await provider.issueUserSession(user.principal.id, {
				sessionType: 'web',
				data: { source: 'test' },
			});

			await expect(provider.authenticateBearerToken(session.accessToken)).resolves.toMatchObject({
				principal: { id: user.principal.id },
				credential: { type: 'access_token' },
			});

			await sqlite.prepare('DELETE FROM auth_sessions').run();

			await expect(provider.authenticateBearerToken(session.accessToken)).resolves.toBeNull();
		} finally {
			sqlite.close();
		}
	});
});
