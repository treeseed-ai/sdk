import type { SdkDispatchNamespace, SdkDispatchPolicy } from '../entrypoints/models/sdk-types.ts';
import {
	createContentToolPresets,
	genericContentInputSchema,
	type ContentAction,
	type ContentModel,
} from '../operations/content-operations.ts';


export type AgentToolExecutionTarget = 'sdk_dispatch' | 'treedx_proxy' | 'treeseed_content' | 'provider_runner';

export type AgentToolMutability = 'read' | 'content_write' | 'worktree_write' | 'shared_state_write';

export type AgentToolTelemetryCategory = 'treedx' | 'treeseed' | 'repository' | 'capacity' | 'content' | 'research';

export type AgentToolRequirement =
	| 'treedx_proxy_handle'
	| 'assignment_worktree'
	| 'sdk_dispatch'
	| 'provider_runner_runtime'
	| 'provider_runner_git'
	| 'treedx_writable_workspace'
	| 'content_access'
	| 'content_commit'
	| 'research_source_policy';

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
		action: ContentAction;
		model?: ContentModel;
		preset?: string;
	};
}

export const EMPTY_OBJECT_SCHEMA = {
	type: 'object',
	properties: {},
	additionalProperties: false,
} satisfies Record<string, unknown>;

export const GENERIC_RESULT_SCHEMA = {
	type: 'object',
	additionalProperties: true,
} satisfies Record<string, unknown>;

export const CONTENT_RESULT_SCHEMA = {
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

export function contentRequirements(action: ContentAction): AgentToolRequirement[] {
	if (action === 'commit') return ['treedx_proxy_handle', 'treedx_writable_workspace', 'content_access', 'content_commit'];
	if (action === 'create' || action === 'update' || action === 'link' || action === 'validate') {
		return ['treedx_proxy_handle', 'treedx_writable_workspace', 'content_access'];
	}
	return ['treedx_proxy_handle', 'content_access'];
}

export function contentMutability(action: ContentAction): AgentToolMutability {
	return action === 'describe' || action === 'query' || action === 'read' ? 'read' : 'content_write';
}

export const GENERIC_CONTENT_TOOLS: AgentToolDefinition[] = ([
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
	inputSchema: genericContentInputSchema(action),
	outputSchema: CONTENT_RESULT_SCHEMA,
	executionTarget: 'treeseed_content',
	mutability: contentMutability(action),
	telemetryCategory: 'content',
	requirements: contentRequirements(action),
	content: { action },
}));

export const PRESET_CONTENT_TOOLS: AgentToolDefinition[] = createContentToolPresets().map((preset) => ({
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
