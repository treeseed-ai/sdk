import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTreeseedEnvironmentRegistry } from '../../platform/environment.ts';
import { packageRoot, loadCliDeployConfig } from './runtime-tools.ts';

function envOrNull(key) {
	const value = process.env[key];
	return typeof value === 'string' && value.length > 0 ? value : null;
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
