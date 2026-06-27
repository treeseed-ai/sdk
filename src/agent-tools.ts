import type { SdkDispatchNamespace, SdkDispatchPolicy } from './sdk-types.ts';
import {
	createTreeseedContentToolPresets,
	genericTreeseedContentInputSchema,
	type TreeseedContentAction,
	type TreeseedContentModel,
} from './content-operations.ts';

export type AgentToolExecutionTarget = 'sdk_dispatch' | 'treedx_proxy' | 'treeseed_content' | 'provider_runner';
export type AgentToolMutability = 'read' | 'content_write' | 'worktree_write' | 'shared_state_write';
export type AgentToolTelemetryCategory = 'treedx' | 'treeseed' | 'repository' | 'capacity' | 'content';
export type AgentToolRequirement =
	| 'treedx_proxy_handle'
	| 'assignment_worktree'
	| 'sdk_dispatch'
	| 'provider_runner_git'
	| 'treedx_writable_workspace'
	| 'content_access'
	| 'content_commit';

export interface AgentToolDispatchMapping {
	namespace: SdkDispatchNamespace;
	operation: string;
	preferredMode?: SdkDispatchPolicy;
	assignmentPreferredMode?: SdkDispatchPolicy;
}

export interface AgentToolDefinition {
	id: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	outputSchema: Record<string, unknown>;
	executionTarget: AgentToolExecutionTarget;
	mutability: AgentToolMutability;
	telemetryCategory: AgentToolTelemetryCategory;
	requirements: AgentToolRequirement[];
	dispatch?: AgentToolDispatchMapping;
	content?: {
		action: TreeseedContentAction;
		model?: TreeseedContentModel;
		preset?: string;
	};
}

const EMPTY_OBJECT_SCHEMA = {
	type: 'object',
	properties: {},
	additionalProperties: false,
} satisfies Record<string, unknown>;

const GENERIC_RESULT_SCHEMA = {
	type: 'object',
	additionalProperties: true,
} satisfies Record<string, unknown>;

const CONTENT_RESULT_SCHEMA = {
	type: 'object',
	properties: {
		ok: { type: 'boolean' },
		action: { type: 'string' },
		refs: { type: 'array', items: { type: 'object', additionalProperties: true } },
		changedPaths: { type: 'array', items: { type: 'string' } },
		diagnostics: { type: 'array', items: { type: 'object', additionalProperties: true } },
	},
	additionalProperties: true,
} satisfies Record<string, unknown>;

function contentRequirements(action: TreeseedContentAction): AgentToolRequirement[] {
	if (action === 'commit') return ['treedx_proxy_handle', 'treedx_writable_workspace', 'content_access', 'content_commit'];
	if (action === 'create' || action === 'update' || action === 'link' || action === 'validate') {
		return ['treedx_proxy_handle', 'treedx_writable_workspace', 'content_access'];
	}
	return ['treedx_proxy_handle', 'content_access'];
}

function contentMutability(action: TreeseedContentAction): AgentToolMutability {
	return action === 'describe' || action === 'query' || action === 'read' ? 'read' : 'content_write';
}

const GENERIC_CONTENT_TOOLS: AgentToolDefinition[] = ([
	['describe', 'Describe content model', 'Describe TreeSeed content models, fields, relations, and allowed operations.'],
	['query', 'Query content', 'Query TreeSeed content records through model-aware TreeDX access.'],
	['read', 'Read content', 'Read a TreeSeed content record through model-aware TreeDX access.'],
	['create', 'Create content', 'Create a TreeSeed content record using SDK frontmatter and markdown serialization.'],
	['update', 'Update content', 'Update a TreeSeed content record using SDK frontmatter and markdown serialization.'],
	['link', 'Link content', 'Create or update TreeSeed content relationships with model-aware validation.'],
	['validate', 'Validate content', 'Validate a TreeSeed content record before committing it.'],
	['commit', 'Commit content workspace', 'Commit staged TreeSeed content workspace changes when agent policy permits it.'],
] as const).map(([action, title, description]) => ({
	id: `treeseed.content.${action}`,
	title,
	description,
	inputSchema: genericTreeseedContentInputSchema(action),
	outputSchema: CONTENT_RESULT_SCHEMA,
	executionTarget: 'treeseed_content',
	mutability: contentMutability(action),
	telemetryCategory: 'content',
	requirements: contentRequirements(action),
	content: { action },
}));

const PRESET_CONTENT_TOOLS: AgentToolDefinition[] = createTreeseedContentToolPresets().map((preset) => ({
	id: preset.id,
	title: preset.title,
	description: preset.description,
	inputSchema: preset.inputSchema,
	outputSchema: CONTENT_RESULT_SCHEMA,
	executionTarget: 'treeseed_content',
	mutability: contentMutability(preset.action),
	telemetryCategory: 'content',
	requirements: contentRequirements(preset.action),
	content: { action: preset.action, model: preset.model, preset: preset.id },
}));

export const TREESEED_AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
	{
		id: 'treedx.build_context',
		title: 'Build TreeDX context',
		description: 'Build assignment-scoped TreeDX repository context for a query or path set.',
		inputSchema: {
			type: 'object',
			properties: {
				repoId: { type: 'string' },
				query: { type: 'string' },
				paths: { type: 'array', items: { type: 'string' } },
			},
			additionalProperties: false,
		},
		outputSchema: GENERIC_RESULT_SCHEMA,
		executionTarget: 'treedx_proxy',
		mutability: 'read',
		telemetryCategory: 'treedx',
		requirements: ['treedx_proxy_handle'],
	},
	{
		id: 'treedx.read_repository_files',
		title: 'Read TreeDX repository files',
		description: 'Read repository files through the assignment-scoped TreeDX proxy.',
		inputSchema: {
			type: 'object',
			properties: {
				repoId: { type: 'string' },
				paths: { type: 'array', items: { type: 'string' } },
				ref: { type: 'string' },
			},
			required: ['paths'],
			additionalProperties: false,
		},
		outputSchema: GENERIC_RESULT_SCHEMA,
		executionTarget: 'treedx_proxy',
		mutability: 'read',
		telemetryCategory: 'treedx',
		requirements: ['treedx_proxy_handle'],
	},
	{
		id: 'treedx.search_workspace',
		title: 'Search TreeDX workspace',
		description: 'Search the assignment-scoped TreeDX workspace.',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: { type: 'string' },
				query: { type: 'string' },
			},
			required: ['query'],
			additionalProperties: false,
		},
		outputSchema: GENERIC_RESULT_SCHEMA,
		executionTarget: 'treedx_proxy',
		mutability: 'read',
		telemetryCategory: 'treedx',
		requirements: ['treedx_proxy_handle'],
	},
	{
		id: 'treedx.read_workspace_file',
		title: 'Read TreeDX workspace file',
		description: 'Read a file from the assignment-scoped TreeDX workspace.',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: { type: 'string' },
				path: { type: 'string' },
			},
			required: ['path'],
			additionalProperties: false,
		},
		outputSchema: GENERIC_RESULT_SCHEMA,
		executionTarget: 'treedx_proxy',
		mutability: 'read',
		telemetryCategory: 'treedx',
		requirements: ['treedx_proxy_handle'],
	},
	{
		id: 'treedx.write_workspace_file',
		title: 'Write TreeDX workspace file',
		description: 'Write a file through the assignment-scoped TreeDX workspace proxy.',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: { type: 'string' },
				path: { type: 'string' },
				content: { type: 'string' },
			},
			required: ['path', 'content'],
			additionalProperties: false,
		},
		outputSchema: GENERIC_RESULT_SCHEMA,
		executionTarget: 'treedx_proxy',
		mutability: 'content_write',
		telemetryCategory: 'treedx',
		requirements: ['treedx_proxy_handle'],
	},
	{
		id: 'treedx.commit_workspace',
		title: 'Commit TreeDX workspace',
		description: 'Commit pending assignment-scoped TreeDX workspace changes.',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: { type: 'string' },
				message: { type: 'string' },
			},
			required: ['message'],
			additionalProperties: false,
		},
		outputSchema: GENERIC_RESULT_SCHEMA,
		executionTarget: 'treedx_proxy',
		mutability: 'content_write',
		telemetryCategory: 'treedx',
		requirements: ['treedx_proxy_handle'],
	},
	{
		id: 'treeseed.status',
		title: 'TreeSeed status',
		description: 'Inspect TreeSeed workspace and runtime status through SDK dispatch.',
		inputSchema: EMPTY_OBJECT_SCHEMA,
		outputSchema: GENERIC_RESULT_SCHEMA,
		executionTarget: 'sdk_dispatch',
		mutability: 'read',
		telemetryCategory: 'treeseed',
		requirements: ['sdk_dispatch'],
		dispatch: {
			namespace: 'workflow',
			operation: 'status',
			preferredMode: 'prefer_local',
			assignmentPreferredMode: 'auto',
		},
	},
	{
		id: 'treeseed.dev_plan',
		title: 'TreeSeed dev plan',
		description: 'Inspect the local development plan without starting services.',
		inputSchema: {
			type: 'object',
			properties: {
				webRuntime: { type: 'string' },
				app: { type: 'string' },
			},
			additionalProperties: false,
		},
		outputSchema: GENERIC_RESULT_SCHEMA,
		executionTarget: 'sdk_dispatch',
		mutability: 'read',
		telemetryCategory: 'treeseed',
		requirements: ['sdk_dispatch'],
		dispatch: {
			namespace: 'workflow',
			operation: 'dev',
			preferredMode: 'prefer_local',
			assignmentPreferredMode: 'prefer_local',
		},
	},
	{
		id: 'treeseed.changed_paths',
		title: 'Changed paths',
		description: 'Inspect changed paths in the assignment worktree.',
		inputSchema: {
			type: 'object',
			properties: {
				includeDiffSummary: { type: 'boolean' },
			},
			additionalProperties: false,
		},
		outputSchema: GENERIC_RESULT_SCHEMA,
		executionTarget: 'provider_runner',
		mutability: 'read',
		telemetryCategory: 'repository',
		requirements: ['assignment_worktree', 'provider_runner_git'],
	},
	{
		id: 'treeseed.verify',
		title: 'TreeSeed verify',
		description: 'Run assignment-scoped verification through SDK dispatch.',
		inputSchema: {
			type: 'object',
			properties: {
				commands: { type: 'array', items: { type: 'string' } },
				reason: { type: 'string' },
			},
			additionalProperties: false,
		},
		outputSchema: GENERIC_RESULT_SCHEMA,
		executionTarget: 'sdk_dispatch',
		mutability: 'worktree_write',
		telemetryCategory: 'treeseed',
		requirements: ['sdk_dispatch', 'assignment_worktree'],
		dispatch: {
			namespace: 'workflow',
			operation: 'test',
			preferredMode: 'prefer_local',
			assignmentPreferredMode: 'prefer_local',
		},
	},
	...GENERIC_CONTENT_TOOLS,
	...PRESET_CONTENT_TOOLS,
];

const AGENT_TOOL_INDEX = new Map(TREESEED_AGENT_TOOL_DEFINITIONS.map((definition) => [definition.id, definition]));

export function findAgentToolDefinition(id: string | null | undefined) {
	return id ? AGENT_TOOL_INDEX.get(id) ?? null : null;
}

export function listAgentToolIds() {
	return TREESEED_AGENT_TOOL_DEFINITIONS.map((definition) => definition.id);
}

export function assertKnownAgentToolIds(ids: string[]) {
	const seen = new Set<string>();
	const known: string[] = [];
	const unknown: string[] = [];
	const duplicates: string[] = [];
	for (const id of ids) {
		if (seen.has(id)) {
			duplicates.push(id);
			continue;
		}
		seen.add(id);
		if (AGENT_TOOL_INDEX.has(id)) {
			known.push(id);
		} else {
			unknown.push(id);
		}
	}
	return { known, unknown, duplicates };
}
