import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RemoteTemplateCatalogClient, parseTemplateCatalogResponse } from '../../src/template-catalog.ts';

describe('template catalog client', () => {
	it('normalizes array and envelope response shapes', () => {
		const normalized = parseTemplateCatalogResponse({
			payload: {
				items: [
					{
						id: 'starter-basic',
						title: 'TreeSeed Basic',
						description: 'Starter',
						summary: 'Starter summary',
						status: 'live',
						category: 'starter',
						publisher: {
							id: 'treeseed',
							name: 'TreeSeed',
						},
						templateVersion: '1.0.0',
						templateApiVersion: 1,
						minCliVersion: '0.1.1',
						minCoreVersion: '0.1.2',
						fulfillment: {
							source: {
								repoUrl: 'https://example.com/repo.git',
								directory: 'templates/starter-basic',
								ref: 'main',
							},
							hooksPolicy: 'builtin_only',
							supportsReconcile: true,
						},
					},
				],
			},
		});

		expect(normalized.items).toHaveLength(1);
		expect(normalized.items[0]?.displayName).toBe('TreeSeed Basic');
		expect(normalized.items[0]?.fulfillment.source.directory).toBe('templates/starter-basic');
	});

	it('loads catalog entries from a file endpoint', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-template-catalog-'));
		const fixturePath = resolve(root, 'catalog.json');
		writeFileSync(fixturePath, JSON.stringify({
			items: [
				{
					id: 'starter-basic',
					displayName: 'TreeSeed Basic',
					description: 'Starter',
					summary: 'Starter summary',
					status: 'live',
					category: 'starter',
					publisher: {
						id: 'treeseed',
						name: 'TreeSeed',
					},
					templateVersion: '1.0.0',
					templateApiVersion: 1,
					minCliVersion: '0.1.1',
					minCoreVersion: '0.1.2',
					fulfillment: {
						source: {
							repoUrl: 'https://example.com/repo.git',
							directory: 'templates/starter-basic',
							ref: 'main',
						},
						hooksPolicy: 'builtin_only',
						supportsReconcile: true,
					},
				},
			],
		}), 'utf8');

		const client = new RemoteTemplateCatalogClient({
			endpoint: `file:${fixturePath}`,
		});
		const catalog = await client.listTemplates();

		expect(catalog.items).toHaveLength(1);
		expect(catalog.items[0]?.id).toBe('starter-basic');
	});
});
