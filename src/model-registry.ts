import path from 'node:path';
import { resolveSdkRepoRoot } from './runtime.ts';
import type {
	SdkBuiltinModelName,
	SdkModelDefinition,
	SdkModelName,
	SdkModelRegistry,
} from './sdk-types.ts';

function contentRoot(repoRoot?: string) {
	return process.env.TREESEED_AGENT_CONTENT_ROOT
		? path.resolve(process.env.TREESEED_AGENT_CONTENT_ROOT)
		: path.resolve(resolveSdkRepoRoot(repoRoot), 'src', 'content');
}

export function buildBuiltinModelRegistry(repoRoot?: string): Record<SdkBuiltinModelName, SdkModelDefinition> {
	const root = contentRoot(repoRoot);

	return {
		page: {
			name: 'page',
			aliases: ['pages'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			filterableFields: ['title', 'slug', 'status', 'audience', 'updated'],
			sortableFields: ['title', 'updated'],
			pickField: 'updated',
			contentCollection: 'pages',
			contentDir: path.join(root, 'pages'),
		},
		note: {
			name: 'note',
			aliases: ['notes'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			filterableFields: ['title', 'status', 'author', 'tags', 'date', 'updated'],
			sortableFields: ['title', 'date', 'updated'],
			pickField: 'date',
			contentCollection: 'notes',
			contentDir: path.join(root, 'notes'),
		},
		question: {
			name: 'question',
			aliases: ['questions'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			filterableFields: ['title', 'status', 'tags', 'date', 'questionType', 'relatedObjectives', 'relatedBooks'],
			sortableFields: ['title', 'date', 'updated'],
			pickField: 'date',
			contentCollection: 'questions',
			contentDir: path.join(root, 'questions'),
		},
		book: {
			name: 'book',
			aliases: ['books'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			filterableFields: ['title', 'slug', 'tags', 'sectionLabel'],
			sortableFields: ['title', 'order', 'updated'],
			pickField: 'order',
			contentCollection: 'books',
			contentDir: path.join(root, 'books'),
		},
		knowledge: {
			name: 'knowledge',
			aliases: ['knowledge-base', 'docs'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			filterableFields: ['title', 'tags', 'updated', 'slug'],
			sortableFields: ['title', 'updated'],
			pickField: 'updated',
			contentCollection: 'docs',
			contentDir: path.join(root, 'knowledge'),
		},
		objective: {
			name: 'objective',
			aliases: ['objectives'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			filterableFields: ['title', 'status', 'tags', 'date', 'timeHorizon', 'relatedQuestions', 'relatedBooks'],
			sortableFields: ['title', 'date', 'updated'],
			pickField: 'date',
			contentCollection: 'objectives',
			contentDir: path.join(root, 'objectives'),
		},
		person: {
			name: 'person',
			aliases: ['people', 'persons'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			filterableFields: ['name', 'role', 'affiliation', 'status', 'tags'],
			sortableFields: ['name', 'updated'],
			pickField: 'updated',
			contentCollection: 'people',
			contentDir: path.join(root, 'people'),
		},
		subscription: {
			name: 'subscription',
			aliases: ['subscriptions', 'subscriber', 'subscribers'],
			storage: 'd1',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			filterableFields: ['email', 'status', 'source', 'created_at', 'updated_at'],
			sortableFields: ['email', 'created_at', 'updated_at'],
			pickField: 'updated_at',
		},
		message: {
			name: 'message',
			aliases: ['messages'],
			storage: 'd1',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			filterableFields: ['type', 'status', 'related_model', 'related_id', 'priority', 'available_at'],
			sortableFields: ['priority', 'available_at', 'created_at', 'updated_at'],
			pickField: 'available_at',
		},
		agent: {
			name: 'agent',
			aliases: ['agents'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			filterableFields: ['slug', 'runtimeStatus', 'tags', 'operator'],
			sortableFields: ['name', 'slug', 'updated'],
			pickField: 'updated',
			contentCollection: 'agents',
			contentDir: path.join(root, 'agents'),
		},
		agent_run: {
			name: 'agent_run',
			aliases: ['agent_runs', 'run', 'runs'],
			storage: 'd1',
			operations: ['get', 'read', 'search', 'follow', 'create', 'update'],
			filterableFields: ['run_id', 'agent_slug', 'status', 'started_at', 'finished_at'],
			sortableFields: ['started_at', 'finished_at'],
			pickField: 'started_at',
		},
		agent_cursor: {
			name: 'agent_cursor',
			aliases: ['agent_cursors', 'cursor', 'cursors'],
			storage: 'd1',
			operations: ['get', 'read', 'search', 'follow', 'create', 'update'],
			filterableFields: ['agent_slug', 'cursor_key', 'cursor_value', 'updated_at'],
			sortableFields: ['updated_at', 'agent_slug', 'cursor_key'],
			pickField: 'updated_at',
		},
		content_lease: {
			name: 'content_lease',
			aliases: ['content_leases', 'lease', 'leases'],
			storage: 'd1',
			operations: ['get', 'read', 'search', 'follow', 'create', 'update'],
			filterableFields: ['model', 'item_key', 'claimed_by', 'lease_expires_at'],
			sortableFields: ['lease_expires_at', 'claimed_at'],
			pickField: 'lease_expires_at',
		},
	};
}

function normalizeDefinition(definition: SdkModelDefinition): SdkModelDefinition {
	return {
		...definition,
		name: definition.name.trim() as SdkModelName,
		aliases: [...new Set((definition.aliases ?? []).map((alias) => alias.trim().toLowerCase()).filter(Boolean))],
		filterableFields: [...new Set(definition.filterableFields ?? [])],
		sortableFields: [...new Set(definition.sortableFields ?? [])],
	};
}

export function mergeModelRegistries(
	baseRegistry: SdkModelRegistry,
	definitions: SdkModelDefinition[] = [],
): SdkModelRegistry {
	const registry: SdkModelRegistry = { ...baseRegistry };

	for (const rawDefinition of definitions) {
		const definition = normalizeDefinition(rawDefinition);
		if (!definition.name) {
			throw new Error('SDK model definitions require a non-empty name.');
		}

		registry[definition.name] = definition;
	}

	return registry;
}

export function buildModelRegistry(definitions: SdkModelDefinition[] = []): SdkModelRegistry {
	return mergeModelRegistries(buildBuiltinModelRegistry(), definitions);
}

export function buildScopedModelRegistry(
	repoRoot: string | undefined,
	definitions: SdkModelDefinition[] = [],
) {
	return mergeModelRegistries(buildBuiltinModelRegistry(repoRoot), definitions);
}

export const BUILTIN_MODEL_REGISTRY: SdkModelRegistry = buildBuiltinModelRegistry();
export const MODEL_REGISTRY: SdkModelRegistry = buildModelRegistry();

export function resolveModelDefinition(
	model: string,
	registry: SdkModelRegistry = MODEL_REGISTRY,
): SdkModelDefinition {
	const directMatch = registry[model];
	if (directMatch) {
		return directMatch;
	}

	const normalized = model.trim().toLowerCase();
	const aliasMatch = Object.values(registry).find(
		(definition) => definition.aliases.includes(normalized) || definition.name === normalized,
	);
	if (!aliasMatch) {
		throw new Error(`Unknown SDK model "${model}".`);
	}

	return aliasMatch;
}
