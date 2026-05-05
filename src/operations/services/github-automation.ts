import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTreeseedEnvironmentRegistry } from '../../platform/environment.ts';
import { packageRoot, loadCliDeployConfig } from './runtime-tools.ts';
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
} from './github-api.ts';

export interface GitHubRepositoryProvisionInput {
	owner: string;
	name: string;
	description?: string | null;
	visibility?: 'private' | 'public' | 'internal';
	homepageUrl?: string | null;
	topics?: string[];
}

export interface GitHubProvisionedRepository {
	slug: string;
	owner: string;
	name: string;
	url: string;
	sshUrl: string;
	httpsUrl: string;
	visibility: 'private' | 'public' | 'internal';
	defaultBranch: string;
}

export interface TreeseedGitHubRepositoryTarget {
	owner: string;
	name: string;
	visibility: 'private' | 'public' | 'internal';
	source: 'config' | 'origin' | 'default';
}

function envOrNull(key) {
	const value = process.env[key];
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function slugifySegment(value, fallback = 'project') {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 96) || fallback;
}

export function getGitHubAutomationMode() {
	return process.env.TREESEED_GITHUB_AUTOMATION_MODE === 'stub' ? 'stub' : 'real';
}

function isGitHubAutomationStubbed() {
	return getGitHubAutomationMode() === 'stub';
}

export function parseGitHubRepositoryFromRemote(remoteUrl) {
	if (!remoteUrl) {
		return null;
	}

	const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
	if (sshMatch) {
		return `${sshMatch[1]}/${sshMatch[2]}`;
	}

	const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
	if (httpsMatch) {
		return `${httpsMatch[1]}/${httpsMatch[2]}`;
	}

	return null;
}

function runGit(args, { cwd, allowFailure = false, capture = true } = {}) {
	const result = spawnSync('git', args, {
		cwd,
		stdio: capture ? 'pipe' : 'inherit',
		encoding: 'utf8',
	});

	if (result.status !== 0 && !allowFailure) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}

	return result;
}

function sleepSeconds(seconds) {
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return;
	}
	spawnSync('sleep', [String(seconds)], {
		stdio: 'ignore',
	});
}

function resolveGitHubRemoteUrls(owner, name) {
	const normalizedOwner = slugifySegment(owner, 'owner');
	const normalizedName = slugifySegment(name, 'repo');
	return {
		slug: `${normalizedOwner}/${normalizedName}`,
		owner: normalizedOwner,
		name: normalizedName,
		sshUrl: `git@github.com:${normalizedOwner}/${normalizedName}.git`,
		httpsUrl: `https://github.com/${normalizedOwner}/${normalizedName}.git`,
		url: `https://github.com/${normalizedOwner}/${normalizedName}`,
	};
}

function ensureGitIdentity(cwd) {
	const currentName = runGit(['config', '--get', 'user.name'], { cwd, allowFailure: true }).stdout?.trim() ?? '';
	const currentEmail = runGit(['config', '--get', 'user.email'], { cwd, allowFailure: true }).stdout?.trim() ?? '';
	if (!currentName) {
		runGit(['config', 'user.name', envOrNull('TREESEED_GITHUB_COMMITTER_NAME') ?? 'Treeseed Launch'], { cwd });
	}
	if (!currentEmail) {
		runGit(['config', 'user.email', envOrNull('TREESEED_GITHUB_COMMITTER_EMAIL') ?? 'launch@knowledge.coop'], { cwd });
	}
}

export function resolveGitHubRepositorySlug(tenantRoot) {
	const remoteResult = runGit(['remote', 'get-url', 'origin'], { cwd: tenantRoot });
	const remoteUrl = remoteResult.stdout?.trim() ?? '';
	const repository = parseGitHubRepositoryFromRemote(remoteUrl);
	if (!repository) {
		throw new Error(`Unable to determine GitHub repository from origin remote "${remoteUrl}".`);
	}
	return repository;
}

export function maybeResolveGitHubRepositorySlug(tenantRoot) {
	try {
		return resolveGitHubRepositorySlug(tenantRoot);
	} catch {
		return null;
	}
}

export function resolveDefaultGitHubOwner() {
	const explicit = envOrNull('TREESEED_GITHUB_OWNER');
	if (explicit) {
		return explicit;
	}
	try {
		const repository = maybeResolveGitHubRepositorySlug(process.cwd());
		if (repository?.includes('/')) {
			return repository.split('/')[0];
		}
	} catch {
		// Ignore local remote resolution failures.
	}
	return 'treeseed-ai';
}

function normalizeGitHubVisibility(value: unknown): TreeseedGitHubRepositoryTarget['visibility'] {
	const normalized = String(value ?? '').trim().toLowerCase();
	return normalized === 'public' || normalized === 'internal' || normalized === 'private'
		? normalized
		: 'private';
}

function configuredValue(values: Record<string, string | undefined> | undefined, key: string) {
	const value = values?.[key] ?? process.env[key];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

export function resolveGitHubRepositoryTarget(
	tenantRoot: string,
	{
		values = {},
		defaultName,
	}: {
		values?: Record<string, string | undefined>;
		defaultName?: string;
	} = {},
): TreeseedGitHubRepositoryTarget {
	const origin = maybeResolveGitHubRepositorySlug(tenantRoot);
	const parsedOrigin = origin ? parseGitHubRepositorySlug(origin) : null;
	const owner = configuredValue(values, 'TREESEED_GITHUB_OWNER') || parsedOrigin?.owner || '';
	const name = configuredValue(values, 'TREESEED_GITHUB_REPOSITORY_NAME') || parsedOrigin?.name || defaultName || 'project';
	if (!owner) {
		throw new Error('Configure TREESEED_GITHUB_OWNER before GitHub repository bootstrap.');
	}
	return {
		owner: slugifySegment(owner, 'owner'),
		name: slugifySegment(name, 'project'),
		visibility: normalizeGitHubVisibility(configuredValue(values, 'TREESEED_GITHUB_REPOSITORY_VISIBILITY')),
		source: configuredValue(values, 'TREESEED_GITHUB_OWNER') || configuredValue(values, 'TREESEED_GITHUB_REPOSITORY_NAME')
			? 'config'
			: parsedOrigin
				? 'origin'
				: 'default',
	};
}

function ensureGitRepositoryInitialized(cwd: string, defaultBranch: string) {
	const insideWorkTree = runGit(['rev-parse', '--is-inside-work-tree'], { cwd, allowFailure: true }).stdout?.trim() === 'true';
	if (!insideWorkTree) {
		runGit(['init', '-b', defaultBranch], { cwd });
	}
	ensureGitIdentity(cwd);
}

function ensureOriginRemote(cwd: string, repository: { sshUrl: string; httpsUrl: string }, remoteName = 'origin') {
	const currentRemote = runGit(['remote', 'get-url', remoteName], { cwd, allowFailure: true }).stdout?.trim() ?? '';
	if (!currentRemote) {
		runGit(['remote', 'add', remoteName, repository.sshUrl], { cwd });
		return { changed: true, previous: null, next: repository.sshUrl };
	}
	if (currentRemote !== repository.sshUrl && currentRemote !== repository.httpsUrl) {
		runGit(['remote', 'set-url', remoteName, repository.sshUrl], { cwd });
		return { changed: true, previous: currentRemote, next: repository.sshUrl };
	}
	return { changed: false, previous: currentRemote, next: currentRemote };
}

function pushAllGitHubRefs(cwd: string, remoteName = 'origin') {
	runGit(['push', '-u', remoteName, '--all'], { cwd, capture: false });
	runGit(['push', remoteName, '--tags'], { cwd, capture: false });
}

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
	if (isGitHubAutomationStubbed()) {
		onProgress?.(`[local][github][repo] Stubbed GitHub automation; repository ${slug} not changed.`);
		return {
			repository: slug,
			target,
			created: false,
			remote: { changed: false, previous: null, next: remotes.sshUrl },
			pushed: false,
			mode: 'stub',
		};
	}

	const client = createGitHubApiClient({
		env: {
			GH_TOKEN: configuredValue(values, 'GH_TOKEN') || configuredValue(values, 'GITHUB_TOKEN'),
			GITHUB_TOKEN: configuredValue(values, 'GH_TOKEN') || configuredValue(values, 'GITHUB_TOKEN'),
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

export async function createGitHubRepository(input) {
	const visibility = input.visibility ?? 'private';
	const remotes = resolveGitHubRemoteUrls(input.owner, input.name);
	if (isGitHubAutomationStubbed()) {
		return {
			...remotes,
			visibility,
			defaultBranch: 'main',
			mode: 'stub',
		};
	}

	return await ensureGitHubRepository({
		owner: remotes.owner,
		name: remotes.name,
		description: input.description ?? null,
		homepageUrl: input.homepageUrl ?? null,
		visibility,
		topics: Array.isArray(input.topics) ? input.topics.map((topic) => slugifySegment(topic, 'treeseed')) : [],
	}, {
		client: createGitHubApiClient(),
	});
}

export function initializeGitHubRepositoryWorkingTree(
	cwd,
	repository,
	{
		defaultBranch = 'main',
		createStaging = true,
		commitMessage = 'Initialize Knowledge Coop hub',
		remoteName = 'origin',
		push = true,
	} = {},
) {
	if (isGitHubAutomationStubbed()) {
		return {
			repository,
			remoteName,
			defaultBranch,
			stagingBranch: createStaging ? 'staging' : null,
			pushed: false,
			mode: 'stub',
		};
	}

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
		runGit(['push', '-u', remoteName, defaultBranch], { cwd, capture: false });
	}
	if (createStaging) {
		runGit(['checkout', '-B', 'staging'], { cwd });
		if (push) {
			runGit(['push', '-u', remoteName, 'staging'], { cwd, capture: false });
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

export function requiredGitHubEnvironment(tenantRoot, { scope = 'prod', purpose = 'save' } = {}) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const registry = resolveTreeseedEnvironmentRegistry({ deployConfig });
	const relevant = registry.entries.filter(
		(entry) =>
			entry.scopes.includes(scope)
			&& entry.purposes.includes(purpose)
			&& (!entry.isRelevant || entry.isRelevant(registry.context, scope, purpose)),
	);

	return {
		secrets: [...new Set(relevant.filter((entry) => entry.targets.includes('github-secret')).map((entry) => entry.id))],
		variables: [...new Set(relevant.filter((entry) => entry.targets.includes('github-variable')).map((entry) => entry.id))],
	};
}

export function requiredGitHubSecrets(tenantRoot) {
	return requiredGitHubEnvironment(tenantRoot).secrets;
}

function renderTenantWorkflowActionCommand() {
	return [
		'EXTRA_ARGS=()',
		'if [[ "${TREESEED_WORKFLOW_SKIP_PROVISION:-}" == "1" ]]; then EXTRA_ARGS+=(--skip-provision); fi',
		'if [[ -n "${TREESEED_WORKFLOW_PROJECT:-}" ]]; then EXTRA_ARGS+=(--project-id "${TREESEED_WORKFLOW_PROJECT}"); fi',
		'if [[ -n "${TREESEED_WORKFLOW_PREVIEW_ID:-}" ]]; then EXTRA_ARGS+=(--preview-id "${TREESEED_WORKFLOW_PREVIEW_ID}"); fi',
		'if test -f ./packages/sdk/scripts/tenant-workflow-action.ts; then',
		'  node ./packages/sdk/scripts/run-ts.mjs ./packages/sdk/scripts/tenant-workflow-action.ts --action "${TREESEED_WORKFLOW_ACTION}" --environment "${TREESEED_WORKFLOW_ENVIRONMENT}" "${EXTRA_ARGS[@]}"',
		'elif test -f ./node_modules/@treeseed/sdk/dist/scripts/tenant-workflow-action.js; then',
		'  node ./node_modules/@treeseed/sdk/dist/scripts/tenant-workflow-action.js --action "${TREESEED_WORKFLOW_ACTION}" --environment "${TREESEED_WORKFLOW_ENVIRONMENT}" "${EXTRA_ARGS[@]}"',
		'else',
		'  echo "Unable to resolve @treeseed/sdk tenant workflow entrypoint."',
		'  exit 1',
		'fi',
	].join('\n');
}

function renderWorkflowTemplate(templateName, { workingDirectory }) {
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

export function renderDeployWorkflow({ workingDirectory }) {
	return renderWorkflowTemplate('deploy.workflow.yml', { workingDirectory });
}

export function renderHostedProjectWorkflow({ workingDirectory }) {
	return renderWorkflowTemplate('hosted-project.workflow.yml', { workingDirectory });
}

function ensureWorkflowFile(tenantRoot, fileName, expected) {
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
	if (isGitHubAutomationStubbed()) {
		return {
			workflowPath: resolve(tenantRoot, '.github', 'workflows', 'deploy.yml'),
			changed: false,
			workingDirectory: '.',
			mode: 'stub',
		};
	}

	const repositoryRoot = resolveGitRepositoryRoot(tenantRoot);
	const workingDirectory = relative(repositoryRoot, tenantRoot).replaceAll('\\', '/') || '.';
	const expected = renderDeployWorkflow({ workingDirectory });
	return {
		...ensureWorkflowFile(tenantRoot, 'deploy.yml', expected),
		workingDirectory,
	};
}

export function ensureHostedProjectWorkflow(tenantRoot) {
	if (isGitHubAutomationStubbed()) {
		return {
			workflowPath: resolve(tenantRoot, '.github', 'workflows', 'hosted-project.yml'),
			changed: false,
			workingDirectory: '.',
			mode: 'stub',
		};
	}

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
	const workflows = [deploy];
	if ((deployConfig.hosting?.kind ?? 'self_hosted_project') === 'market_control_plane') {
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

export async function ensureGitHubSecrets(tenantRoot, { dryRun = false } = {}) {
	return (await ensureGitHubEnvironment(tenantRoot, { dryRun })).secrets;
}

export async function ensureGitHubEnvironment(tenantRoot, { dryRun = false, scope = 'prod', purpose = 'save' } = {}) {
	if (isGitHubAutomationStubbed()) {
		return {
			repository: maybeResolveGitHubRepositorySlug(tenantRoot),
			secrets: {
				existing: [],
				created: [],
			},
			variables: {
				existing: [],
				created: [],
			},
			skipped: 'stubbed',
			mode: 'stub',
		};
	}

	const repository = maybeResolveGitHubRepositorySlug(tenantRoot);
	if (!repository) {
		if (dryRun) {
			return {
				repository: null,
				secrets: { existing: [], created: [] },
				variables: { existing: [], created: [] },
				skipped: 'missing_repository',
			};
		}
		throw new Error('Unable to determine GitHub repository from the current tenant. Configure an origin remote before syncing GitHub secrets.');
	}
	const required = requiredGitHubEnvironment(tenantRoot, { scope, purpose });
	const requiredSecrets = required.secrets;
	const requiredVariables = required.variables;
	const client = createGitHubApiClient();
	const existingSecrets = await listGitHubRepositorySecretNames(repository, { client });
	const existingVariables = await listGitHubRepositoryVariableNames(repository, { client });
	const missingRemote = requiredSecrets.filter((name) => !existingSecrets.has(name));
	const missingRemoteVariables = requiredVariables.filter((name) => !existingVariables.has(name));

	const missingLocal = missingRemote
		.filter((name) => !envOrNull(name))
		.map((name) => ({ name, localEnvPresent: false, remotePresent: false }));
	const missingLocalVariables = missingRemoteVariables
		.filter((name) => !envOrNull(name))
		.map((name) => ({ name, localEnvPresent: false, remotePresent: false }));

	if (missingLocal.length > 0 || missingLocalVariables.length > 0) {
		throw new Error(formatMissingSecretsReport(repository, [...missingLocal, ...missingLocalVariables]));
	}

	const createdSecrets = [];
	for (const name of missingRemote) {
		if (dryRun) {
			createdSecrets.push(name);
			continue;
		}
		await upsertGitHubRepositorySecret(repository, name, envOrNull(name) ?? '', { client });
		createdSecrets.push(name);
	}

	const createdVariables = [];
	for (const name of missingRemoteVariables) {
		if (dryRun) {
			createdVariables.push(name);
			continue;
		}
		await upsertGitHubRepositoryVariable(repository, name, envOrNull(name) ?? '', { client });
		createdVariables.push(name);
	}

	return {
		repository,
		secrets: {
			existing: requiredSecrets.filter((name) => existingSecrets.has(name)),
			created: createdSecrets,
		},
		variables: {
			existing: requiredVariables.filter((name) => existingVariables.has(name)),
			created: createdVariables,
		},
	};
}

export async function ensureGitHubDeployAutomation(tenantRoot, { dryRun = false } = {}) {
	const workflows = ensureStandardizedGitHubWorkflows(tenantRoot);
	const environment = await ensureGitHubEnvironment(tenantRoot, { dryRun });
	return {
		mode: getGitHubAutomationMode(),
		workflow: workflows[0],
		workflows,
		secrets: environment.secrets,
		variables: environment.variables,
		environment,
	};
}

export async function waitForGitHubWorkflowCompletion(
	tenantRoot,
	{
		repository,
		workflow = 'publish.yml',
		headSha,
		branch,
		timeoutSeconds = 600,
		pollSeconds = 5,
		onProgress,
	} = {},
) {
	if (isGitHubAutomationStubbed()) {
		return {
			status: 'skipped',
			reason: 'stubbed',
			repository: repository ?? maybeResolveGitHubRepositorySlug(tenantRoot),
			workflow,
			headSha: headSha ?? null,
			branch: branch ?? null,
		};
	}

	const repo = repository ?? resolveGitHubRepositorySlug(tenantRoot);
	return await waitForGitHubWorkflowRunCompletion(repo, {
		client: createGitHubApiClient(),
		workflow,
		headSha,
		branch,
		timeoutSeconds,
		pollSeconds,
		onProgress,
	});
}
