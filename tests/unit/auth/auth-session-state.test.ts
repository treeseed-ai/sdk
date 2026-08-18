import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveApiConfig } from '../../../src/api/configuration/config.ts';
import { D1AuthProvider } from '../../../src/api/auth/d1-provider.ts';
import { NodeSqliteD1Database } from '../../../src/db/node-sqlite.ts';

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

function createAuthProvider(sqlite: NodeSqliteD1Database, bootstrapAdminAllowlist = '') {
	return new D1AuthProvider(resolveApiConfig({
		HOST: '127.0.0.1',
		PORT: '3000',
		TREESEED_API_AUTH_SECRET: 'test-auth-secret',
		TREESEED_API_REPO_ROOT: process.cwd(),
		TREESEED_API_BOOTSTRAP_ADMIN_ALLOWLIST: bootstrapAdminAllowlist,
	}), { db: sqlite });
}

describe('D1 auth session state', () => {
	it('reconciles an existing allowlisted user when the configured API starts', async () => {
		const sqlite = new NodeSqliteD1Database(join(mkdtempSync(join(tmpdir(), 'bootstrap-admin-')), 'auth.sqlite'));
		try {
			const originalProvider = createAuthProvider(sqlite);
			const user = await originalProvider.createUser({ email: 'original-admin@example.test' });
			expect(user.principal.roles).toEqual(['member']);

			const configuredProvider = createAuthProvider(sqlite, 'original-admin@example.test');
			const session = await configuredProvider.issueUserSession(user.principal.id);
			expect(session.principal.roles).toContain('platform_admin');

			const events = await sqlite.prepare(
				`SELECT event_type FROM audit_events WHERE target_id = ? AND event_type = ?`,
			).bind(user.principal.id, 'auth.bootstrap_admin').all();
			expect(events.results).toHaveLength(1);
		} finally {
			sqlite.close();
		}
	});

	it('adopts existing acceptance users by username when retrying a partial seed', async () => {
		const { provider, sqlite } = createAuthHarness();
		try {
			await provider.createUser({
				email: 'treeseed+acceptance-staging-siteadmin@treeseed.ai',
				username: 'acceptance-staging-siteadmin',
				displayName: 'Acceptance SiteAdmin',
			});

			const synced = await provider.syncUserIdentity({
				provider: 'acceptance',
				providerSubject: 'acceptance-staging:siteAdmin',
				email: 'treeseed+acceptance-staging-siteadmin@treeseed.ai',
				emailVerified: true,
				username: 'acceptance-staging-siteadmin',
				displayName: 'Acceptance SiteAdmin',
				profile: {
					acceptance: true,
					namespace: 'acceptance-staging',
					actorId: 'siteAdmin',
				},
			});

			const users = await sqlite.prepare('SELECT id, username FROM users WHERE username = ?').bind('acceptance-staging-siteadmin').all();
			const identities = await sqlite.prepare('SELECT user_id FROM user_identities WHERE provider = ? AND provider_subject = ?')
				.bind('acceptance', 'acceptance-staging:siteAdmin')
				.all();

			expect(users.results).toHaveLength(1);
			expect(identities.results).toEqual([{ user_id: synced.principal.id }]);
			expect(synced.userId).toBe(synced.principal.id);
			expect(users.results?.[0]).toMatchObject({ username: 'acceptance-staging-siteadmin' });
		} finally {
			sqlite.close();
		}
	});

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
