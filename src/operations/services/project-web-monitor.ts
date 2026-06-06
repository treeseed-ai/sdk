import {
	getGitHubWorkflowFileStatus,
	getLatestGitHubWorkflowRun,
	type GitHubApiClient,
	type GitHubWorkflowRunSummary,
} from './github-api.ts';
import type {
	ProjectDeploymentEnvironment,
	ProjectWebMonitorCheck,
	ProjectWebMonitorCheckStatus,
	ProjectWebMonitorResult,
	ProjectWebMonitorStatus,
} from '../../sdk-types.ts';

const FORBIDDEN_MONITOR_FIELDS = new Set([
	'capacityProviderId',
	'laneId',
	'grantId',
	'workerPoolId',
	'runtimeHostId',
	'railwayServiceId',
	'runnerToken',
]);

function text(value: unknown, fallback = '') {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function objectValue(value: unknown): Record<string, any> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function repositorySlug(repository: unknown) {
	const record = objectValue(repository);
	const owner = text(record.owner);
	const name = text(record.name);
	return owner && name ? `${owner}/${name}` : null;
}

function externalUrl(...values: unknown[]) {
	for (const value of values) {
		const raw = text(value);
		if (!raw) continue;
		try {
			const url = new URL(raw);
			if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
		} catch {
			continue;
		}
	}
	return null;
}

function redact<T>(value: T): T {
	if (Array.isArray(value)) return value.map((entry) => redact(entry)) as T;
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.filter(([key]) => !FORBIDDEN_MONITOR_FIELDS.has(key))
		.filter(([key]) => !/(?:secret|token|password|apiKey|privateKey)/iu.test(key))
		.map(([key, entry]) => [key, redact(entry)])) as T;
}

function check(input: ProjectWebMonitorCheck): ProjectWebMonitorCheck {
	return redact(input);
}

function workflowStatusFromConclusion(conclusion: string | null | undefined): ProjectWebMonitorCheckStatus {
	if (conclusion === 'success') return 'passed';
	if (conclusion === 'cancelled' || conclusion === 'failure' || conclusion === 'timed_out') return 'failed';
	if (conclusion) return 'warning';
	return 'warning';
}

function statusFromChecks(checks: ProjectWebMonitorCheck[]): ProjectWebMonitorStatus {
	if (checks.some((entry) => entry.status === 'failed')) return 'failed';
	if (checks.some((entry) => entry.status === 'warning')) return 'degraded';
	if (checks.some((entry) => entry.status === 'passed')) return 'healthy';
	return 'unknown';
}

function workflowRunCheck(input: {
	workflowResult?: Record<string, any> | null;
	latestWorkflowRun?: GitHubWorkflowRunSummary | null;
	repository: string | null;
	workflowFile: string;
	treeDxPublish?: boolean;
}) {
	if (input.treeDxPublish) {
		return check({
			key: 'latest_workflow',
			label: 'Latest workflow',
			status: 'skipped',
			source: 'treedx',
			summary: 'TreeDX content publish does not dispatch a GitHub Actions workflow.',
		});
	}
	const run = input.workflowResult?.runId ? input.workflowResult : input.latestWorkflowRun;
	if (!run) {
		return check({
			key: 'latest_workflow',
			label: 'Latest workflow',
			status: 'skipped',
			source: 'github',
			summary: input.repository ? 'No workflow run was recorded for this deployment yet.' : 'Repository is unavailable, so workflow state was skipped.',
		});
	}
	const conclusion = text(run.conclusion, '');
	const runStatus = text(run.status, '');
	const status = runStatus === 'completed'
		? workflowStatusFromConclusion(conclusion)
		: 'warning';
	const runId = Number(run.runId ?? run.id);
	const inspectCommand = input.repository && Number.isFinite(runId) && runId > 0
		? `gh run view ${runId} --repo ${input.repository} --log-failed`
		: undefined;
	return check({
		key: 'latest_workflow',
		label: 'Latest workflow',
		status,
		source: 'github',
		summary: status === 'passed'
			? `${input.workflowFile} completed successfully.`
			: runStatus === 'completed'
				? `${input.workflowFile} completed with conclusion ${conclusion || 'unknown'}.`
				: `${input.workflowFile} is ${runStatus || 'active'}.`,
		url: externalUrl(run.url, run.runUrl),
		...(inspectCommand ? { inspectCommand } : {}),
	});
}

async function workflowFileCheck(input: {
	repository: string | null;
	workflowFile: string;
	githubClient?: GitHubApiClient | null;
	mockExternal?: boolean;
	dryRun?: boolean;
	treeDxPublish?: boolean;
}) {
	if (input.treeDxPublish) {
		return check({
			key: 'workflow_file',
			label: 'Workflow file',
			status: 'skipped',
			source: 'treedx',
			summary: 'TreeDX content publish uses the Market operations runner and Cloudflare R2 directly.',
		});
	}
	if (!input.repository) {
		return check({
			key: 'workflow_file',
			label: 'Workflow file',
			status: 'failed',
			source: 'github',
			summary: 'GitHub repository is not configured.',
		});
	}
	if (input.mockExternal || input.dryRun) {
		return check({
			key: 'workflow_file',
			label: 'Workflow file',
			status: 'passed',
			source: 'github',
			summary: `${input.workflowFile} is assumed present in mock mode.`,
		});
	}
	if (!input.githubClient) {
		return check({
			key: 'workflow_file',
			label: 'Workflow file',
			status: 'warning',
			source: 'github',
			summary: 'GitHub credentials are unavailable, so workflow file presence could not be verified.',
		});
	}
	const status = await getGitHubWorkflowFileStatus(input.repository, input.workflowFile, { client: input.githubClient }).catch((error) => ({
		ok: false,
		exists: null,
		repository: input.repository,
		workflow: input.workflowFile,
		url: null,
		message: error instanceof Error ? error.message : String(error),
	}));
	return check({
		key: 'workflow_file',
		label: 'Workflow file',
		status: status.exists === true ? 'passed' : status.exists === false ? 'failed' : 'warning',
		source: 'github',
		summary: status.message,
		...(status.url ? { url: status.url } : {}),
	});
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, timeoutMs: number) {
	if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
		return await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
	}
	return await fetchImpl(url, { method: 'GET' });
}

async function httpCheck(input: {
	url: string | null;
	fetchImpl?: typeof fetch | null;
	mockExternal?: boolean;
	dryRun?: boolean;
	timeoutMs?: number;
}) {
	if (!input.url) {
		return check({
			key: 'http_response',
			label: 'HTTP response',
			status: 'skipped',
			source: 'http',
			summary: 'No public URL is available for HTTP probing.',
		});
	}
	if (input.mockExternal || input.dryRun || !input.fetchImpl) {
		return check({
			key: 'http_response',
			label: 'HTTP response',
			status: input.mockExternal ? 'passed' : 'skipped',
			source: 'http',
			url: input.url,
			summary: input.mockExternal ? 'Mock HTTP probe passed.' : 'HTTP probe skipped for this monitor run.',
		});
	}
	try {
		const response = await fetchWithTimeout(input.fetchImpl, input.url, input.timeoutMs ?? 10_000);
		const status = response.status >= 200 && response.status < 400
			? 'passed'
			: response.status === 401 || response.status === 403 || response.status >= 500
				? 'warning'
				: 'failed';
		return check({
			key: 'http_response',
			label: 'HTTP response',
			status,
			source: 'http',
			url: input.url,
			summary: `HTTP probe returned ${response.status}.`,
		});
	} catch (error) {
		return check({
			key: 'http_response',
			label: 'HTTP response',
			status: 'failed',
			source: 'http',
			url: input.url,
			summary: error instanceof Error ? error.message : 'HTTP probe failed.',
		});
	}
}

export async function buildProjectWebMonitorResult(input: {
	environment: ProjectDeploymentEnvironment;
	action?: string | null;
	repository?: Record<string, unknown> | null;
	workflowFile?: string | null;
	target?: Record<string, unknown> | null;
	externalWorkflow?: Record<string, unknown> | null;
	workflowResult?: Record<string, any> | null;
	githubClient?: GitHubApiClient | null;
	fetchImpl?: typeof fetch | null;
	mockExternal?: boolean;
	dryRun?: boolean;
}) {
	const repository = repositorySlug(input.repository);
	const workflowFile = text(input.workflowFile ?? input.repository?.workflowFile, 'deploy-web.yml');
	const target = objectValue(input.target);
	const contentPublish = objectValue(target.contentPublish);
	const treeDxPublish = input.action === 'publish_content' && contentPublish.provider === 'treedx';
	const targetUrl = externalUrl(target.url, target.baseUrl, target.previewUrl, target.lastDeploymentUrl);
	const latestWorkflowRun = !input.workflowResult && repository && input.githubClient
		? await getLatestGitHubWorkflowRun(repository, {
			client: input.githubClient,
			workflow: workflowFile,
			branch: text(input.repository?.branch, '') || null,
		}).catch(() => null)
		: null;
	const checks: ProjectWebMonitorCheck[] = [
		workflowRunCheck({
			workflowResult: input.workflowResult ?? input.externalWorkflow ?? null,
			latestWorkflowRun,
			repository,
			workflowFile,
			treeDxPublish,
		}),
		await workflowFileCheck({
			repository,
			workflowFile,
			githubClient: input.githubClient,
			mockExternal: input.mockExternal,
			dryRun: input.dryRun,
			treeDxPublish,
		}),
		check({
			key: 'web_host',
			label: 'Web host',
			status: Object.keys(target).length > 0 ? 'passed' : 'failed',
			source: 'market',
			summary: Object.keys(target).length > 0 ? 'Web host target is configured.' : 'Web host target is missing.',
		}),
		check({
			key: 'target_url',
			label: 'Public URL',
			status: targetUrl ? 'passed' : 'failed',
			source: 'market',
			...(targetUrl ? { url: targetUrl } : {}),
			summary: targetUrl ? 'Deployment target URL is recorded.' : 'Deployment target URL is missing.',
		}),
		await httpCheck({
			url: targetUrl,
			fetchImpl: input.fetchImpl,
			mockExternal: input.mockExternal,
			dryRun: input.dryRun,
		}),
		check({
			key: 'content_publish',
			label: 'Content publish',
			status: input.action === 'publish_content' ? 'passed' : 'skipped',
			source: treeDxPublish ? 'treedx' : 'sdk',
			summary: treeDxPublish
				? 'TreeDX content snapshot was published without GitHub Actions.'
				: input.action === 'publish_content' ? 'Content publish workflow completed.' : 'Content publish was not part of this action.',
		}),
		check({
			key: 'd1_migration',
			label: 'D1 migration',
			status: 'skipped',
			source: 'sdk',
			summary: 'No D1 migration result was reported for this deployment.',
		}),
		check({
			key: 'form_api_route',
			label: 'Form/API route',
			status: 'skipped',
			source: 'http',
			summary: 'No form/API route probe was configured for this project.',
		}),
	];
	const status = statusFromChecks(checks);
	const warnings = checks
		.filter((entry) => entry.status === 'warning')
		.map((entry) => entry.summary);
	const urls = [...new Set(checks.map((entry) => entry.url).filter((url): url is string => Boolean(url)))];
	const result: ProjectWebMonitorResult = {
		environment: input.environment,
		status,
		checkedAt: new Date().toISOString(),
		checks,
		urls,
		warnings,
	};
	return redact(result);
}
