import { describe, expect, it, vi } from 'vitest';
import {
	assertKnownAgentToolIds,
	findAgentToolDefinition,
	listAgentToolIds,
} from '../../../src/agent-tools.ts';
import {
	AGENT_OPERATION_NAMES,
	checkpointAgentWorktree,
	prepareAgentWorktree,
	releaseAgentWorktree,
	createAgentOperationEvent,
	decideAgentOperationPermission,
	deniedAgentOperationResult,
	type AgentOperationGrant,
	type AgentOperationRequest,
} from '../../../src/operations/agent-tools.ts';

const baseRequest: AgentOperationRequest = {
	operation: 'save',
	mode: 'mutating',
	taskId: 'task-1',
	taskKind: 'implementation',
	agentSlug: 'engineer',
	agentRole: 'engineer',
	projectId: 'market',
	environment: 'local',
	repoRoot: '/repo',
	worktreeRoot: '/repo/.agent-worktrees/task-1',
	featureBranch: 'agent/task-1',
	permissionGrantId: 'grant-1',
	allowedPaths: ['src/content/knowledge/**'],
	forbiddenPaths: ['src/content/secrets/**'],
	changedPaths: ['src/content/knowledge/runtime.mdx'],
	input: {},
};

const baseGrant: AgentOperationGrant = {
	id: 'grant-1',
	operations: ['switch', 'dev', 'verify', 'save', 'stage', 'close', 'release'],
	modes: ['plan', 'read_only', 'mutating'],
	agentRoles: ['engineer'],
	taskKinds: ['implementation'],
	projectIds: ['market'],
	environments: ['local'],
	allowedPaths: ['src/content/knowledge/**'],
	forbiddenPaths: ['src/content/secrets/**'],
};

describe('agent operation tool policy', () => {
	it('prepares an isolated assignment worktree from the resolved governed commit', async () => {
		const exec = vi.fn(async (_command: string, args: string[]) => ({ stdout: args[0] === 'rev-parse' ? '0123456789abcdef\n' : '' }));
		const result = await prepareAgentWorktree({
			repoRoot: '/repo', worktreeRoot: '/repo/.agent-worktrees/assignment-1', branchName: 'agent/tester/assignment-1',
			baseRef: '0123456', exists: false,
		}, { exec });
		expect(result).toMatchObject({ exactBaseRef: '0123456789abcdef', created: true });
		expect(exec).toHaveBeenLastCalledWith('git', ['worktree', 'add', '-B', 'agent/tester/assignment-1', '/repo/.agent-worktrees/assignment-1', '0123456789abcdef'], expect.objectContaining({ cwd: '/repo' }));
	});

	it('releases a registered assignment worktree without allowing primary-repository removal', async () => {
		const exec = vi.fn(async (_command: string, args: string[]) => ({
			stdout: args[0] === 'worktree' && args[1] === 'list'
				? 'worktree /repo\nHEAD abc\n\nworktree /repo/.agent-worktrees/assignment-1\nHEAD def\n'
				: '',
		}));
		await expect(releaseAgentWorktree({ repoRoot: '/repo', worktreeRoot: '/repo' }, { exec }))
			.rejects.toThrow('cannot remove the repository root');
		await expect(releaseAgentWorktree({ repoRoot: '/repo', worktreeRoot: '/repo/.agent-worktrees/assignment-1' }, { exec }))
			.resolves.toMatchObject({ removed: true, reason: 'terminal_assignment' });
		expect(exec).toHaveBeenCalledWith('git', ['worktree', 'remove', '--force', '/repo/.agent-worktrees/assignment-1'], expect.objectContaining({ cwd: '/repo' }));
		expect(exec).toHaveBeenCalledWith('git', ['worktree', 'prune'], expect.objectContaining({ cwd: '/repo' }));
	});

	it('creates a path-scoped local checkpoint without publishing operations', async () => {
		const { operation: _operation, mode: _mode, changedPaths: _changedPaths, ...request } = baseRequest;
		const exec = vi.fn(async (_command: string, args: string[]) => ({
			stdout: args[0] === 'status' ? ' M src/content/knowledge/runtime.mdx\n'
				: args[0] === 'branch' ? 'agent/task-1\n'
					: args[0] === 'rev-parse' ? '0123456789abcdef\n' : '',
		}));
		const result = await checkpointAgentWorktree({
			request: { ...request, worktreeRoot: request.worktreeRoot!, message: 'test: checkpoint assignment result' },
			grant: baseGrant,
		}, { exec });
		expect(result).toMatchObject({
			status: 'completed', changedPaths: ['src/content/knowledge/runtime.mdx'],
			artifacts: [{ kind: 'source_commit', ref: '0123456789abcdef' }],
			metadata: { branchName: 'agent/task-1', noChanges: false },
		});
		expect(exec.mock.calls.map((call) => call[1][0])).toEqual(['status', 'branch', 'add', 'commit', 'rev-parse']);
		expect(exec.mock.calls.flatMap((call) => call[1])).not.toContain('push');
		expect(exec.mock.calls.flatMap((call) => call[1])).not.toContain('merge');
	});

	it('refuses to checkpoint a changed path outside assignment authority', async () => {
		const { operation: _operation, mode: _mode, changedPaths: _changedPaths, ...request } = baseRequest;
		const exec = vi.fn(async () => ({ stdout: ' M src/implementation.ts\n' }));
		const result = await checkpointAgentWorktree({
			request: { ...request, worktreeRoot: request.worktreeRoot!, message: 'checkpoint' },
			grant: baseGrant,
		}, { exec });
		expect(result).toMatchObject({ status: 'failed', error: { code: 'operation_path_not_allowed' } });
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it('allows requests covered by an active grant', () => {
		const decision = decideAgentOperationPermission({
			request: baseRequest,
			grants: [baseGrant],
			now: new Date('2026-05-13T12:00:00.000Z'),
		});

		expect(decision).toMatchObject({
			allowed: true,
			code: 'allowed',
			grant: { id: 'grant-1' },
		});
	});

	it('treats the canonical double-star path grant as repository-wide authority', () => {
		expect(decideAgentOperationPermission({
			request: { ...baseRequest, allowedPaths: ['**'], changedPaths: ['tests/regression.test.ts'] },
			grants: [{ ...baseGrant, allowedPaths: ['**'] }],
		}).code).toBe('allowed');
	});

	it('returns waiting when no operation grant matches', () => {
		const decision = decideAgentOperationPermission({
			request: { ...baseRequest, permissionGrantId: undefined },
			grants: [],
		});

		expect(decision).toMatchObject({
			allowed: false,
			status: 'waiting',
			code: 'operation_permission_required',
		});
	});

	it('denies wrong role, task kind, project, and environment', () => {
		expect(decideAgentOperationPermission({
			request: { ...baseRequest, agentRole: 'researcher' },
			grants: [baseGrant],
		}).code).toBe('operation_role_not_granted');
		expect(decideAgentOperationPermission({
			request: { ...baseRequest, taskKind: 'research_question' },
			grants: [baseGrant],
		}).code).toBe('operation_task_kind_not_granted');
		expect(decideAgentOperationPermission({
			request: { ...baseRequest, projectId: 'other' },
			grants: [baseGrant],
		}).code).toBe('operation_project_not_granted');
		expect(decideAgentOperationPermission({
			request: { ...baseRequest, environment: 'prod' },
			grants: [baseGrant],
		}).code).toBe('operation_environment_not_granted');
	});

	it('requires assigned worktrees for mutating non-release operations', () => {
		const decision = decideAgentOperationPermission({
			request: { ...baseRequest, worktreeRoot: undefined },
			grants: [baseGrant],
		});

		expect(decision).toMatchObject({
			allowed: false,
			code: 'operation_worktree_required',
		});
	});

	it('allows plan and read-only grants without a worktree', () => {
		const grant: AgentOperationGrant = {
			...baseGrant,
			operations: ['dev'],
			modes: ['plan', 'read_only'],
		};

		expect(decideAgentOperationPermission({
			request: { ...baseRequest, operation: 'dev', mode: 'plan', worktreeRoot: undefined },
			grants: [grant],
		}).allowed).toBe(true);
		expect(decideAgentOperationPermission({
			request: { ...baseRequest, operation: 'dev', mode: 'read_only', worktreeRoot: undefined },
			grants: [grant],
		}).allowed).toBe(true);
	});

	it('requires allowed paths and rejects forbidden paths for stage-like operations', () => {
		expect(decideAgentOperationPermission({
			request: {
				...baseRequest,
				operation: 'stage',
				allowedPaths: [],
				changedPaths: ['src/content/knowledge/runtime.mdx'],
			},
			grants: [{ ...baseGrant, allowedPaths: [] }],
		}).code).toBe('operation_allowed_paths_required');

		expect(decideAgentOperationPermission({
			request: {
				...baseRequest,
				operation: 'stage',
				changedPaths: ['packages/agent/src/agent-runtime.ts'],
			},
			grants: [baseGrant],
		}).code).toBe('operation_path_not_allowed');

		expect(decideAgentOperationPermission({
			request: {
				...baseRequest,
				operation: 'stage',
				changedPaths: ['src/content/secrets/hidden.mdx'],
			},
			grants: [baseGrant],
		}).code).toBe('operation_path_forbidden');
	});

	it('creates denied result envelopes and operation events', () => {
		const decision = decideAgentOperationPermission({
			request: { ...baseRequest, permissionGrantId: undefined },
			grants: [],
		});
		const result = deniedAgentOperationResult(baseRequest, decision);
		const event = createAgentOperationEvent({
			request: baseRequest,
			result,
			createdAt: '2026-05-13T12:00:00.000Z',
		});

		expect(result).toMatchObject({
			operation: 'save',
			status: 'waiting',
			error: { code: 'operation_permission_required', retryable: true },
		});
		expect(event).toMatchObject({
			operation: 'save',
			mode: 'mutating',
			taskId: 'task-1',
			result: { status: 'waiting' },
		});
	});

	it('exposes no separate staging merge agent operation', () => {
		expect(AGENT_OPERATION_NAMES).toEqual([
			'switch',
			'dev',
			'verify',
			'save',
			'update',
			'stage',
			'close',
			'release',
		]);
	});

	it('validates canonical agent tool ids', () => {
		expect(listAgentToolIds()).toContain('treeseed.verify');
		expect(listAgentToolIds()).toContain('treeseed.review_decision');
		expect(findAgentToolDefinition('treedx.search_workspace')).toMatchObject({
			id: 'treedx.search_workspace',
			executionTarget: 'treedx_proxy',
		});
		const verifyTool = findAgentToolDefinition('treeseed.verify');
		expect(verifyTool).toMatchObject({
			executionTarget: 'provider_runner',
			mutability: 'read',
			requirements: ['assignment_worktree', 'provider_runner_git'],
			inputSchema: {
				required: ['commands'],
				properties: {
					commands: {
						minItems: 1,
						maxItems: 8,
						items: {
							required: ['command', 'args'],
							properties: {
								command: { enum: ['node', 'npm'] },
							},
						},
					},
				},
			},
		});
		expect(verifyTool?.dispatch).toBeUndefined();
		expect(assertKnownAgentToolIds(['treeseed.verify', 'treeseed.verify', 'missing.tool'])).toEqual({
			known: ['treeseed.verify'],
			unknown: ['missing.tool'],
			duplicates: ['treeseed.verify'],
		});
	});
});
