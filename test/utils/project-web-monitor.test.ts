import { describe, expect, it } from 'vitest';
import { buildProjectWebMonitorResult } from '../../src/operations/services/project-web-monitor.ts';

const repository = {
	owner: 'acme',
	name: 'widget',
	branch: 'staging',
	workflowFile: 'deploy-web.yml',
};

const target = {
	url: 'https://staging.example.test',
	capacityProviderId: 'forbidden-provider',
	runnerToken: 'forbidden-token',
};

describe('project web monitor helper', () => {
	it('normalizes a recorded healthy workflow while planning external probes', async () => {
		const result = await buildProjectWebMonitorResult({
			environment: 'staging',
			action: 'deploy_web',
			repository,
			target,
			workflowResult: {
				runId: 123,
				status: 'completed',
				conclusion: 'success',
				runUrl: 'https://github.com/acme/widget/actions/runs/123',
			},
			planOnly: true,
		});

		expect(result.status).toBe('healthy');
		expect(result.checks.map((check) => [check.key, check.status])).toEqual([
			['latest_workflow', 'passed'],
			['workflow_file', 'skipped'],
			['web_host', 'passed'],
			['target_url', 'passed'],
			['http_response', 'skipped'],
			['content_runtime', 'skipped'],
			['content_publish', 'skipped'],
			['d1_migration', 'skipped'],
			['form_api_route', 'skipped'],
		]);
		expect(result.urls).toEqual([
			'https://github.com/acme/widget/actions/runs/123',
			'https://staging.example.test/',
		]);
		expect(JSON.stringify(result)).not.toMatch(/forbidden-provider|forbidden-token|capacityProviderId|runnerToken/u);
	});

	it('marks workflow failures failed with an inspect command', async () => {
		const result = await buildProjectWebMonitorResult({
			environment: 'staging',
			action: 'monitor',
			repository,
			target,
			workflowResult: {
				runId: 456,
				status: 'completed',
				conclusion: 'failure',
				runUrl: 'https://github.com/acme/widget/actions/runs/456',
			},
			planOnly: true,
		});

		expect(result.status).toBe('failed');
		expect(result.checks.find((check) => check.key === 'latest_workflow')).toMatchObject({
			status: 'failed',
			inspectCommand: 'gh run view 456 --repo acme/widget --log-failed',
		});
	});

	it('normalizes workflow file absence reported by the GitHub API boundary', async () => {
		const client = {
			rest: {
				repos: {
					getContent: async () => {
						const error = new Error('Not Found') as Error & { status?: number };
						error.status = 404;
						throw error;
					},
				},
				actions: {
					listWorkflowRuns: async () => ({ data: { workflow_runs: [] } }),
				},
			},
		};

		const result = await buildProjectWebMonitorResult({
			environment: 'staging',
			action: 'monitor',
			repository,
			target,
			githubClient: client as any,
			planOnly: false,
			fetchImpl: null,
		});

		expect(result.status).toBe('failed');
		expect(result.checks.find((check) => check.key === 'workflow_file')).toMatchObject({
			status: 'failed',
			summary: 'deploy-web.yml is missing from acme/widget.',
		});
	});

	it('handles bounded HTTP probe warning and failure states', async () => {
		const warning = await buildProjectWebMonitorResult({
			environment: 'staging',
			action: 'monitor',
			repository,
			target,
			workflowResult: { runId: 1, status: 'completed', conclusion: 'success' },
			fetchImpl: async () => new Response('', { status: 503 }),
		});
		expect(warning.status).toBe('degraded');
		expect(warning.checks.find((check) => check.key === 'http_response')).toMatchObject({ status: 'warning' });

		const failed = await buildProjectWebMonitorResult({
			environment: 'staging',
			action: 'monitor',
			repository,
			target,
			workflowResult: { runId: 1, status: 'completed', conclusion: 'success' },
			fetchImpl: async () => new Response('', { status: 404 }),
		});
		expect(failed.status).toBe('failed');
		expect(failed.checks.find((check) => check.key === 'http_response')).toMatchObject({
			status: 'failed',
			summary: 'HTTP probe returned 404.',
		});
	});

	it('keeps content, D1, and form/API route checks explicit', async () => {
		const result = await buildProjectWebMonitorResult({
			environment: 'prod',
			action: 'publish_content',
			repository,
			target: {
				...target,
				architecture: {
					contentRuntimeSource: 'r2_published_manifest',
					contentPublishTarget: {
						kind: 'cloudflare_r2',
						manifestPath: 'teams/acme/published/common.json',
					},
				},
				contentRuntime: {
					r2: {
						manifestKey: 'teams/acme/published/common.json',
						revision: 'rev-1',
					},
				},
			},
			workflowResult: { runId: 789, status: 'completed', conclusion: 'success' },
			planOnly: true,
		});

		expect(result.contentRuntime).toMatchObject({
			contentRuntimeSource: 'r2_published_manifest',
			effectiveContentSource: 'r2_published_manifest',
			manifestKey: 'teams/acme/published/common.json',
			revision: 'rev-1',
		});
		expect(result.checks.find((check) => check.key === 'content_runtime')).toMatchObject({
			status: 'passed',
			source: 'r2',
		});
		expect(result.checks.find((check) => check.key === 'content_publish')).toMatchObject({
			status: 'passed',
			summary: 'Content publish completed for R2 manifest teams/acme/published/common.json.',
		});
		expect(result.checks.find((check) => check.key === 'd1_migration')).toMatchObject({ status: 'skipped' });
		expect(result.checks.find((check) => check.key === 'form_api_route')).toMatchObject({ status: 'skipped' });
	});

	it('marks TreeDX content publish as operations-runner to R2 rather than GitHub Actions', async () => {
		const result = await buildProjectWebMonitorResult({
			environment: 'staging',
			action: 'publish_content',
			repository: {
				provider: 'treedx',
				owner: 'acme',
				name: 'content',
			},
			target: {
				...target,
				architecture: {
					contentRuntimeSource: 'treedx_snapshot',
					contentPublishTarget: {
						kind: 'cloudflare_r2',
						manifestPath: 'teams/acme/published/common.json',
					},
				},
				contentPublish: {
					provider: 'treedx',
					snapshotId: 'snap_1',
					r2: {
						manifestKey: 'teams/acme/published/common.json',
						revision: 'snap_1',
						withoutGitHubActions: true,
					},
				},
			},
			planOnly: true,
		});

		expect(result.contentRuntime).toMatchObject({
			contentRuntimeSource: 'treedx_snapshot',
			effectiveContentSource: 'treedx_snapshot',
			snapshotId: 'snap_1',
		});
		expect(result.checks.find((check) => check.key === 'latest_workflow')).toMatchObject({
			status: 'skipped',
			source: 'treedx',
		});
		expect(result.checks.find((check) => check.key === 'workflow_file')).toMatchObject({
			status: 'skipped',
			source: 'treedx',
		});
		expect(result.checks.find((check) => check.key === 'content_runtime')).toMatchObject({
			status: 'passed',
			source: 'treedx',
		});
		expect(result.checks.find((check) => check.key === 'content_publish')).toMatchObject({
			status: 'passed',
			source: 'treedx',
			summary: 'TreeDX content snapshot snap_1 was published to R2 without GitHub Actions.',
		});
	});
});
