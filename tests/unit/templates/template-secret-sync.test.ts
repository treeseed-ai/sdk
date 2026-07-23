import { describe, expect, it } from 'vitest';
import {
	ProjectLaunchSecretSyncError,
	resolveProjectLaunchSecretValueOverlay,
	syncProjectLaunchHostBindingSecrets,
} from '../../../src/operations/services/template-secret-sync.ts';
import type { ProjectLaunchSecretDeploymentPlanItem } from '../../../src/template-launch-requirements.ts';

function secretItem(overrides: Partial<ProjectLaunchSecretDeploymentPlanItem> = {}): ProjectLaunchSecretDeploymentPlanItem {
	return {
		requirementKey: 'transactionalEmail',
		requirementKind: 'host',
		env: 'TREESEED_SMTP_PASSWORD',
		sensitivity: 'secret',
		source: 'selectedHost.config:TREESEED_SMTP_PASSWORD',
		targets: ['github-secret', 'cloudflare-secret', 'railway-secret'],
		scopes: ['staging', 'prod'],
		sourceHostId: 'smtp-host-1',
		...overrides,
	};
}

describe('project launch host-bound secret sync', () => {
	it('resolves host-bound launch values without adding diagnostics', () => {
		const result = resolveProjectLaunchSecretValueOverlay({
			secretDeploymentPlan: { items: [secretItem()] },
			valuesOverlay: {
				TREESEED_SMTP_PASSWORD: 'smtp-password-secret',
			},
		});

		expect(result.valuesOverlay).toMatchObject({
			TREESEED_SMTP_PASSWORD: 'smtp-password-secret',
		});
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			env: 'TREESEED_SMTP_PASSWORD',
			resolved: true,
			targets: ['github-secret', 'cloudflare-secret', 'railway-secret'],
		});
		expect(result.diagnostics).toEqual([]);
	});

	it('syncs provider-specific entries through existing provider adapters and redacts summaries', async () => {
		const calls: Array<{ provider: string; scope: string; entryIds: string[]; value: string | undefined }> = [];
		const result = await syncProjectLaunchHostBindingSecrets({
			projectRoot: '/tmp/project',
			repository: 'acme/test-project',
			secretDeploymentPlan: { items: [secretItem()] },
			valuesOverlay: {
				TREESEED_SMTP_PASSWORD: 'smtp-password-secret',
			},
			adapters: {
				github: (async (input: any) => {
					calls.push({
						provider: 'github',
						scope: input.scope,
						entryIds: input.entryIds,
						value: input.valuesOverlay.TREESEED_SMTP_PASSWORD,
					});
					return {
						repository: input.repository,
						scope: input.scope,
						environment: input.scope === 'prod' ? 'production' : input.scope,
						secrets: [{ name: 'TREESEED_SMTP_PASSWORD', existed: false }],
						variables: [],
					};
				}) as any,
				cloudflare: ((input: any) => {
					calls.push({
						provider: 'cloudflare',
						scope: input.scope,
						entryIds: input.entryIds,
						value: input.valuesOverlay.TREESEED_SMTP_PASSWORD,
					});
					return {
						scope: input.scope,
						target: { kind: 'persistent', name: input.scope },
						wranglerPath: '/tmp/project/wrangler.generated.toml',
						secrets: ['TREESEED_SMTP_PASSWORD'],
						varsManagedByWranglerConfig: [],
					};
				}) as any,
				railway: ((input: any) => {
					calls.push({
						provider: 'railway',
						scope: input.scope,
						entryIds: input.entryIds,
						value: input.valuesOverlay.TREESEED_SMTP_PASSWORD,
					});
					return {
						scope: input.scope,
						services: [],
					};
				}) as any,
			},
		});

		expect(result.ok).toBe(true);
		expect(calls.map((call) => `${call.provider}:${call.scope}`)).toEqual([
			'github:staging',
			'github:prod',
			'cloudflare:staging',
			'cloudflare:prod',
			'railway:staging',
			'railway:prod',
		]);
		expect(calls.every((call) => call.entryIds.includes('TREESEED_SMTP_PASSWORD'))).toBe(true);
		expect(calls.every((call) => call.value === 'smtp-password-secret')).toBe(true);
		expect(result.items.every((item) => item.status === 'synced')).toBe(true);
		expect(JSON.stringify(result)).not.toContain('smtp-password-secret');
	});

	it('fails with requirement diagnostics when a planned secret value is missing', async () => {
		await expect(syncProjectLaunchHostBindingSecrets({
			projectRoot: '/tmp/project',
			repository: 'acme/test-project',
			secretDeploymentPlan: { items: [secretItem()] },
			processEnv: {},
			adapters: {
				github: (async () => {
					throw new Error('should not run');
				}) as any,
			},
		})).rejects.toMatchObject({
			name: 'ProjectLaunchSecretSyncError',
			result: {
				ok: false,
				diagnostics: [
					expect.objectContaining({
						code: 'missing_value',
						requirementKey: 'transactionalEmail',
						env: 'TREESEED_SMTP_PASSWORD',
					}),
				],
			},
		});
	});

	it('ignores non-provider-only targets during provider secret sync', async () => {
		const result = await syncProjectLaunchHostBindingSecrets({
			projectRoot: '/tmp/project',
			repository: 'acme/test-project',
			secretDeploymentPlan: {
				items: [
					secretItem({
						env: 'TREESEED_LOCAL_ONLY',
						targets: ['local-runtime', 'config-file'],
						scopes: ['local'],
					}),
				],
			},
		});

		expect(result).toMatchObject({
			ok: true,
			items: [],
			providers: [],
			diagnostics: [],
		});
	});

	it('redacts provider failure details', async () => {
		let error: ProjectLaunchSecretSyncError | null = null;
		try {
			await syncProjectLaunchHostBindingSecrets({
				projectRoot: '/tmp/project',
				repository: 'acme/test-project',
				secretDeploymentPlan: { items: [secretItem({ targets: ['github-secret'], scopes: ['prod'] })] },
				valuesOverlay: {
					TREESEED_SMTP_PASSWORD: 'smtp-password-secret',
				},
				adapters: {
					github: (async () => {
						throw new Error('failed token=smtp-password-secret');
					}) as any,
				},
			});
		} catch (caught) {
			error = caught as ProjectLaunchSecretSyncError;
		}

		expect(error).toBeInstanceOf(ProjectLaunchSecretSyncError);
		expect(JSON.stringify(error?.result)).not.toContain('smtp-password-secret');
		expect(error?.result.providers[0]).toMatchObject({
			provider: 'github',
			scope: 'prod',
			status: 'failed',
		});
	});
});
