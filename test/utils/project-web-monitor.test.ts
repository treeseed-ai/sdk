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
	it('normalizes mocked healthy monitor checks', async () => {
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
			mockExternal: true,
		});

		expect(result.status).toBe('healthy');
		expect(result.checks.map((check) => [check.key, check.status])).toEqual([
			['latest_workflow', 'passed'],
			['workflow_file', 'passed'],
			['web_host', 'passed'],
			['target_url', 'passed'],
			['http_response', 'passed'],
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
			mockExternal: true,
		});

		expect(result.status).toBe('failed');
		expect(result.checks.find((check) => check.key === 'latest_workflow')).toMatchObject({
			status: 'failed',
			inspectCommand: 'gh run view 456 --repo acme/widget --log-failed',
		});
	});

	it('normalizes workflow file absence through mocked GitHub API clients', async () => {
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
			dryRun: false,
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
			mockExternal: false,
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
			mockExternal: false,
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
			target,
			workflowResult: { runId: 789, status: 'completed', conclusion: 'success' },
			mockExternal: true,
		});

		expect(result.checks.find((check) => check.key === 'content_publish')).toMatchObject({
			status: 'passed',
			summary: 'Content publish workflow completed.',
		});
		expect(result.checks.find((check) => check.key === 'd1_migration')).toMatchObject({ status: 'skipped' });
		expect(result.checks.find((check) => check.key === 'form_api_route')).toMatchObject({ status: 'skipped' });
	});
});
