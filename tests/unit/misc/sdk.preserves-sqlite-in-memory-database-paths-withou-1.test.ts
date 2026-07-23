import { describe, expect, it } from 'vitest';

import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { CloudflareD1AgentDatabase, MemoryAgentDatabase } from '../../../src/d1-store.ts';

import { NodeSqliteD1Database, resolveTreeseedSqlitePath } from '../../../src/db/node-sqlite.ts';

import { AgentSdk } from '../../../src/sdk.ts';

import { sdkFixtureRoot } from '../../support/test-fixture.ts';

function createTempContentSite() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-site-'));
	const pagesRoot = resolve(root, 'src', 'content', 'pages');
	const templatesRoot = resolve(root, 'src', 'content', 'templates');
	mkdirSync(pagesRoot, { recursive: true });
	mkdirSync(templatesRoot, { recursive: true });
	writeFileSync(
		resolve(pagesRoot, 'older.mdx'),
		`---
title: Older
slug: older
updated: 2026-04-07T00:00:00.000Z
---
Older body
`,
		'utf8',
	);
	writeFileSync(
		resolve(pagesRoot, 'newer.mdx'),
		`---
title: Newer
slug: newer
updated: 2026-04-08T00:00:00.000Z
---
Newer body
`,
		'utf8',
	);
	writeFileSync(
		resolve(pagesRoot, 'aliased.mdx'),
		`---
title: Aliased
slug: aliased
updatedAt: 2026-04-09T00:00:00.000Z
---
Aliased body
`,
		'utf8',
	);
	writeFileSync(
		resolve(templatesRoot, 'fixture-template.mdx'),
		`---
title: Fixture Template
slug: fixture-template
status: active
category: starter
tags:
  - fixture
templateVersion: 1.0.0
updatedAt: 2026-04-10T00:00:00.000Z
---
Fixture template body
`,
		'utf8',
	);
	return root;
}
describe('Node SQLite D1 path resolution', () => {
it('preserves SQLite in-memory database paths without creating a repository directory', () => {
		const database = new NodeSqliteD1Database(':memory:');
		try {
			expect(database.path).toBe(':memory:');
			expect(resolveTreeseedSqlitePath(':memory:')).toBe(':memory:');
			expect(existsSync(resolve(process.cwd(), ':memory:'))).toBe(false);
		} finally {
			database.close();
		}
	});

it('prefers Wrangler Miniflare SQLite files when a D1 state directory is provided', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-d1-state-'));
		const d1Root = resolve(root, 'v3', 'd1');
		const miniflareRoot = resolve(d1Root, 'miniflare-D1DatabaseObject');
		mkdirSync(miniflareRoot, { recursive: true });
		writeFileSync(resolve(d1Root, 'site-data.sqlite'), 'small');
		writeFileSync(resolve(miniflareRoot, 'metadata.sqlite'), 'metadata');
		writeFileSync(resolve(miniflareRoot, 'local.sqlite'), 'larger local database');

		expect(resolveTreeseedSqlitePath(d1Root)).toBe(resolve(miniflareRoot, 'local.sqlite'));
	});
});
