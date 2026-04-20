import {
	findTreeseedOperation,
} from './operations-registry.ts';
import type {
	SdkDispatchCapability,
	SdkDispatchExecutionClass,
	SdkDispatchNamespace,
	SdkDispatchPolicy,
	SdkDispatchTarget,
} from './sdk-types.ts';

function capability(
	namespace: SdkDispatchNamespace,
	operation: string,
	options: {
		executionClass: SdkDispatchExecutionClass;
		allowedTargets: SdkDispatchTarget[];
		defaultTarget: SdkDispatchTarget;
		defaultDispatchMode?: SdkDispatchPolicy;
		summary?: string;
	},
): SdkDispatchCapability {
	return {
		namespace,
		operation,
		executionClass: options.executionClass,
		allowedTargets: options.allowedTargets,
		defaultTarget: options.defaultTarget,
		defaultDispatchMode: options.defaultDispatchMode ?? 'auto',
		summary: options.summary,
	};
}

const INLINE_PROJECT_API_SDK_OPERATIONS = [
	'get',
	'read',
	'search',
	'follow',
	'pick',
	'create',
	'update',
	'claimMessage',
	'ackMessage',
	'createMessage',
	'recordRun',
	'getCursor',
	'upsertCursor',
	'releaseLease',
	'releaseAllLeases',
	'startWorkDay',
	'closeWorkDay',
	'createTask',
	'claimTask',
	'recordTaskProgress',
	'completeTask',
	'failTask',
	'appendTaskEvent',
	'searchTasks',
	'createReport',
	'getManagerContext',
	'listAgentSpecs',
	'listRawAgentSpecs',
	'searchFiles',
	'searchSections',
	'searchEntities',
	'getGraphNode',
	'getNeighbors',
	'followReferences',
	'getBacklinks',
	'getRelated',
	'getSubgraph',
	'resolveSeeds',
	'parseGraphDsl',
	'resolveReference',
	'explainReferenceChain',
] as const;

const REMOTE_JOB_SDK_OPERATIONS = [
	'refreshGraph',
	'queryGraph',
	'buildContextPack',
] as const;

const LOCAL_ONLY_WORKFLOW_OPERATIONS = new Set([
	'init',
	'config',
	'auth:login',
	'auth:logout',
	'secrets:status',
	'secrets:unlock',
	'secrets:lock',
	'secrets:migrate-key',
	'secrets:rotate-passphrase',
	'secrets:rotate-machine-key',
	'dev',
	'dev:watch',
	'mailpit:up',
	'mailpit:down',
	'mailpit:logs',
	'd1:migrate:local',
	'cleanup-markdown',
	'cleanup-markdown:check',
	'astro',
	'sync-devvars',
	'starlight:patch',
	'build',
	'check',
	'preview',
	'lint',
	'test',
	'test:unit',
]);

const REMOTE_JOB_WORKFLOW_OPERATIONS = new Set([
	'save',
	'close',
	'stage',
	'release',
	'rollback',
	'destroy',
	'sync',
	'export',
	'test:e2e',
	'test:e2e:local',
	'test:e2e:staging',
	'test:e2e:full',
	'test:fast',
	'verify',
	'publish:changed',
]);

const INLINE_WORKFLOW_OPERATIONS = new Set([
	'status',
	'tasks',
	'doctor',
	'template',
	'auth:whoami',
]);

const SDK_CAPABILITIES = [
	...INLINE_PROJECT_API_SDK_OPERATIONS.map((operation) =>
		capability('sdk', operation, {
			executionClass: 'remote_inline',
			allowedTargets: ['local', 'project_api'],
			defaultTarget: 'project_api',
		})),
	...REMOTE_JOB_SDK_OPERATIONS.map((operation) =>
		capability('sdk', operation, {
			executionClass: 'remote_job',
			allowedTargets: ['local', 'project_api', 'project_runner'],
			defaultTarget: 'project_runner',
			defaultDispatchMode: 'prefer_remote',
		})),
] satisfies SdkDispatchCapability[];

const SDK_CAPABILITY_INDEX = new Map(
	SDK_CAPABILITIES.map((entry) => [`${entry.namespace}:${entry.operation}`, entry] as const),
);

function workflowCapability(operation: string): SdkDispatchCapability | null {
	const resolved = findTreeseedOperation(operation);
	if (!resolved) {
		return null;
	}

	if (LOCAL_ONLY_WORKFLOW_OPERATIONS.has(resolved.name)) {
		return capability('workflow', resolved.name, {
			executionClass: 'local_only',
			allowedTargets: ['local'],
			defaultTarget: 'local',
		});
	}

	if (REMOTE_JOB_WORKFLOW_OPERATIONS.has(resolved.name)) {
		return capability('workflow', resolved.name, {
			executionClass: 'remote_job',
			allowedTargets: ['local', 'project_runner'],
			defaultTarget: 'project_runner',
			defaultDispatchMode: 'prefer_remote',
		});
	}

	if (INLINE_WORKFLOW_OPERATIONS.has(resolved.name)) {
		return capability('workflow', resolved.name, {
			executionClass: 'remote_inline',
			allowedTargets: resolved.name === 'template'
				? ['local', 'market_catalog', 'project_api']
				: ['local', 'project_api'],
			defaultTarget: resolved.name === 'template' ? 'market_catalog' : 'project_api',
		});
	}

	return capability('workflow', resolved.name, {
		executionClass: 'remote_job',
		allowedTargets: ['local', 'project_runner'],
		defaultTarget: 'project_runner',
		defaultDispatchMode: 'prefer_remote',
	});
}

export function listSdkDispatchCapabilities() {
	return [...SDK_CAPABILITIES];
}

export function listWorkflowDispatchCapabilities() {
	return [
		...LOCAL_ONLY_WORKFLOW_OPERATIONS,
		...REMOTE_JOB_WORKFLOW_OPERATIONS,
		...INLINE_WORKFLOW_OPERATIONS,
	].map((operation) => workflowCapability(operation)).filter((entry): entry is SdkDispatchCapability => Boolean(entry));
}

export function findDispatchCapability(
	namespace: SdkDispatchNamespace,
	operation: string,
): SdkDispatchCapability | null {
	if (namespace === 'sdk') {
		return SDK_CAPABILITY_INDEX.get(`sdk:${operation}`) ?? null;
	}
	return workflowCapability(operation);
}
