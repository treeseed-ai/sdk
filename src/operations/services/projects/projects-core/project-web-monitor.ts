import {
	getGitHubWorkflowFileStatus,
	getLatestGitHubWorkflowRun,
	type GitHubApiClient,
	type GitHubWorkflowRunSummary,
} from '../../repositories/github-api.ts';
import {
	contentRuntimeMetadataFromTarget,
	resolveContentRuntimeSource,
	type ContentRuntimeResolution,
} from '../../../../platform/content/content-runtime-source.ts';
import type {
	ProjectDeploymentEnvironment,
	ProjectWebMonitorCheck,
	ProjectWebMonitorCheckStatus,
	ProjectWebMonitorResult,
	ProjectWebMonitorStatus,
} from '../../../../entrypoints/models/sdk-types.ts';

const FORBIDDEN_MONITOR_FIELDS = new Set([
	'capacityProviderId',
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

function architectureFromTarget(target: Record<string, any>) {
	const architecture = objectValue(target.architecture);
	const source = text(architecture.contentRuntimeSource);
	if (!source) return null;
	return {
		contentRuntimeSource: source as any,
		contentPublishTarget: objectValue(architecture.contentPublishTarget),
	};
}

function fallbackPublishArchitecture(target: Record<string, any>, treeDxPublish: boolean) {
	const metadata = contentRuntimeMetadataFromTarget(target);
	if (treeDxPublish) {
		return {
			architecture: {
				contentRuntimeSource: 'treedx_snapshot' as const,
				contentPublishTarget: objectValue(target.contentPublishTarget),
			},
			metadata,
		};
	}
	if (metadata.r2.manifestKey || metadata.r2.overlayKey) {
		return {
			architecture: {
				contentRuntimeSource: metadata.r2.overlayKey ? 'r2_preview_overlay' as const : 'r2_published_manifest' as const,
				contentPublishTarget: objectValue(target.contentPublishTarget),
			},
			metadata,
		};
	}
	return null;
}

function contentRuntimeCheck(input: {
	resolution: ContentRuntimeResolution | null;
	hasRuntimeMetadata: boolean;
}) {
	if (!input.resolution) {
		return check({
			key: 'content_runtime',
			label: 'Content runtime',
			status: 'skipped',
			source: 'sdk',
			summary: 'No project content runtime metadata was reported.',
		});
	}
	const status: ProjectWebMonitorCheckStatus = input.resolution.ready
		? 'passed'
		: input.hasRuntimeMetadata ? 'warning' : 'skipped';
	const source = input.resolution.mode === 'r2'
		? 'r2'
		: input.resolution.mode === 'treedx' ? 'treedx' : 'sdk';
	const locator = input.resolution.snapshotId
		? `snapshot ${input.resolution.snapshotId}`
		: input.resolution.manifestKey ? `manifest ${input.resolution.manifestKey}` : null;
	return check({
		key: 'content_runtime',
		label: 'Content runtime',
		status,
		source,
		summary: input.resolution.ready
			? `Content runtime will use ${input.resolution.effectiveContentSource}${locator ? ` (${locator})` : ''}.`
			: input.resolution.diagnostics[0]?.summary ?? 'Content runtime metadata is incomplete.',
	});
}

function summarizeContentPublish(input: {
	action?: string | null;
	treeDxPublish: boolean;
	contentRuntime: ContentRuntimeResolution | null;
}) {
	if (input.treeDxPublish) {
		return input.contentRuntime?.snapshotId
			? `TreeDX content snapshot ${input.contentRuntime.snapshotId} was published to R2 without GitHub Actions.`
			: 'TreeDX content snapshot was published to R2 without GitHub Actions.';
	}
	if (input.action === 'publish_content') {
		return input.contentRuntime?.manifestKey
			? `Content publish completed for R2 manifest ${input.contentRuntime.manifestKey}.`
			: 'Content publish workflow completed.';
	}
	return 'Content publish was not part of this action.';
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
	planOnly?: boolean;
	treeDxPublish?: boolean;
}) {
	if (input.treeDxPublish) {
		return check({
			key: 'workflow_file',
			label: 'Workflow file',
			status: 'skipped',
			source: 'treedx',
			summary: 'TreeDX content publish uses the Treeseed operations runner and Cloudflare R2 directly.',
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
	if (input.planOnly) {
		return check({
			key: 'workflow_file',
			label: 'Workflow file',
			status: 'skipped',
			source: 'github',
			summary: `${input.workflowFile} presence is not inspected during plan.`,
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
	planOnly?: boolean;
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
	if (input.planOnly || !input.fetchImpl) {
		return check({
			key: 'http_response',
			label: 'HTTP response',
			status: 'skipped',
			source: 'http',
			url: input.url,
			summary: 'HTTP probe skipped for this monitor run.',
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
	planOnly?: boolean;
}) {
	const repository = repositorySlug(input.repository);
	const workflowFile = text(input.workflowFile ?? input.repository?.workflowFile, 'deploy-web.yml');
	const target = objectValue(input.target);
	const contentPublish = objectValue(target.contentPublish);
	const treeDxPublish = input.action === 'publish_content' && contentPublish.provider === 'treedx';
	const targetArchitecture = architectureFromTarget(target);
	const fallbackArchitecture = fallbackPublishArchitecture(target, treeDxPublish);
	const contentRuntimeMetadata = fallbackArchitecture?.metadata ?? contentRuntimeMetadataFromTarget(target);
	const runtimeArchitecture = targetArchitecture ?? fallbackArchitecture?.architecture ?? null;
	const contentRuntime = runtimeArchitecture
		? resolveContentRuntimeSource({
			architecture: runtimeArchitecture,
			r2: contentRuntimeMetadata.r2,
			treeDx: contentRuntimeMetadata.treeDx,
			includeLocalPath: false,
		})
		: null;
	const hasRuntimeMetadata = Boolean(
		targetArchitecture
		|| contentRuntimeMetadata.r2.manifestKey
		|| contentRuntimeMetadata.r2.overlayKey
		|| contentRuntimeMetadata.treeDx.snapshotId
		|| contentRuntimeMetadata.treeDx.libraryId
		|| contentRuntimeMetadata.treeDx.repositoryId,
	);
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
			planOnly: input.planOnly,
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
			planOnly: input.planOnly,
		}),
		contentRuntimeCheck({ resolution: contentRuntime, hasRuntimeMetadata }),
		check({
			key: 'content_publish',
			label: 'Content publish',
			status: input.action === 'publish_content' ? 'passed' : 'skipped',
			source: treeDxPublish ? 'treedx' : 'sdk',
			summary: summarizeContentPublish({ action: input.action, treeDxPublish, contentRuntime }),
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
		...(contentRuntime ? {
			contentRuntime: {
				contentRuntimeSource: contentRuntime.contentRuntimeSource,
				effectiveContentSource: contentRuntime.effectiveContentSource,
				manifestKey: contentRuntime.manifestKey,
				overlayKey: contentRuntime.overlayKey,
				revision: contentRuntime.revision,
				snapshotId: contentRuntime.snapshotId,
				diagnostics: contentRuntime.diagnostics.map((entry) => ({
					code: entry.code,
					status: entry.status,
					source: entry.source,
					summary: entry.summary,
				})),
			},
		} : {}),
	};
	return redact(result);
}
