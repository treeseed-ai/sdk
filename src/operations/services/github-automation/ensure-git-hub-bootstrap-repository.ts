import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { runTreeseedGit } from '../git-runner.ts';
import { resolveTreeseedEnvironmentRegistry } from '../../../platform/environment.ts';
import { packageRoot, loadCliDeployConfig } from '../runtime-tools.ts';
import {
	filterManagedHostGitHubEnvironment,
	usesManagedHostOperationRequests,
} from '../managed-host-security.ts';
import {
	createGitHubApiClient,
	ensureGitHubRepository,
	maybeGetGitHubRepository,
	parseGitHubRepositorySlug,
	listGitHubRepositorySecretNames,
	listGitHubRepositoryVariableNames,
	upsertGitHubRepositorySecret,
	upsertGitHubRepositoryVariable,
	waitForGitHubWorkflowRunCompletion,
} from '../github-api.ts';
import { resolveTreeseedGitHubToken } from '../../../service-credentials.ts';
import { ensureGitIdentity, ensureGitRepositoryInitialized, ensureOriginRemote, pushAllGitHubRefs, resolveGitHubRemoteUrls, resolveGitHubRepositoryTarget, runGit, slugifySegment } from './git-hub-repository-provision-input.ts';
import { ensureGitHubEnvironment } from './non-empty-values.ts';

export async function ensureGitHubBootstrapRepository(
	tenantRoot: string,
	{
		values = {},
		defaultName,
		onProgress,
	}: {
		values?: Record<string, string | undefined>;
		defaultName?: string;
		onProgress?: (message: string) => void;
	} = {},
) {
	const target = resolveGitHubRepositoryTarget(tenantRoot, { values, defaultName });
	const remotes = resolveGitHubRemoteUrls(target.owner, target.name);
	const slug = remotes.slug;
	onProgress?.(`[local][github][repo] Preparing ${slug} from ${target.source}...`);

	const client = createGitHubApiClient({
		env: {
			TREESEED_GITHUB_TOKEN: resolveTreeseedGitHubToken(values),
		},
	});
	const existing = await maybeGetGitHubRepository({ owner: target.owner, name: target.name }, { client });
	const repository = existing ?? await ensureGitHubRepository({
		owner: target.owner,
		name: target.name,
		visibility: target.visibility,
	}, { client });
	const created = !existing;
	onProgress?.(`[local][github][repo] ${created ? 'Created' : 'Verified'} ${repository.slug}.`);

	ensureGitRepositoryInitialized(tenantRoot, repository.defaultBranch || 'main');
	const remote = ensureOriginRemote(tenantRoot, repository);
	if (remote.changed) {
		onProgress?.(`[local][github][repo] Updated origin remote to ${repository.slug}.`);
	}
	if (created) {
		onProgress?.(`[local][github][repo] Pushing all local branches and tags to ${repository.slug}...`);
		pushAllGitHubRefs(tenantRoot);
		onProgress?.(`[local][github][repo] Pushed all local branches and tags to ${repository.slug}.`);
	}

	return {
		repository: repository.slug,
		target,
		created,
		remote,
		pushed: created,
		mode: 'real',
	};
}

export async function createGitHubRepository(input, { env = process.env } = {}) {
	const visibility = input.visibility ?? 'private';
	const remotes = resolveGitHubRemoteUrls(input.owner, input.name);

	return await ensureGitHubRepository({
		owner: remotes.owner,
		name: remotes.name,
		description: input.description ?? null,
		homepageUrl: input.homepageUrl ?? null,
		visibility,
		topics: Array.isArray(input.topics) ? input.topics.map((topic) => slugifySegment(topic, 'treeseed')) : [],
	}, {
		client: createGitHubApiClient({ env }),
	});
}

export function initializeGitHubRepositoryWorkingTree(
	cwd,
	repository,
	{
	defaultBranch = 'main',
	createStaging = true,
	commitMessage = 'Initialize TreeSeed hub',
	remoteName = 'origin',
	push = true,
	forcePush = false,
} = {},
) {
	runGit(['init', '-b', defaultBranch], { cwd, allowFailure: true });
	ensureGitIdentity(cwd);
	const currentRemote = runGit(['remote', 'get-url', remoteName], { cwd, allowFailure: true }).stdout?.trim() ?? '';
	if (!currentRemote) {
		runGit(['remote', 'add', remoteName, repository.sshUrl], { cwd });
	} else if (currentRemote !== repository.sshUrl && currentRemote !== repository.httpsUrl) {
		runGit(['remote', 'set-url', remoteName, repository.sshUrl], { cwd });
	}
	runGit(['add', '-A'], { cwd });
	const hasChanges = runGit(['status', '--porcelain'], { cwd }).stdout?.trim().length > 0;
	if (hasChanges) {
		runGit(['commit', '-m', commitMessage], { cwd });
	}
	if (push) {
		runGit(['push', ...(forcePush ? ['--force'] : []), '-u', remoteName, defaultBranch], { cwd, capture: false });
	}
	if (createStaging) {
		runGit(['checkout', '-B', 'staging'], { cwd });
		if (push) {
			runGit(['push', ...(forcePush ? ['--force'] : []), '-u', remoteName, 'staging'], { cwd, capture: false });
		}
		runGit(['checkout', defaultBranch], { cwd });
	}
	return {
		repository,
		remoteName,
		defaultBranch,
		stagingBranch: createStaging ? 'staging' : null,
		pushed: push,
	};
}

export function resolveGitRepositoryRoot(tenantRoot) {
	const result = runGit(['rev-parse', '--show-toplevel'], { cwd: tenantRoot, allowFailure: true });
	return result.status === 0 ? result.stdout.trim() : tenantRoot;
}

export function requiredGitHubEnvironment(tenantRoot, { scope = 'prod', purpose = 'save', managedHostMode = 'auto' } = {}) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const registry = resolveTreeseedEnvironmentRegistry({ deployConfig });
	const relevant = registry.entries.filter(
		(entry) =>
			entry.scopes.includes(scope)
			&& entry.purposes.includes(purpose)
			&& (!entry.isRelevant || entry.isRelevant(registry.context, scope, purpose)),
	);

	const required = {
		secrets: [...new Set(relevant.filter((entry) => entry.targets.includes('github-secret')).map((entry) => entry.id))],
		variables: [...new Set(relevant.filter((entry) => entry.targets.includes('github-variable')).map((entry) => entry.id))],
	};
	const managedBoundary = managedHostMode === 'managed'
		|| (managedHostMode === 'auto' && usesManagedHostOperationRequests(deployConfig));
	return managedBoundary ? filterManagedHostGitHubEnvironment(required) : required;
}

export function requiredGitHubSecrets(tenantRoot) {
	return requiredGitHubEnvironment(tenantRoot).secrets;
}

export function renderTenantWorkflowActionCommand() {
	return [
		'EXTRA_ARGS=()',
		'if [[ -n "${TREESEED_WORKFLOW_PROJECT:-}" ]]; then EXTRA_ARGS+=(--project-id "${TREESEED_WORKFLOW_PROJECT}"); fi',
		'if [[ -n "${TREESEED_WORKFLOW_PREVIEW_ID:-}" ]]; then EXTRA_ARGS+=(--preview-id "${TREESEED_WORKFLOW_PREVIEW_ID}"); fi',
		'if test -f ./packages/sdk/scripts/tenant-workflow-action.ts; then',
		'  tsx ./packages/sdk/scripts/tenant-workflow-action.ts --action "${TREESEED_WORKFLOW_ACTION}" --environment "${TREESEED_WORKFLOW_ENVIRONMENT}" "${EXTRA_ARGS[@]}"',
		'elif test -f ./node_modules/@treeseed/sdk/dist/scripts/tenant-workflow-action.js; then',
		'  node ./node_modules/@treeseed/sdk/dist/scripts/tenant-workflow-action.js --action "${TREESEED_WORKFLOW_ACTION}" --environment "${TREESEED_WORKFLOW_ENVIRONMENT}" "${EXTRA_ARGS[@]}"',
		'else',
		'  echo "Unable to resolve @treeseed/sdk tenant workflow entrypoint."',
		'  exit 1',
		'fi',
	].join('\n');
}

export function renderWorkflowTemplate(templateName, { workingDirectory }) {
	const normalizedWorkingDirectory = workingDirectory && workingDirectory !== '.' ? workingDirectory : '.';
	const workingDirectoryLine = normalizedWorkingDirectory === '.'
		? ''
		: `    defaults:\n      run:\n        working-directory: ${normalizedWorkingDirectory}\n`;
	const templatePath = resolve(packageRoot, 'templates', 'github', templateName);
	const template = readFileSync(templatePath, 'utf8');
	const tenantWorkflowActionCommand = renderTenantWorkflowActionCommand()
		.split('\n')
		.map((line) => `          ${line}`)
		.join('\n');

	return template
		.split('__WORKING_DIRECTORY_BLOCK__').join(workingDirectoryLine)
		.replace('__TENANT_WORKFLOW_ACTION_COMMAND_BLOCK__', tenantWorkflowActionCommand)
		.split('__CACHE_DEPENDENCY_PATH__').join(
			normalizedWorkingDirectory === '.' ? 'package-lock.json' : `${normalizedWorkingDirectory}/package-lock.json`,
		);
}

export function renderDeployWebWorkflow({ workingDirectory }) {
	return renderWorkflowTemplate('deploy-web.workflow.yml', { workingDirectory });
}

export function renderHostedProjectWorkflow({ workingDirectory }) {
	return renderWorkflowTemplate('hosted-project.workflow.yml', { workingDirectory });
}

export function ensureWorkflowFile(tenantRoot, fileName, expected) {
	const workflowPath = resolve(tenantRoot, '.github', 'workflows', fileName);
	const current = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : null;

	if (current === expected) {
		return { workflowPath, changed: false };
	}

	mkdirSync(dirname(workflowPath), { recursive: true });
	writeFileSync(workflowPath, expected, 'utf8');
	return { workflowPath, changed: true };
}

export function ensureDeployWorkflow(tenantRoot) {
	const repositoryRoot = resolveGitRepositoryRoot(tenantRoot);
	const workingDirectory = relative(repositoryRoot, tenantRoot).replaceAll('\\', '/') || '.';
	const web = ensureWorkflowFile(tenantRoot, 'deploy-web.yml', renderDeployWebWorkflow({ workingDirectory }));
	return {
		workflowPath: web.workflowPath,
		changed: web.changed,
		workingDirectory,
		executionBoundary: 'market-web-api',
		additionalWorkflows: [],
	};
}

export function ensureHostedProjectWorkflow(tenantRoot) {
	const repositoryRoot = resolveGitRepositoryRoot(tenantRoot);
	const workingDirectory = relative(repositoryRoot, tenantRoot).replaceAll('\\', '/') || '.';
	const expected = renderHostedProjectWorkflow({ workingDirectory });
	return {
		...ensureWorkflowFile(tenantRoot, 'hosted-project.yml', expected),
		workingDirectory,
	};
}

export function ensureStandardizedGitHubWorkflows(tenantRoot) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const deploy = ensureDeployWorkflow(tenantRoot);
	const workflows = [deploy, ...(deploy.additionalWorkflows ?? [])];
	if ((deployConfig.hosting?.kind ?? 'self_hosted_project') === 'treeseed_control_plane') {
		workflows.push(ensureHostedProjectWorkflow(tenantRoot));
	}
	return workflows;
}

export async function listGitHubSecretNames(repository, tenantRoot) {
	void tenantRoot;
	return await listGitHubRepositorySecretNames(repository, { client: createGitHubApiClient() });
}

export async function listGitHubVariableNames(repository, tenantRoot) {
	void tenantRoot;
	return await listGitHubRepositoryVariableNames(repository, { client: createGitHubApiClient() });
}

export function formatMissingSecretsReport(repository, missingSecrets, reason = 'missing_local_env') {
	const lines = [
		'Treeseed GitHub secret sync failed.',
		`Repository: ${repository}`,
		`Reason: ${reason}`,
		'Missing secrets:',
	];

	for (const secret of missingSecrets) {
		lines.push(`- ${secret.name}: localEnv=${secret.localEnvPresent ? 'present' : 'missing'} remote=${secret.remotePresent ? 'present' : 'missing'}`);
	}

	return lines.join('\n');
}

export async function ensureGitHubSecrets(tenantRoot, { planOnly = false } = {}) {
	return (await ensureGitHubEnvironment(tenantRoot, { planOnly })).secrets;
}
