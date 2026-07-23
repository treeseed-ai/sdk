import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RemoteTemplateCatalogClient, parseTemplateCatalogResponse } from '../../../src/template-catalog.ts';

describe('template catalog client', () => {
	it('normalizes array and envelope response shapes', () => {
		const normalized = parseTemplateCatalogResponse({
			payload: {
				items: [
					{
						id: 'fixture-template',
						title: 'Fixture Template',
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
								directory: 'templates/fixture-template',
								ref: 'main',
							},
							hooksPolicy: 'builtin_only',
							supportsReconcile: true,
						},
						launchRequirements: {
							version: 1,
							hosts: [{
								kind: 'host',
								key: 'sourceRepository',
								type: 'repository',
								required: true,
								compatibleProviders: ['github'],
								displayName: 'Source repository',
								purpose: 'Create the source repository.',
								configWrites: [{
									target: 'treeseed.site.yaml',
									path: 'hosting.hostBindings.sourceRepository.provider',
									valueFrom: 'selectedHost.provider',
								}],
							}],
						},
					},
				],
			},
		});

		expect(normalized.items).toHaveLength(1);
		expect(normalized.items[0]?.displayName).toBe('Fixture Template');
		expect(normalized.items[0]?.fulfillment.source.directory).toBe('templates/fixture-template');
		expect(normalized.items[0]?.launchRequirements?.hosts?.[0]?.key).toBe('sourceRepository');
	});

	it('loads catalog entries from a file endpoint', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-template-catalog-'));
		const fixturePath = resolve(root, 'catalog.json');
		writeFileSync(fixturePath, JSON.stringify({
			items: [
				{
					id: 'fixture-template',
					displayName: 'Fixture Template',
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
							directory: 'templates/fixture-template',
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
		expect(catalog.items[0]?.id).toBe('fixture-template');
	});
});
