import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTreeseedEnvironmentRegistry } from '../../platform/environment.ts';
import { packageRoot, loadCliDeployConfig } from './runtime-tools.ts';

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

function runGh(args, { cwd, allowFailure = false, capture = true, input } = {}) {
	const result = spawnSync('gh', args, {
		cwd,
		stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
		encoding: 'utf8',
		input,
	});

	if (result.error && result.error.code === 'ENOENT') {
		throw new Error('GitHub CLI `gh` is required for Treeseed GitHub automation.');
	}

	if (result.status !== 0 && !allowFailure) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `gh ${args.join(' ')} failed`);
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
	const explicit = envOrNull('TREESEED_KNOWLEDGE_COOP_GITHUB_OWNER');
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

export function createGitHubRepository(input) {
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

	const existing = runGh(['repo', 'view', remotes.slug, '--json', 'name,owner,url,isPrivate,defaultBranchRef,visibility'], {
		allowFailure: true,
	});
	if (existing.status !== 0) {
		const args = ['repo', 'create', remotes.slug, '--disable-wiki', '--confirm'];
		if (visibility === 'public') {
			args.push('--public');
		} else if (visibility === 'internal') {
			args.push('--internal');
		} else {
			args.push('--private');
		}
		if (input.description) {
			args.push('--description', input.description);
		}
		if (input.homepageUrl) {
			args.push('--homepage', input.homepageUrl);
		}
		runGh(args, { capture: false });
	}
	if (Array.isArray(input.topics) && input.topics.length > 0) {
		runGh(
			['repo', 'edit', remotes.slug, ...input.topics.flatMap((topic) => ['--add-topic', slugifySegment(topic, 'treeseed')])],
			{ capture: false },
		);
	}
	const viewed = runGh(['repo', 'view', remotes.slug, '--json', 'name,owner,url,isPrivate,defaultBranchRef,visibility'], {});
	const payload = JSON.parse(viewed.stdout || '{}');
	return {
		...remotes,
		owner: String(payload.owner?.login ?? remotes.owner),
		name: String(payload.name ?? remotes.name),
		url: String(payload.url ?? remotes.url),
		visibility: String(payload.visibility ?? (payload.isPrivate === true ? 'private' : visibility)),
		defaultBranch: String(payload.defaultBranchRef?.name ?? 'main'),
	};
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

export function listGitHubSecretNames(repository, tenantRoot) {
	const result = runGh(['secret', 'list', '--repo', repository, '--json', 'name'], {
		cwd: tenantRoot,
	});
	return new Set(
		(JSON.parse(result.stdout || '[]'))
			.map((entry) => entry?.name)
			.filter((value) => typeof value === 'string' && value.length > 0),
	);
}

export function listGitHubVariableNames(repository, tenantRoot) {
	const result = runGh(['variable', 'list', '--repo', repository, '--json', 'name'], {
		cwd: tenantRoot,
	});
	return new Set(
		(JSON.parse(result.stdout || '[]'))
			.map((entry) => entry?.name)
			.filter((value) => typeof value === 'string' && value.length > 0),
	);
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

export function ensureGitHubSecrets(tenantRoot, { dryRun = false } = {}) {
	return ensureGitHubEnvironment(tenantRoot, { dryRun }).secrets;
}

export function ensureGitHubEnvironment(tenantRoot, { dryRun = false, scope = 'prod', purpose = 'save' } = {}) {
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
	const existingSecrets = listGitHubSecretNames(repository, tenantRoot);
	const existingVariables = listGitHubVariableNames(repository, tenantRoot);
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
		runGh(['secret', 'set', name, '--repo', repository, '--body', envOrNull(name) ?? ''], {
			cwd: tenantRoot,
		});
		createdSecrets.push(name);
	}

	const createdVariables = [];
	for (const name of missingRemoteVariables) {
		if (dryRun) {
			createdVariables.push(name);
			continue;
		}
		runGh(['variable', 'set', name, '--repo', repository, '--body', envOrNull(name) ?? ''], {
			cwd: tenantRoot,
		});
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

export function ensureGitHubDeployAutomation(tenantRoot, { dryRun = false } = {}) {
	const workflows = ensureStandardizedGitHubWorkflows(tenantRoot);
	const environment = ensureGitHubEnvironment(tenantRoot, { dryRun });
	return {
		mode: getGitHubAutomationMode(),
		workflow: workflows[0],
		workflows,
		secrets: environment.secrets,
		variables: environment.variables,
		environment,
	};
}

export function waitForGitHubWorkflowCompletion(
	tenantRoot,
	{
		repository,
		workflow = 'publish.yml',
		headSha,
		branch,
		timeoutSeconds = 600,
		pollSeconds = 5,
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
	const startedAt = Date.now();

	while ((Date.now() - startedAt) < timeoutSeconds * 1000) {
		const result = runGh([
			'run',
			'list',
			'--repo',
			repo,
			'--workflow',
			workflow,
			'--limit',
			'20',
			'--json',
			'databaseId,headSha,headBranch,status,conclusion,event,displayTitle,url',
		], { cwd: tenantRoot });
		const runs = JSON.parse(result.stdout || '[]');
		const match = runs.find((run) => {
			if (headSha && run?.headSha !== headSha) {
				return false;
			}
			if (branch && run?.headBranch !== branch) {
				return false;
			}
			return true;
		});

		if (match?.databaseId) {
			runGh(['run', 'watch', String(match.databaseId), '--repo', repo, '--exit-status'], {
				cwd: tenantRoot,
				capture: false,
			});
			const finalResult = runGh([
				'run',
				'view',
				String(match.databaseId),
				'--repo',
				repo,
				'--json',
				'status,conclusion,url,workflowName,headSha',
			], { cwd: tenantRoot });
			const finalRun = JSON.parse(finalResult.stdout || '{}');
			return {
				status: 'completed',
				repository: repo,
				workflow,
				runId: match.databaseId,
				headSha: finalRun.headSha ?? match.headSha ?? null,
				conclusion: finalRun.conclusion ?? match.conclusion ?? null,
				url: finalRun.url ?? match.url ?? null,
			};
		}

		sleepSeconds(pollSeconds);
	}

	throw new Error(`Timed out waiting for GitHub workflow ${workflow} in ${repo}.`);
}
