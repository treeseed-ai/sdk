import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { RemoteTreeseedAuthClient, RemoteTreeseedClient } from '../../remote.ts';
import {
	findTreeseedOperation,
	TRESEED_OPERATION_SPECS,
} from '../../operations-registry.ts';
import type {
	TreeseedOperationContext,
	TreeseedOperationImplementation,
	TreeseedOperationMetadata,
	TreeseedOperationProvider,
	TreeseedOperationResult,
} from '../../operations-types.ts';
import {
	clearTreeseedRemoteSession,
	resolveTreeseedRemoteConfig,
	setTreeseedRemoteSession,
} from '../../operations/services/config-runtime.ts';
import {
	createPersistentDeployTarget,
	deployTargetLabel,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	loadDeployState,
} from '../../operations/services/deploy.ts';
import {
	PRODUCTION_BRANCH,
	STAGING_BRANCH,
} from '../../operations/services/git-workflow.ts';
import {
	dockerIsAvailable,
	findRunningMailpitContainer,
	stopKnownMailpitContainers,
} from '../../operations/services/mailpit-runtime.ts';
import {
	loadCliDeployConfig,
	packageScriptPath,
	resolveWranglerBin,
} from '../../operations/services/runtime-tools.ts';
import {
	scaffoldTemplateProject,
	listTemplateProducts,
	resolveTemplateProduct,
	serializeTemplateRegistryEntry,
	syncTemplateProject,
	validateTemplateProduct,
} from '../../operations/services/template-registry.ts';
import {
	collectCliPreflight,
	formatCliPreflightReport,
} from '../../operations/services/workspace-preflight.ts';
import { repoRoot } from '../../operations/services/workspace-save.ts';
import { run } from '../../operations/services/workspace-tools.ts';
import { resolveTreeseedWorkflowState } from '../../workflow-state.ts';
import { TreeseedWorkflowError, TreeseedWorkflowSdk } from '../../workflow.ts';

function operationResult<TPayload>(
	metadata: TreeseedOperationMetadata,
	payload: TPayload,
	options: Partial<TreeseedOperationResult<TPayload>> = {},
): TreeseedOperationResult<TPayload> {
	return {
		operation: metadata.id,
		ok: options.ok ?? true,
		payload,
		meta: options.meta,
		nextSteps: options.nextSteps,
		exitCode: options.exitCode ?? (options.ok === false ? 1 : 0),
		stdout: options.stdout,
		stderr: options.stderr,
	};
}

function failureResult(
	metadata: TreeseedOperationMetadata,
	message: string,
	options: Partial<TreeseedOperationResult> = {},
): TreeseedOperationResult {
	return operationResult(metadata, null, {
		ok: false,
		exitCode: options.exitCode ?? 1,
		stderr: [message],
		meta: options.meta,
	});
}

function contextEnv(context: TreeseedOperationContext) {
	return { ...process.env, ...(context.env ?? {}) };
}

function runNodeScript(
	metadata: TreeseedOperationMetadata,
	scriptName: string,
	args: string[],
	context: TreeseedOperationContext,
) {
	if (context.spawn) {
		const result = context.spawn(process.execPath, [packageScriptPath(scriptName), ...args], {
			cwd: context.cwd,
			env: contextEnv(context),
			stdio: 'inherit',
		});
		return operationResult(metadata, {
			script: scriptName,
			args,
		}, {
			ok: (result.status ?? 1) === 0,
			exitCode: result.status ?? 1,
		});
	}
	const result = spawnSync(process.execPath, [packageScriptPath(scriptName), ...args], {
		cwd: context.cwd,
		env: contextEnv(context),
		encoding: 'utf8',
		stdio: 'pipe',
	});
	const stdout = (result.stdout ?? '').split(/\r?\n/).filter(Boolean);
	const stderr = (result.stderr ?? '').split(/\r?\n/).filter(Boolean);
	for (const line of stdout) context.write?.(line, 'stdout');
	for (const line of stderr) context.write?.(line, 'stderr');
	return operationResult(metadata, {
		script: scriptName,
		args,
	}, {
		ok: (result.status ?? 1) === 0,
		exitCode: result.status ?? 1,
		stdout,
		stderr,
	});
}

function copyTreeseedOperationalState(sourceRoot: string, targetRoot: string) {
	const sourceTreeseedRoot = resolve(sourceRoot, '.treeseed');
	if (!existsSync(sourceTreeseedRoot)) {
		return;
	}
	copyDirectory(sourceTreeseedRoot, resolve(targetRoot, '.treeseed'));
}

function copyDirectory(sourceDir: string, targetDir: string) {
	mkdirSync(targetDir, { recursive: true });
	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = resolve(sourceDir, entry.name);
		const targetPath = resolve(targetDir, entry.name);
		if (entry.isDirectory()) {
			copyDirectory(sourcePath, targetPath);
			continue;
		}
		writeFileSync(targetPath, readFileSync(sourcePath));
	}
}

function workflowInputForOperation(name: string, input: Record<string, unknown>) {
	switch (name) {
		case 'status':
		case 'tasks':
			return {};
		case 'dev:watch':
			return { ...input, watch: true };
		default:
			return input;
	}
}

abstract class BaseOperation<TInput extends Record<string, unknown> = Record<string, unknown>> implements TreeseedOperationImplementation<TInput> {
	readonly metadata: TreeseedOperationMetadata;

	constructor(name: string) {
		const metadata = findTreeseedOperation(name);
		if (!metadata) {
			throw new Error(`Unknown operation metadata for "${name}".`);
		}
		this.metadata = metadata;
	}

	abstract execute(input: TInput, context: TreeseedOperationContext): Promise<TreeseedOperationResult>;
}

class WorkflowOperation extends BaseOperation {
	private readonly workflowName: Parameters<TreeseedWorkflowSdk['execute']>[0];

	constructor(name: string, workflowName?: Parameters<TreeseedWorkflowSdk['execute']>[0]) {
		super(name);
		this.workflowName = workflowName ?? (name === 'switch' ? 'switch' : name as Parameters<TreeseedWorkflowSdk['execute']>[0]);
	}

	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		try {
			const workflow = new TreeseedWorkflowSdk({
				cwd: context.cwd,
				env: context.env,
				write: context.write,
				prompt: context.prompt,
				confirm: context.confirm,
				transport: context.transport ?? 'sdk',
			});
			return await workflow.execute(this.workflowName, workflowInputForOperation(this.metadata.name, input));
		} catch (error) {
			if (error instanceof TreeseedWorkflowError) {
				return failureResult(this.metadata, error.message, {
					exitCode: error.exitCode ?? 1,
					meta: {
						code: error.code,
						details: error.details ?? null,
					},
				});
			}
			throw error;
		}
	}
}

class ScriptOperation extends BaseOperation {
	constructor(name: string, private readonly scriptName: string, private readonly extraArgs: string[] = []) {
		super(name);
	}

	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const args = Array.isArray(input.args) ? input.args.map(String) : [];
		return runNodeScript(this.metadata, this.scriptName, [...this.extraArgs, ...args], context);
	}
}

class PreflightOperation extends BaseOperation<{ requireAuth?: boolean }> {
	constructor(name: string, private readonly requireAuth = false) {
		super(name);
	}

	async execute(input: { requireAuth?: boolean }, context: TreeseedOperationContext) {
		const report = collectCliPreflight({
			cwd: context.cwd,
			requireAuth: input.requireAuth ?? this.requireAuth,
		});
		const stdout = [formatCliPreflightReport(report)];
		for (const line of stdout) context.write?.(line, 'stdout');
		return operationResult(this.metadata, report, {
			ok: report.ok,
			exitCode: report.ok ? 0 : 1,
			stdout,
			stderr: [],
		});
	}
}

class InitOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const directory = String(input.directory ?? input.target ?? '').trim();
		if (!directory) {
			return failureResult(this.metadata, 'Init requires a target directory.');
		}
		const definition = await scaffoldTemplateProject(
			String(input.template ?? 'starter-basic'),
			resolve(context.cwd, directory),
			{
				target: directory,
				name: typeof input.name === 'string' ? input.name : null,
				slug: typeof input.slug === 'string' ? input.slug : null,
				siteUrl: typeof input.siteUrl === 'string' ? input.siteUrl : null,
				contactEmail: typeof input.contactEmail === 'string' ? input.contactEmail : null,
				repositoryUrl: typeof input.repositoryUrl === 'string' ? input.repositoryUrl : typeof input.repo === 'string' ? input.repo : null,
				discordUrl: typeof input.discordUrl === 'string' ? input.discordUrl : typeof input.discord === 'string' ? input.discord : undefined,
			},
			{ writeWarning: (message) => context.write?.(message, 'stderr') },
		);
		return operationResult(this.metadata, {
			directory,
			template: definition.id,
		});
	}
}

class TemplateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const action = String(input.action ?? 'list');
		const target = typeof input.id === 'string' ? input.id : typeof input.target === 'string' ? input.target : undefined;
		const writeWarning = (message: string) => context.write?.(message, 'stderr');
		if (action === 'show') {
			if (!target) {
				return failureResult(this.metadata, 'Template show requires an id.');
			}
			return operationResult(this.metadata, {
				action,
				template: serializeTemplateRegistryEntry(await resolveTemplateProduct(target, { writeWarning })),
			});
		}
		if (action === 'validate') {
			const products = target ? [await resolveTemplateProduct(target, { writeWarning })] : await listTemplateProducts({ writeWarning });
			for (const product of products) {
				await validateTemplateProduct(product, { writeWarning });
			}
			return operationResult(this.metadata, {
				action,
				validated: products.map((product) => product.id),
			});
		}
		return operationResult(this.metadata, {
			action: 'list',
			templates: (await listTemplateProducts({ writeWarning })).map((product) => serializeTemplateRegistryEntry(product)),
		});
	}
}

class SyncTemplateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const changed = await syncTemplateProject(context.cwd, {
			check: input.check === true,
			writeWarning: (message) => context.write?.(message, 'stderr'),
		});
		return operationResult(this.metadata, {
			check: input.check === true,
			changed,
		}, {
			ok: input.check === true ? changed.length === 0 : true,
			exitCode: input.check === true && changed.length > 0 ? 1 : 0,
		});
	}
}

class DoctorOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: TreeseedOperationContext) {
		const state = resolveTreeseedWorkflowState(context.cwd);
		const preflight = collectCliPreflight({ cwd: context.cwd, requireAuth: false });
		return operationResult(this.metadata, {
			state,
			preflight,
		}, {
			ok: preflight.ok,
			exitCode: preflight.ok ? 0 : 1,
		});
	}
}

class AuthLoginOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const tenantRoot = context.cwd;
		const remoteConfig = resolveTreeseedRemoteConfig(tenantRoot, context.env);
		const hostId = typeof input.host === 'string' ? input.host : remoteConfig.activeHostId;
		const client = new RemoteTreeseedAuthClient(new RemoteTreeseedClient({
			...remoteConfig,
			activeHostId: hostId,
		}));
		const started = await client.startDeviceFlow({
			clientName: 'treeseed-sdk',
			scopes: ['auth:me', 'sdk', 'operations'],
		});
		const deadline = Date.parse(started.expiresAt);
		while (Date.now() < deadline) {
			const response = await client.pollDeviceFlow({ deviceCode: started.deviceCode });
			if (response.ok && response.status === 'approved') {
				setTreeseedRemoteSession(tenantRoot, {
					hostId,
					accessToken: response.accessToken,
					refreshToken: response.refreshToken,
					expiresAt: response.expiresAt,
					principal: response.principal,
				});
				return operationResult(this.metadata, {
					hostId,
					verificationUriComplete: started.verificationUriComplete,
					userCode: started.userCode,
					principal: response.principal,
				});
			}
			if (!response.ok && response.status !== 'already_used') {
				return failureResult(this.metadata, response.error);
			}
			await new Promise((resolveTimer) => setTimeout(resolveTimer, started.intervalSeconds * 1000));
		}
		return failureResult(this.metadata, 'Treeseed API login expired before approval completed.');
	}
}

class AuthLogoutOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const remoteConfig = resolveTreeseedRemoteConfig(context.cwd, context.env);
		const hostId = typeof input.host === 'string' ? input.host : remoteConfig.activeHostId;
		clearTreeseedRemoteSession(context.cwd, hostId);
		return operationResult(this.metadata, { hostId });
	}
}

class AuthWhoAmIOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: TreeseedOperationContext) {
		const remoteConfig = resolveTreeseedRemoteConfig(context.cwd, context.env);
		const client = new RemoteTreeseedAuthClient(new RemoteTreeseedClient(remoteConfig));
		const response = await client.whoAmI();
		return operationResult(this.metadata, {
			hostId: remoteConfig.activeHostId,
			principal: response.payload,
		});
	}
}

class RollbackOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const scope = typeof input.environment === 'string' ? input.environment : null;
		if (scope !== 'staging' && scope !== 'prod') {
			return failureResult(this.metadata, 'Rollback requires environment "staging" or "prod".');
		}
		const requestedCommit = typeof input.to === 'string' ? input.to : null;
		const tenantRoot = context.cwd;
		const deployConfig = loadCliDeployConfig(tenantRoot);
		const target = createPersistentDeployTarget(scope);
		const state = loadDeployState(tenantRoot, deployConfig, { target }) as Record<string, unknown>;
		const history = Array.isArray(state.deploymentHistory) ? state.deploymentHistory as Array<Record<string, unknown>> : [];
		const latestCommit = typeof state.lastDeployedCommit === 'string' ? state.lastDeployedCommit : null;
		const rollbackEntry = requestedCommit
			? history.find((entry) => entry.commit === requestedCommit) ?? null
			: [...history].reverse().find((entry) => typeof entry.commit === 'string' && entry.commit !== latestCommit) ?? null;
		const rollbackCommit = requestedCommit
			?? (typeof rollbackEntry?.commit === 'string' ? rollbackEntry.commit : latestCommit);
		if (!rollbackCommit) {
			return failureResult(this.metadata, `No rollback candidate is recorded for ${scope}.`);
		}
		const gitRoot = repoRoot(tenantRoot);
		const tenantRelativePath = relative(gitRoot, tenantRoot);
		const tempRoot = mkdtempSync(join(tmpdir(), 'treeseed-rollback-'));
		const tempTenantRoot = resolve(tempRoot, tenantRelativePath);
		const currentNodeModules = resolve(tenantRoot, 'node_modules');
		let finalizedState: Record<string, unknown> | null = null;
		try {
			run('git', ['worktree', 'add', '--detach', tempRoot, rollbackCommit], { cwd: gitRoot, capture: true });
			copyTreeseedOperationalState(tenantRoot, tempTenantRoot);
			if (existsSync(currentNodeModules) && !existsSync(resolve(tempTenantRoot, 'node_modules'))) {
				symlinkSync(currentNodeModules, resolve(tempTenantRoot, 'node_modules'), 'dir');
			}
			const { wranglerPath } = ensureGeneratedWranglerConfig(tempTenantRoot, { target });
			const buildResult = spawnSync(process.execPath, [packageScriptPath('tenant-build')], {
				cwd: tempTenantRoot,
				env: contextEnv(context),
				stdio: 'inherit',
			});
			if ((buildResult.status ?? 1) !== 0) {
				return failureResult(this.metadata, 'Rollback build failed.', { exitCode: buildResult.status ?? 1 });
			}
			const publishResult = spawnSync(process.execPath, [resolveWranglerBin(), 'deploy', '--config', wranglerPath], {
				cwd: tempTenantRoot,
				env: contextEnv(context),
				stdio: 'inherit',
			});
			if ((publishResult.status ?? 1) !== 0) {
				return failureResult(this.metadata, 'Rollback deploy failed.', { exitCode: publishResult.status ?? 1 });
			}
			const previousCommit = process.env.TREESEED_DEPLOY_COMMIT;
			process.env.TREESEED_DEPLOY_COMMIT = rollbackCommit;
			try {
				finalizedState = finalizeDeploymentState(tenantRoot, { target }) as Record<string, unknown>;
			} finally {
				if (previousCommit) process.env.TREESEED_DEPLOY_COMMIT = previousCommit;
				else delete process.env.TREESEED_DEPLOY_COMMIT;
			}
		} finally {
			try {
				run('git', ['worktree', 'remove', '--force', tempRoot], { cwd: gitRoot, capture: true });
			} catch {
				// best effort
			}
		}
		return operationResult(this.metadata, {
			scope,
			target: deployTargetLabel(target),
			rollbackCommit,
			rollbackEntry,
			finalizedState,
		});
	}
}

class MailpitUpOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: TreeseedOperationContext) {
		if (!dockerIsAvailable()) {
			return failureResult(this.metadata, 'Docker is required for Treeseed form email testing.');
		}
		const existing = findRunningMailpitContainer();
		if (existing) {
			return operationResult(this.metadata, { reused: true, container: existing });
		}
		return runNodeScript(this.metadata, 'ensure-mailpit', [], context);
	}
}

class MailpitDownOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, _context: TreeseedOperationContext) {
		const stopped = stopKnownMailpitContainers();
		return operationResult(this.metadata, { stopped }, { ok: stopped, exitCode: stopped ? 0 : 1 });
	}
}

class MailpitLogsOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: TreeseedOperationContext) {
		return runNodeScript(this.metadata, 'logs-mailpit', [], context);
	}
}

export class DefaultTreeseedOperationsProvider implements TreeseedOperationProvider {
	readonly id = 'default';
	private readonly operations: TreeseedOperationImplementation[];

	constructor() {
		this.operations = [
			new WorkflowOperation('status'),
			new WorkflowOperation('tasks'),
			new WorkflowOperation('switch', 'switch'),
			new WorkflowOperation('save'),
			new WorkflowOperation('close'),
			new WorkflowOperation('stage'),
			new WorkflowOperation('config'),
			new WorkflowOperation('export'),
			new WorkflowOperation('release'),
			new WorkflowOperation('destroy'),
			new WorkflowOperation('dev'),
			new WorkflowOperation('dev:watch', 'dev'),
			new InitOperation('init'),
			new TemplateOperation('template'),
			new SyncTemplateOperation('sync'),
			new DoctorOperation('doctor'),
			new AuthLoginOperation('auth:login'),
			new AuthLogoutOperation('auth:logout'),
			new AuthWhoAmIOperation('auth:whoami'),
			new RollbackOperation('rollback'),
			new ScriptOperation('build', 'tenant-build'),
			new ScriptOperation('check', 'tenant-check'),
			new ScriptOperation('preview', 'tenant-astro-command'),
			new ScriptOperation('lint', 'workspace-lint'),
			new ScriptOperation('test', 'workspace-test'),
			new ScriptOperation('test:unit', 'workspace-test-unit'),
			new PreflightOperation('preflight', false),
			new PreflightOperation('auth:check', true),
			new ScriptOperation('test:e2e', 'workspace-command-e2e'),
			new ScriptOperation('test:e2e:local', 'workspace-command-e2e', ['--mode=local']),
			new ScriptOperation('test:e2e:staging', 'workspace-command-e2e', ['--mode=staging']),
			new ScriptOperation('test:e2e:full', 'workspace-command-e2e', ['--mode=full']),
			new ScriptOperation('test:release', 'workspace-release-verify'),
			new ScriptOperation('test:release:full', 'workspace-release-verify', ['--full-smoke']),
			new ScriptOperation('release:publish:changed', 'workspace-publish-changed-packages'),
			new ScriptOperation('astro', 'tenant-astro-command'),
			new ScriptOperation('sync:devvars', 'sync-dev-vars'),
			new MailpitUpOperation('mailpit:up'),
			new MailpitDownOperation('mailpit:down'),
			new MailpitLogsOperation('mailpit:logs'),
			new ScriptOperation('d1:migrate:local', 'tenant-d1-migrate-local'),
			new ScriptOperation('cleanup:markdown', 'cleanup-markdown', ['--write']),
			new ScriptOperation('cleanup:markdown:check', 'cleanup-markdown', ['--check']),
			new ScriptOperation('starlight:patch', 'patch-starlight-content-path'),
		];
	}

	listOperations() {
		return [...this.operations];
	}

	findOperation(name: string | null | undefined) {
		if (!name) return null;
		return this.operations.find((operation) => operation.metadata.name === name || operation.metadata.aliases.includes(name)) ?? null;
	}
}

export function createDefaultTreeseedOperationsProvider() {
	return new DefaultTreeseedOperationsProvider();
}

export function listDefaultOperationMetadata() {
	return TRESEED_OPERATION_SPECS;
}
