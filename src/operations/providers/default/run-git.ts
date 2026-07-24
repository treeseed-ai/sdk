import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { RemoteAuthClient, RemoteClient } from '../../../entrypoints/clients/remote.ts';
import { classifyGitMode, runGitText } from '../../services/operations/git-runner.ts';
import {
	findOperation,
	TRESEED_OPERATION_SPECS,
} from '../../operations-registry.ts';
import type {
	OperationContext,
	OperationImplementation,
	OperationMetadata,
	OperationProvider,
	OperationResult,
} from '../../operations-types.ts';
import {
	clearRemoteSession,
	inspectKeyAgentStatus,
	lockSecretSession,
	migrateMachineKeyToWrapped,
	resolveLaunchEnvironment,
	resolveRemoteConfig,
	rotateMachineKey,
	rotateMachineKeyPassphrase,
	setRemoteSession,
	MACHINE_KEY_PASSPHRASE_ENV,
	KeyAgentError,
	unlockSecretSessionFromEnv,
} from '../../services/configuration/config-runtime.ts';
import {
	createPersistentDeployTarget,
	deployTargetLabel,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	loadDeployState,
} from '../../services/hosting/deployment/deploy.ts';
import {
	PRODUCTION_BRANCH,
	STAGING_BRANCH,
} from '../../services/operations/git-workflow.ts';
import {
	loadCliDeployConfig,
	packageScriptPath,
	resolveWranglerBin,
} from '../../services/agents/runtime-tools.ts';
import {
	scaffoldTemplateProject,
	listTemplateProducts,
	recordTemplateHostBindingState,
	resolveTemplateDefinition,
	resolveTemplateProduct,
	serializeTemplateRegistryEntry,
	syncTemplateProject,
	validateTemplateProduct,
} from '../../services/support/template-registry.ts';
import { applyProjectLaunchHostBindingConfig } from '../../services/hosting/deployment/template-host-bindings.ts';
import { validateKnowledgeHubProviderLaunchPrerequisites } from '../../services/capacity/providers/hub-provider-launch.ts';
import { publishProjectContent } from '../../services/projects/projects-core/project-platform.ts';
import {
	createKnowledgeHubRepositories,
	executeKnowledgeHubLaunch,
	planKnowledgeHubLaunch,
	validateRepositoryHost,
	type KnowledgeHubLaunchIntent,
	type KnowledgeHubRepositoryPlan,
	type RepositoryHost,
} from '../../services/support/hub-launch.ts';
import {
	collectCliPreflight,
	formatCliPreflightReport,
} from '../../services/treedx/workspaces/workspace-preflight.ts';
import { repoRoot } from '../../services/treedx/workspaces/workspace-save.ts';
import { DEFAULT_STARTER_TEMPLATE_ID } from '../../../entrypoints/models/sdk-types.ts';
import {
	parseProjectLaunchHostBindingSpecs,
	resolveProjectLaunchHostBindings,
} from '../../../entrypoints/templates/template-launch-requirements.ts';
import { run } from '../../services/treedx/workspaces/workspace-tools.ts';
import { resolveWorkflowState } from '../../workflow-state.ts';
import { WorkflowError, WorkflowSdk } from '../../workflow.ts';
import {
	collectToolStatus,
	formatDependencyReport,
	installDependencies,
} from '../../../entrypoints/runtime/managed-dependencies.ts';


export function runGit(args: string[], options: { cwd: string; capture?: boolean; timeoutMs?: number; maxBuffer?: number }) {
	return runGitText(args, {
		cwd: options.cwd,
		mode: classifyGitMode(args),
		timeoutMs: options.timeoutMs,
		maxBuffer: options.maxBuffer,
	});
}

export function operationResult<TPayload>(
	metadata: OperationMetadata,
	payload: TPayload,
	options: Partial<OperationResult<TPayload>> = {},
): OperationResult<TPayload> {
	return {
		operation: metadata.id,
		ok: options.ok ?? true,
		payload,
		meta: options.meta,
		nextSteps: options.nextSteps,
		exitCode: options.exitCode ?? (options.ok === false ? 1 : 0),
		stdout: options.stdout,
		stderr: options.stderr,
		report: options.report,
	};
}

export function failureResult(
	metadata: OperationMetadata,
	message: string,
	options: Partial<OperationResult> = {},
): OperationResult {
	return operationResult(metadata, null, {
		ok: false,
		exitCode: options.exitCode ?? 1,
		stderr: [message],
		meta: options.meta,
	});
}

export function contextEnv(context: OperationContext) {
	return { ...process.env, ...(context.env ?? {}) };
}

export async function withTemporaryProcessEnv<T>(env: Record<string, string | undefined>, action: () => Promise<T>) {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(env)) {
		previous.set(key, process.env[key]);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	try {
		return await action();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

export function operationEnv(context: OperationContext) {
	const tenantConfigPath = resolve(context.cwd, 'treeseed.site.yaml');
	return existsSync(tenantConfigPath)
		? resolveLaunchEnvironment({ tenantRoot: context.cwd, scope: 'local', baseEnv: contextEnv(context) })
		: contextEnv(context);
}

export function runNodeScript(
	metadata: OperationMetadata,
	scriptName: string,
	args: string[],
	context: OperationContext,
) {
	if (context.spawn) {
		const result = context.spawn(process.execPath, [packageScriptPath(scriptName), ...args], {
			cwd: context.cwd,
			env: operationEnv(context),
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
		env: operationEnv(context),
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

export function copyOperationalState(sourceRoot: string, targetRoot: string) {
	const stateRoot = resolve(sourceRoot, '.treeseed');
	if (!existsSync(stateRoot)) {
		return;
	}
	copyDirectory(stateRoot, resolve(targetRoot, '.treeseed'));
}

export function copyDirectory(sourceDir: string, targetDir: string) {
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

export function copyFileIfExists(sourceFile: string, targetFile: string) {
	if (!existsSync(sourceFile)) return;
	mkdirSync(resolve(targetFile, '..'), { recursive: true });
	writeFileSync(targetFile, readFileSync(sourceFile));
}

export function providerTempRoot(tenantRoot: string, scope: string) {
	const base = resolve(tenantRoot, '.treeseed', 'tmp', scope);
	mkdirSync(base, { recursive: true });
	return base;
}

export function prepareContentPublishRoot(tenantRoot: string, contentRepositoryRoot: string | null) {
	if (!contentRepositoryRoot || resolve(contentRepositoryRoot) === resolve(tenantRoot)) {
		return { root: tenantRoot, cleanup: () => {} };
	}
	const tempRoot = mkdtempSync(join(providerTempRoot(tenantRoot, 'content-repo-publish'), 'treeseed-content-repo-publish-'));
	copyFileIfExists(resolve(tenantRoot, 'treeseed.site.yaml'), resolve(tempRoot, 'treeseed.site.yaml'));
	copyFileIfExists(resolve(tenantRoot, 'package.json'), resolve(tempRoot, 'package.json'));
	copyFileIfExists(resolve(tenantRoot, 'src', 'manifest.yaml'), resolve(tempRoot, 'src', 'manifest.yaml'));
	copyOperationalState(tenantRoot, tempRoot);
	const contentSource = resolve(contentRepositoryRoot, 'src', 'content');
	if (existsSync(contentSource)) {
		copyDirectory(contentSource, resolve(tempRoot, 'src', 'content'));
	}
	const publicSource = resolve(contentRepositoryRoot, 'public');
	if (existsSync(publicSource)) {
		copyDirectory(publicSource, resolve(tempRoot, 'public'));
	}
	return {
		root: tempRoot,
		cleanup: () => rmSync(tempRoot, { recursive: true, force: true }),
	};
}

export function workflowInputForOperation(name: string, input: Record<string, unknown>) {
	switch (name) {
		case 'status':
		case 'tasks':
			return {};
		default:
			return input;
	}
}

export abstract class BaseOperation<TInput extends Record<string, unknown> = Record<string, unknown>> implements OperationImplementation<TInput> {
	readonly metadata: OperationMetadata;

	constructor(name: string) {
		const metadata = findOperation(name);
		if (!metadata) {
			throw new Error(`Unknown operation metadata for "${name}".`);
		}
		this.metadata = metadata;
	}

	abstract execute(input: TInput, context: OperationContext): Promise<OperationResult>;
}

export class WorkflowOperation extends BaseOperation {
	private readonly workflowName: Parameters<WorkflowSdk['execute']>[0];

	constructor(name: string, workflowName?: Parameters<WorkflowSdk['execute']>[0]) {
		super(name);
		this.workflowName = workflowName ?? (name === 'switch' ? 'switch' : name as Parameters<WorkflowSdk['execute']>[0]);
	}

	async execute(input: Record<string, unknown>, context: OperationContext) {
		try {
			const workflow = new WorkflowSdk({
				cwd: context.cwd,
				env: context.env,
				write: context.write,
				prompt: context.prompt,
				confirm: context.confirm,
				transport: context.transport ?? 'sdk',
			});
			return await workflow.execute(this.workflowName, workflowInputForOperation(this.metadata.name, input));
		} catch (error) {
			if (error instanceof WorkflowError) {
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

export class ScriptOperation extends BaseOperation {
	constructor(name: string, private readonly scriptName: string, private readonly extraArgs: string[] = []) {
		super(name);
	}

	async execute(input: Record<string, unknown>, context: OperationContext) {
		const args = Array.isArray(input.args) ? input.args.map(String) : [];
		return runNodeScript(this.metadata, this.scriptName, [...this.extraArgs, ...args], context);
	}
}
