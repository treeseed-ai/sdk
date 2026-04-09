import path from 'node:path';
import { resolveSdkRepoRoot } from './runtime.ts';
import { validateModelFieldAliases } from './sdk-fields.ts';
import type {
	SdkBuiltinModelName,
	SdkModelFieldBinding,
	SdkModelDefinition,
	SdkModelName,
	SdkModelRegistry,
} from './sdk-types.ts';

function contentRoot(repoRoot?: string) {
	return process.env.TREESEED_AGENT_CONTENT_ROOT
		? path.resolve(process.env.TREESEED_AGENT_CONTENT_ROOT)
		: path.resolve(resolveSdkRepoRoot(repoRoot), 'src', 'content');
}

function field(
	key: string,
	options: Omit<SdkModelFieldBinding, 'key'> = {},
): SdkModelFieldBinding {
	return { key, ...options };
}

function deriveFieldLists(fields: Record<string, SdkModelFieldBinding>) {
	const entries = Object.entries(fields);
	return {
		filterableFields: entries.filter(([, binding]) => binding.filterable).map(([key]) => key),
		sortableFields: entries.filter(([, binding]) => binding.sortable).map(([key]) => key),
	};
}

export function buildBuiltinModelRegistry(repoRoot?: string): Record<SdkBuiltinModelName, SdkModelDefinition> {
	const root = contentRoot(repoRoot);

	return {
		page: {
			name: 'page',
			aliases: ['pages'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				title: field('title', { filterable: true, sortable: true, contentKeys: ['title'], writeContentKey: 'title' }),
				slug: field('slug', { filterable: true, contentKeys: ['slug'], writeContentKey: 'slug' }),
				status: field('status', { filterable: true, contentKeys: ['status'], writeContentKey: 'status' }),
				audience: field('audience', { filterable: true, comparableAs: 'string_array', contentKeys: ['audience'], writeContentKey: 'audience' }),
				updated_at: field('updated_at', { aliases: ['updated', 'updatedAt'], filterable: true, sortable: true, comparableAs: 'date', contentKeys: ['updated_at', 'updated', 'updatedAt'], writeContentKey: 'updated_at' }),
				created_at: field('created_at', { aliases: ['createdAt'], comparableAs: 'date', contentKeys: ['created_at', 'createdAt', 'date'], writeContentKey: 'created_at' }),
			},
			...deriveFieldLists({
				title: field('title', { filterable: true, sortable: true, contentKeys: ['title'], writeContentKey: 'title' }),
				slug: field('slug', { filterable: true, contentKeys: ['slug'], writeContentKey: 'slug' }),
				status: field('status', { filterable: true, contentKeys: ['status'], writeContentKey: 'status' }),
				audience: field('audience', { filterable: true, comparableAs: 'string_array', contentKeys: ['audience'], writeContentKey: 'audience' }),
				updated_at: field('updated_at', { aliases: ['updated', 'updatedAt'], filterable: true, sortable: true, comparableAs: 'date', contentKeys: ['updated_at', 'updated', 'updatedAt'], writeContentKey: 'updated_at' }),
				created_at: field('created_at', { aliases: ['createdAt'], comparableAs: 'date', contentKeys: ['created_at', 'createdAt', 'date'], writeContentKey: 'created_at' }),
			}),
			pickField: 'updated_at',
			contentCollection: 'pages',
			contentDir: path.join(root, 'pages'),
		},
		note: {
			name: 'note',
			aliases: ['notes'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				title: field('title', { filterable: true, sortable: true, contentKeys: ['title'], writeContentKey: 'title' }),
				status: field('status', { filterable: true, contentKeys: ['status'], writeContentKey: 'status' }),
				author: field('author', { filterable: true, contentKeys: ['author'], writeContentKey: 'author' }),
				tags: field('tags', { filterable: true, comparableAs: 'string_array', contentKeys: ['tags'], writeContentKey: 'tags' }),
				date: field('date', { filterable: true, sortable: true, comparableAs: 'date', contentKeys: ['date'], writeContentKey: 'date' }),
				updated_at: field('updated_at', { aliases: ['updated', 'updatedAt'], sortable: true, filterable: true, comparableAs: 'date', contentKeys: ['updated_at', 'updated', 'updatedAt'], writeContentKey: 'updated_at' }),
			},
			filterableFields: ['title', 'status', 'author', 'tags', 'date', 'updated_at'],
			sortableFields: ['title', 'date', 'updated_at'],
			pickField: 'date',
			contentCollection: 'notes',
			contentDir: path.join(root, 'notes'),
		},
		question: {
			name: 'question',
			aliases: ['questions'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				title: field('title', { filterable: true, sortable: true, contentKeys: ['title'], writeContentKey: 'title' }),
				status: field('status', { filterable: true, contentKeys: ['status'], writeContentKey: 'status' }),
				tags: field('tags', { filterable: true, comparableAs: 'string_array', contentKeys: ['tags'], writeContentKey: 'tags' }),
				date: field('date', { filterable: true, sortable: true, comparableAs: 'date', contentKeys: ['date'], writeContentKey: 'date' }),
				question_type: field('question_type', { aliases: ['questionType'], filterable: true, contentKeys: ['question_type', 'questionType'], writeContentKey: 'question_type' }),
				related_objectives: field('related_objectives', { aliases: ['relatedObjectives'], filterable: true, comparableAs: 'string_array', contentKeys: ['related_objectives', 'relatedObjectives'], writeContentKey: 'related_objectives' }),
				related_books: field('related_books', { aliases: ['relatedBooks'], filterable: true, comparableAs: 'string_array', contentKeys: ['related_books', 'relatedBooks'], writeContentKey: 'related_books' }),
				updated_at: field('updated_at', { aliases: ['updated', 'updatedAt'], sortable: true, comparableAs: 'date', contentKeys: ['updated_at', 'updated', 'updatedAt'], writeContentKey: 'updated_at' }),
			},
			filterableFields: ['title', 'status', 'tags', 'date', 'question_type', 'related_objectives', 'related_books'],
			sortableFields: ['title', 'date', 'updated_at'],
			pickField: 'date',
			contentCollection: 'questions',
			contentDir: path.join(root, 'questions'),
		},
		book: {
			name: 'book',
			aliases: ['books'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				title: field('title', { filterable: true, sortable: true, contentKeys: ['title'], writeContentKey: 'title' }),
				slug: field('slug', { filterable: true, contentKeys: ['slug'], writeContentKey: 'slug' }),
				tags: field('tags', { filterable: true, comparableAs: 'string_array', contentKeys: ['tags'], writeContentKey: 'tags' }),
				section_label: field('section_label', { aliases: ['sectionLabel'], filterable: true, contentKeys: ['section_label', 'sectionLabel'], writeContentKey: 'section_label' }),
				order: field('order', { sortable: true, comparableAs: 'number', contentKeys: ['order'], writeContentKey: 'order' }),
				updated_at: field('updated_at', { aliases: ['updated', 'updatedAt'], sortable: true, comparableAs: 'date', contentKeys: ['updated_at', 'updated', 'updatedAt'], writeContentKey: 'updated_at' }),
			},
			filterableFields: ['title', 'slug', 'tags', 'section_label'],
			sortableFields: ['title', 'order', 'updated_at'],
			pickField: 'order',
			contentCollection: 'books',
			contentDir: path.join(root, 'books'),
		},
		knowledge: {
			name: 'knowledge',
			aliases: ['knowledge-base', 'docs'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				title: field('title', { filterable: true, sortable: true, contentKeys: ['title'], writeContentKey: 'title' }),
				tags: field('tags', { filterable: true, comparableAs: 'string_array', contentKeys: ['tags'], writeContentKey: 'tags' }),
				updated_at: field('updated_at', { aliases: ['updated', 'updatedAt'], filterable: true, sortable: true, comparableAs: 'date', contentKeys: ['updated_at', 'updated', 'updatedAt'], writeContentKey: 'updated_at' }),
				slug: field('slug', { filterable: true, contentKeys: ['slug'], writeContentKey: 'slug' }),
			},
			filterableFields: ['title', 'tags', 'updated_at', 'slug'],
			sortableFields: ['title', 'updated_at'],
			pickField: 'updated_at',
			contentCollection: 'docs',
			contentDir: path.join(root, 'knowledge'),
		},
		objective: {
			name: 'objective',
			aliases: ['objectives'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				title: field('title', { filterable: true, sortable: true, contentKeys: ['title'], writeContentKey: 'title' }),
				status: field('status', { filterable: true, contentKeys: ['status'], writeContentKey: 'status' }),
				tags: field('tags', { filterable: true, comparableAs: 'string_array', contentKeys: ['tags'], writeContentKey: 'tags' }),
				date: field('date', { filterable: true, sortable: true, comparableAs: 'date', contentKeys: ['date'], writeContentKey: 'date' }),
				time_horizon: field('time_horizon', { aliases: ['timeHorizon'], filterable: true, contentKeys: ['time_horizon', 'timeHorizon'], writeContentKey: 'time_horizon' }),
				related_questions: field('related_questions', { aliases: ['relatedQuestions'], filterable: true, comparableAs: 'string_array', contentKeys: ['related_questions', 'relatedQuestions'], writeContentKey: 'related_questions' }),
				related_books: field('related_books', { aliases: ['relatedBooks'], filterable: true, comparableAs: 'string_array', contentKeys: ['related_books', 'relatedBooks'], writeContentKey: 'related_books' }),
				updated_at: field('updated_at', { aliases: ['updated', 'updatedAt'], sortable: true, comparableAs: 'date', contentKeys: ['updated_at', 'updated', 'updatedAt'], writeContentKey: 'updated_at' }),
			},
			filterableFields: ['title', 'status', 'tags', 'date', 'time_horizon', 'related_questions', 'related_books'],
			sortableFields: ['title', 'date', 'updated_at'],
			pickField: 'date',
			contentCollection: 'objectives',
			contentDir: path.join(root, 'objectives'),
		},
		person: {
			name: 'person',
			aliases: ['people', 'persons'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				name: field('name', { filterable: true, sortable: true, contentKeys: ['name'], writeContentKey: 'name' }),
				role: field('role', { filterable: true, contentKeys: ['role'], writeContentKey: 'role' }),
				affiliation: field('affiliation', { filterable: true, contentKeys: ['affiliation'], writeContentKey: 'affiliation' }),
				status: field('status', { filterable: true, contentKeys: ['status'], writeContentKey: 'status' }),
				tags: field('tags', { filterable: true, comparableAs: 'string_array', contentKeys: ['tags'], writeContentKey: 'tags' }),
				updated_at: field('updated_at', { aliases: ['updated', 'updatedAt'], sortable: true, comparableAs: 'date', contentKeys: ['updated_at', 'updated', 'updatedAt'], writeContentKey: 'updated_at' }),
			},
			filterableFields: ['name', 'role', 'affiliation', 'status', 'tags'],
			sortableFields: ['name', 'updated_at'],
			pickField: 'updated_at',
			contentCollection: 'people',
			contentDir: path.join(root, 'people'),
		},
		subscription: {
			name: 'subscription',
			aliases: ['subscriptions', 'subscriber', 'subscribers'],
			storage: 'd1',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				email: field('email', { filterable: true, sortable: true, dbColumns: ['email', 'lookup_key'], writeDbColumn: 'email' }),
				status: field('status', { filterable: true, dbColumns: ['status'], writeDbColumn: 'status' }),
				source: field('source', { filterable: true, dbColumns: ['source'], payloadPaths: ['$.source'], writeDbColumn: 'source' }),
				created_at: field('created_at', { aliases: ['createdAt'], filterable: true, sortable: true, comparableAs: 'date', dbColumns: ['created_at'], writeDbColumn: 'created_at' }),
				updated_at: field('updated_at', { aliases: ['updatedAt'], filterable: true, sortable: true, comparableAs: 'date', dbColumns: ['updated_at'], writeDbColumn: 'updated_at' }),
			},
			filterableFields: ['email', 'status', 'source', 'created_at', 'updated_at'],
			sortableFields: ['email', 'created_at', 'updated_at'],
			pickField: 'updated_at',
		},
		message: {
			name: 'message',
			aliases: ['messages'],
			storage: 'd1',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				type: field('type', { filterable: true, dbColumns: ['type', 'message_type'], writeDbColumn: 'type' }),
				status: field('status', { filterable: true, dbColumns: ['status'], writeDbColumn: 'status' }),
				related_model: field('related_model', { aliases: ['relatedModel'], filterable: true, dbColumns: ['related_model'], writeDbColumn: 'related_model' }),
				related_id: field('related_id', { aliases: ['relatedId'], filterable: true, dbColumns: ['related_id'], writeDbColumn: 'related_id' }),
				priority: field('priority', { filterable: true, sortable: true, comparableAs: 'number', dbColumns: ['priority'], writeDbColumn: 'priority' }),
				available_at: field('available_at', { aliases: ['availableAt'], filterable: true, sortable: true, comparableAs: 'date', dbColumns: ['available_at'], writeDbColumn: 'available_at' }),
				created_at: field('created_at', { aliases: ['createdAt'], sortable: true, comparableAs: 'date', dbColumns: ['created_at'], writeDbColumn: 'created_at' }),
				updated_at: field('updated_at', { aliases: ['updatedAt'], sortable: true, comparableAs: 'date', dbColumns: ['updated_at'], writeDbColumn: 'updated_at' }),
			},
			filterableFields: ['type', 'status', 'related_model', 'related_id', 'priority', 'available_at'],
			sortableFields: ['priority', 'available_at', 'created_at', 'updated_at'],
			pickField: 'available_at',
		},
		agent: {
			name: 'agent',
			aliases: ['agents'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				name: field('name', { sortable: true, contentKeys: ['name'], writeContentKey: 'name' }),
				slug: field('slug', { filterable: true, sortable: true, contentKeys: ['slug'], writeContentKey: 'slug' }),
				runtime_status: field('runtime_status', { aliases: ['runtimeStatus'], filterable: true, contentKeys: ['runtime_status', 'runtimeStatus'], writeContentKey: 'runtime_status' }),
				tags: field('tags', { filterable: true, comparableAs: 'string_array', contentKeys: ['tags'], writeContentKey: 'tags' }),
				operator: field('operator', { filterable: true, contentKeys: ['operator'], writeContentKey: 'operator' }),
				updated_at: field('updated_at', { aliases: ['updated', 'updatedAt'], sortable: true, comparableAs: 'date', contentKeys: ['updated_at', 'updated', 'updatedAt'], writeContentKey: 'updated_at' }),
				enabled: field('enabled', { aliases: ['is_enabled'], filterable: true, comparableAs: 'boolean', contentKeys: ['enabled', 'is_enabled'], writeContentKey: 'enabled' }),
			},
			filterableFields: ['slug', 'runtime_status', 'tags', 'operator', 'enabled'],
			sortableFields: ['name', 'slug', 'updated_at'],
			pickField: 'updated_at',
			contentCollection: 'agents',
			contentDir: path.join(root, 'agents'),
		},
		agent_run: {
			name: 'agent_run',
			aliases: ['agent_runs', 'run', 'runs'],
			storage: 'd1',
			operations: ['get', 'read', 'search', 'follow', 'create', 'update'],
			fields: {
				run_id: field('run_id', { aliases: ['runId'], filterable: true, dbColumns: ['run_id', 'record_key'], writeDbColumn: 'run_id' }),
				agent_slug: field('agent_slug', { aliases: ['agentSlug'], filterable: true, dbColumns: ['agent_slug', 'lookup_key'], writeDbColumn: 'agent_slug' }),
				status: field('status', { filterable: true, dbColumns: ['status'], writeDbColumn: 'status' }),
				started_at: field('started_at', { aliases: ['startedAt'], filterable: true, sortable: true, comparableAs: 'date', dbColumns: ['started_at', 'created_at'], writeDbColumn: 'started_at' }),
				finished_at: field('finished_at', { aliases: ['finishedAt'], filterable: true, sortable: true, comparableAs: 'date', dbColumns: ['finished_at'], payloadPaths: ['$.finishedAt'], writeDbColumn: 'finished_at' }),
			},
			filterableFields: ['run_id', 'agent_slug', 'status', 'started_at', 'finished_at'],
			sortableFields: ['started_at', 'finished_at'],
			pickField: 'started_at',
		},
		agent_cursor: {
			name: 'agent_cursor',
			aliases: ['agent_cursors', 'cursor', 'cursors'],
			storage: 'd1',
			operations: ['get', 'read', 'search', 'follow', 'create', 'update'],
			fields: {
				agent_slug: field('agent_slug', { aliases: ['agentSlug'], filterable: true, sortable: true, dbColumns: ['agent_slug'], writeDbColumn: 'agent_slug' }),
				cursor_key: field('cursor_key', { aliases: ['cursorKey'], filterable: true, sortable: true, dbColumns: ['cursor_key'], writeDbColumn: 'cursor_key' }),
				cursor_value: field('cursor_value', { aliases: ['cursorValue'], filterable: true, dbColumns: ['cursor_value'], payloadPaths: ['$.cursorValue'], writeDbColumn: 'cursor_value' }),
				updated_at: field('updated_at', { aliases: ['updatedAt'], filterable: true, sortable: true, comparableAs: 'date', dbColumns: ['updated_at'], writeDbColumn: 'updated_at' }),
			},
			filterableFields: ['agent_slug', 'cursor_key', 'cursor_value', 'updated_at'],
			sortableFields: ['updated_at', 'agent_slug', 'cursor_key'],
			pickField: 'updated_at',
		},
		content_lease: {
			name: 'content_lease',
			aliases: ['content_leases', 'lease', 'leases'],
			storage: 'd1',
			operations: ['get', 'read', 'search', 'follow', 'create', 'update'],
			fields: {
				model: field('model', { filterable: true, dbColumns: ['model'], writeDbColumn: 'model' }),
				item_key: field('item_key', { aliases: ['itemKey'], filterable: true, dbColumns: ['item_key'], writeDbColumn: 'item_key' }),
				claimed_by: field('claimed_by', { aliases: ['claimedBy'], filterable: true, dbColumns: ['claimed_by'], writeDbColumn: 'claimed_by' }),
				claimed_at: field('claimed_at', { aliases: ['claimedAt'], sortable: true, comparableAs: 'date', dbColumns: ['claimed_at'], writeDbColumn: 'claimed_at' }),
				lease_expires_at: field('lease_expires_at', { aliases: ['leaseExpiresAt'], filterable: true, sortable: true, comparableAs: 'date', dbColumns: ['lease_expires_at'], writeDbColumn: 'lease_expires_at' }),
			},
			filterableFields: ['model', 'item_key', 'claimed_by', 'lease_expires_at'],
			sortableFields: ['lease_expires_at', 'claimed_at'],
			pickField: 'lease_expires_at',
		},
	};
}

function normalizeDefinition(definition: SdkModelDefinition): SdkModelDefinition {
	const normalizedFields = Object.fromEntries(
		Object.entries(definition.fields ?? {}).map(([canonicalKey, binding]) => [
			canonicalKey,
			{
				...binding,
				key: canonicalKey,
				aliases: [...new Set((binding.aliases ?? []).map((alias) => alias.trim().toLowerCase()).filter(Boolean))],
				contentKeys: [...new Set(binding.contentKeys ?? [])],
				dbColumns: [...new Set(binding.dbColumns ?? [])],
				payloadPaths: [...new Set(binding.payloadPaths ?? [])],
			},
		]),
	);

	const normalized = {
		...definition,
		name: definition.name.trim() as SdkModelName,
		aliases: [...new Set((definition.aliases ?? []).map((alias) => alias.trim().toLowerCase()).filter(Boolean))],
		fields: normalizedFields,
		filterableFields: [...new Set(definition.filterableFields ?? Object.entries(normalizedFields).filter(([, binding]) => binding.filterable).map(([key]) => key))],
		sortableFields: [...new Set(definition.sortableFields ?? Object.entries(normalizedFields).filter(([, binding]) => binding.sortable).map(([key]) => key))],
	};
	validateModelFieldAliases(normalized);
	return normalized;
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
