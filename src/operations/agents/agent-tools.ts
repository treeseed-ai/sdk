export const AGENT_OPERATION_NAMES = [
	'switch',
	'dev',
	'verify',
	'save',
	'update',
	'stage',
	'close',
	'release',
] as const;

export const AGENT_OPERATION_MODES = ['plan', 'read_only', 'mutating'] as const;

export type AgentOperationName = (typeof AGENT_OPERATION_NAMES)[number];
export type AgentOperationMode = (typeof AGENT_OPERATION_MODES)[number];
export type AgentOperationStatus = 'completed' | 'waiting' | 'failed' | 'skipped' | 'retry_created';

export interface AgentOperationRequest {
	operation: AgentOperationName;
	mode: AgentOperationMode;
	taskId: string;
	taskKind?: string;
	workDayId?: string;
	agentSlug: string;
	agentRole: string;
	projectId: string;
	environment: string;
	repoRoot: string;
	worktreeRoot?: string;
	featureBranch?: string;
	stagingBranch?: string;
	permissionGrantId?: string;
	allowedPaths?: string[];
	forbiddenPaths?: string[];
	changedPaths?: string[];
	input: Record<string, unknown>;
}

export interface AgentDeterministicOperationStep {
	id: string;
	operation: AgentOperationName;
	stage:
		| 'before_mutation'
		| 'during_mutation'
		| 'after_mutation'
		| 'after_verification_passes'
		| 'after_verification_fails'
		| 'after_staging_merge_fails'
		| 'closeout'
		| string;
	mode: AgentOperationMode;
	required?: boolean;
}

export interface AgentOperationGrant {
	id: string;
	state?: 'active' | 'paused' | 'revoked';
	operations: AgentOperationName[];
	modes: AgentOperationMode[];
	agentRoles?: string[];
	taskKinds?: string[];
	projectIds?: string[];
	environments?: string[];
	allowedPaths?: string[];
	forbiddenPaths?: string[];
	expiresAt?: string;
	metadata?: Record<string, unknown>;
}

export interface AgentOperationMergeFailure {
	targetBranch: string;
	featureBranch: string;
	conflictedPaths: string[];
	message: string;
	repairTaskId?: string;
}

export interface AgentOperationResult {
	operation: AgentOperationName;
	status: AgentOperationStatus;
	summary: string;
	changedPaths: string[];
	stagedPaths: string[];
	mergedToStaging?: boolean;
	mergeFailure?: AgentOperationMergeFailure;
	commandsRun: string[];
	artifacts: Array<{
		kind: string;
		ref: string;
	}>;
	error?: {
		code: string;
		message: string;
		retryable: boolean;
	};
	metadata: Record<string, unknown>;
}

export type AgentOperationPermissionCode =
	| 'allowed'
	| 'invalid_operation'
	| 'operation_permission_required'
	| 'operation_grant_inactive'
	| 'operation_grant_expired'
	| 'operation_mode_not_granted'
	| 'operation_role_not_granted'
	| 'operation_task_kind_not_granted'
	| 'operation_project_not_granted'
	| 'operation_environment_not_granted'
	| 'operation_worktree_required'
	| 'operation_allowed_paths_required'
	| 'operation_path_not_allowed'
	| 'operation_path_forbidden';

export interface AgentOperationPermissionDecision {
	allowed: boolean;
	status: 'completed' | 'waiting' | 'failed';
	code: AgentOperationPermissionCode;
	summary: string;
	grant?: AgentOperationGrant;
	metadata: Record<string, unknown>;
}

export interface AgentOperationEvent {
	operation: AgentOperationName;
	mode: AgentOperationMode;
	agentRole: string;
	taskId: string;
	permissionGrantId?: string;
	inputSummary: Record<string, unknown>;
	result: AgentOperationResult;
	createdAt: string;
}

export function normalizePath(value: string) {
	return value.replace(/\\/gu, '/').replace(/^\.?\//u, '').replace(/\/+/gu, '/');
}

export function matchesPattern(path: string, pattern: string) {
	const normalizedPath = normalizePath(path);
	const normalizedPattern = normalizePath(pattern);
	if (normalizedPattern === '**' || normalizedPattern === '*') return true;
	if (normalizedPattern.endsWith('/**')) {
		const prefix = normalizedPattern.slice(0, -3);
		return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
	}
	if (normalizedPattern.endsWith('/')) {
		return normalizedPath.startsWith(normalizedPattern);
	}
	return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
}

export function listMatches(value: string | undefined, allowed: string[] | undefined) {
	return !allowed?.length || (value !== undefined && allowed.includes(value));
}

export function grantActive(grant: AgentOperationGrant, now: Date) {
	if ((grant.state ?? 'active') !== 'active') {
		return 'operation_grant_inactive' as const;
	}
	if (grant.expiresAt && Date.parse(grant.expiresAt) <= now.valueOf()) {
		return 'operation_grant_expired' as const;
	}
	return null;
}

export function deny(
	code: Exclude<AgentOperationPermissionCode, 'allowed'>,
	summary: string,
	options: {
		status?: 'waiting' | 'failed';
		grant?: AgentOperationGrant;
		metadata?: Record<string, unknown>;
	} = {},
): AgentOperationPermissionDecision {
	return {
		allowed: false,
		status: options.status ?? 'waiting',
		code,
		summary,
		grant: options.grant,
		metadata: options.metadata ?? {},
	};
}

export function allow(grant: AgentOperationGrant, metadata: Record<string, unknown> = {}): AgentOperationPermissionDecision {
	return {
		allowed: true,
		status: 'completed',
		code: 'allowed',
		summary: `Operation grant ${grant.id} allows this request.`,
		grant,
		metadata,
	};
}

export function isAgentOperationName(value: string): value is AgentOperationName {
	return AGENT_OPERATION_NAMES.includes(value as AgentOperationName);
}

export function resolveAgentOperationGrant(
	request: AgentOperationRequest,
	grants: readonly AgentOperationGrant[],
	now: Date = new Date(),
) {
	return grants.find((grant) => {
		if (request.permissionGrantId && grant.id !== request.permissionGrantId) return false;
		if (grantActive(grant, now)) return false;
		if (!grant.operations.includes(request.operation)) return false;
		return true;
	}) ?? null;
}

export function decideAgentOperationPermission(input: {
	request: AgentOperationRequest;
	grants: readonly AgentOperationGrant[];
	now?: Date;
}): AgentOperationPermissionDecision {
	const { request } = input;
	const now = input.now ?? new Date();
	if (!isAgentOperationName(request.operation)) {
		return deny('invalid_operation', `Unsupported agent operation "${String(request.operation)}".`, { status: 'failed' });
	}

	const grant = resolveAgentOperationGrant(request, input.grants, now);
	if (!grant) {
		return deny('operation_permission_required', `No operation grant allows ${request.agentRole} to run ${request.operation}.`);
	}
	const activeCode = grantActive(grant, now);
	if (activeCode) {
		return deny(activeCode, `Operation grant ${grant.id} is not active.`, { grant });
	}
	if (!grant.modes.includes(request.mode)) {
		return deny('operation_mode_not_granted', `Operation grant ${grant.id} does not allow ${request.mode} mode.`, { grant });
	}
	if (!listMatches(request.agentRole, grant.agentRoles)) {
		return deny('operation_role_not_granted', `Operation grant ${grant.id} does not allow role ${request.agentRole}.`, { grant });
	}
	if (!listMatches(request.taskKind, grant.taskKinds)) {
		return deny('operation_task_kind_not_granted', `Operation grant ${grant.id} does not allow task kind ${request.taskKind ?? '<none>'}.`, { grant });
	}
	if (!listMatches(request.projectId, grant.projectIds)) {
		return deny('operation_project_not_granted', `Operation grant ${grant.id} does not allow project ${request.projectId}.`, { grant });
	}
	if (!listMatches(request.environment, grant.environments)) {
		return deny('operation_environment_not_granted', `Operation grant ${grant.id} does not allow environment ${request.environment}.`, { grant });
	}
	if (request.mode === 'mutating' && !request.worktreeRoot && request.operation !== 'release') {
		return deny('operation_worktree_required', `Mutating operation ${request.operation} requires an assigned worktree root.`, { grant });
	}

	const allowedPaths = request.allowedPaths?.length ? request.allowedPaths : grant.allowedPaths ?? [];
	const forbiddenPaths = [...(grant.forbiddenPaths ?? []), ...(request.forbiddenPaths ?? [])];
	const changedPaths = request.changedPaths ?? [];
	if (request.operation === 'stage' && allowedPaths.length === 0) {
		return deny('operation_allowed_paths_required', `${request.operation} requires allowed paths.`, { grant });
	}
	for (const changedPath of changedPaths) {
		if (forbiddenPaths.some((pattern) => matchesPattern(changedPath, pattern))) {
			return deny('operation_path_forbidden', `${changedPath} is forbidden.`, {
				grant,
				status: 'failed',
				metadata: { changedPath, forbiddenPaths },
			});
		}
		if (allowedPaths.length > 0 && !allowedPaths.some((pattern) => matchesPattern(changedPath, pattern))) {
			return deny('operation_path_not_allowed', `${changedPath} is outside allowed paths.`, {
				grant,
				status: 'failed',
				metadata: { changedPath, allowedPaths },
			});
		}
	}

	return allow(grant, { allowedPaths, forbiddenPaths });
}

export function deniedAgentOperationResult(
	request: AgentOperationRequest,
	decision: AgentOperationPermissionDecision,
): AgentOperationResult {
	return {
		operation: request.operation,
		status: decision.status,
		summary: decision.summary,
		changedPaths: request.changedPaths ?? [],
		stagedPaths: [],
		commandsRun: [],
		artifacts: [],
		error: {
			code: decision.code,
			message: decision.summary,
			retryable: decision.status === 'waiting',
		},
		metadata: {
			permission: decision,
		},
	};
}

export function createAgentOperationEvent(input: {
	request: AgentOperationRequest;
	result: AgentOperationResult;
	createdAt?: string;
}): AgentOperationEvent {
	return {
		operation: input.request.operation,
		mode: input.request.mode,
		agentRole: input.request.agentRole,
		taskId: input.request.taskId,
		permissionGrantId: input.request.permissionGrantId,
		inputSummary: {
			projectId: input.request.projectId,
			environment: input.request.environment,
			allowedPaths: input.request.allowedPaths ?? [],
			forbiddenPaths: input.request.forbiddenPaths ?? [],
			changedPaths: input.request.changedPaths ?? [],
		},
		result: input.result,
		createdAt: input.createdAt ?? new Date().toISOString(),
	};
}

export { checkpointAgentWorktree } from './agent-worktree-checkpoint.ts';
export type { AgentWorktreeCheckpointExecutor, AgentWorktreeCheckpointInput } from './agent-worktree-checkpoint.ts';
export { prepareAgentWorktree } from './agent-worktree-prepare.ts';
export type { PrepareAgentWorktreeExecutor, PrepareAgentWorktreeInput } from './agent-worktree-prepare.ts';
export { releaseAgentWorktree } from '../packages/agent-worktree-release.ts';
export type { ReleaseAgentWorktreeExecutor, ReleaseAgentWorktreeInput } from '../packages/agent-worktree-release.ts';
