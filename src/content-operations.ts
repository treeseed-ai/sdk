import { serializeFrontmatterDocument, parseFrontmatterDocument } from './frontmatter.ts';
import { buildBuiltinModelRegistry, resolveModelDefinition } from './model-registry.ts';
import { canonicalizeFrontmatter, normalizeMutationData } from './sdk-fields.ts';
import type { SdkModelDefinition, SdkModelRegistry } from './sdk-types.ts';

export type TreeseedContentAction =
	| 'describe'
	| 'query'
	| 'read'
	| 'create'
	| 'update'
	| 'link'
	| 'validate'
	| 'commit';

export type TreeseedContentModel =
	| 'page'
	| 'note'
	| 'question'
	| 'proposal'
	| 'decision'
	| 'book'
	| 'knowledge'
	| 'objective'
	| 'person'
	| 'agent';

export interface TreeseedContentRelationInput {
	field: string;
	targetModel?: TreeseedContentModel | string;
	targetSlug: string;
}

export interface TreeseedContentPlacement {
	bookSlug?: string;
	parentPath?: string;
	path?: string;
}

export interface TreeseedContentOperationInput {
	action: TreeseedContentAction;
	model?: TreeseedContentModel | string;
	id?: string;
	slug?: string;
	title?: string;
	fields?: Record<string, unknown>;
	body?: string;
	query?: string;
	filters?: unknown[];
	relations?: TreeseedContentRelationInput[];
	placement?: TreeseedContentPlacement;
	commit?: {
		enabled: boolean;
		message?: string;
	};
}

export interface TreeseedContentRef {
	model: TreeseedContentModel;
	collection: string;
	slug: string;
	id?: string;
	path?: string;
	href?: string;
	subjectId?: string;
	subjectField?: string;
}

export interface TreeseedContentDiagnostic {
	severity: 'info' | 'warning' | 'error';
	code: string;
	message: string;
	field?: string;
}

export interface TreeseedContentOperationResult {
	ok: true;
	action: TreeseedContentAction;
	refs: TreeseedContentRef[];
	changedPaths?: string[];
	diagnostics: TreeseedContentDiagnostic[];
	payload?: Record<string, unknown>;
}

export interface RenderTreeseedContentInput {
	model: TreeseedContentModel | string;
	slug?: string;
	title?: string;
	fields?: Record<string, unknown>;
	body?: string;
	relations?: TreeseedContentRelationInput[];
	placement?: TreeseedContentPlacement;
	contentRoot?: string;
	existingFrontmatter?: Record<string, unknown>;
	existingContent?: string;
	registry?: SdkModelRegistry;
	now?: string;
}

export interface RenderedTreeseedContentRecord {
	model: TreeseedContentModel;
	collection: string;
	slug: string;
	path: string;
	frontmatter: Record<string, unknown>;
	body: string;
	content: string;
	ref: TreeseedContentRef;
	diagnostics: TreeseedContentDiagnostic[];
}

export interface TreeseedContentToolPreset {
	id: string;
	action: TreeseedContentAction;
	model?: TreeseedContentModel;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

const CONTENT_MODELS = new Set<TreeseedContentModel>([
	'page',
	'note',
	'question',
	'proposal',
	'decision',
	'book',
	'knowledge',
	'objective',
	'person',
	'agent',
]);

export const TREESEED_CONTENT_ACTIONS: TreeseedContentAction[] = [
	'describe',
	'query',
	'read',
	'create',
	'update',
	'link',
	'validate',
	'commit',
];

export const TREESEED_CONTENT_READ_ACTIONS = new Set<TreeseedContentAction>(['describe', 'query', 'read']);
export const TREESEED_CONTENT_WRITE_ACTIONS = new Set<TreeseedContentAction>(['create', 'update', 'link', 'validate']);

export function slugifyTreeseedContent(value: unknown) {
	return String(value ?? '')
		.toLowerCase()
		.trim()
		.replace(/['"]/gu, '')
		.replace(/[^a-z0-9/_-]+/gu, '-')
		.replace(/\/+/gu, '/')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 160);
}

function titleCase(value: string) {
	return value.replace(/_/gu, ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function collectionFor(definition: SdkModelDefinition) {
	return definition.contentCollection ?? `${definition.name}s`;
}

function toolNamespaceFor(definition: SdkModelDefinition) {
	if (definition.name === 'knowledge') return 'knowledge';
	return collectionFor(definition);
}

function extensionFor(model: string) {
	return model === 'knowledge' ? 'md' : 'mdx';
}

function normalizedContentRoot(value?: string) {
	const root = String(value ?? 'src/content').replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
	if (!root || root.startsWith('/') || root.split('/').includes('..')) {
		throw new Error('contentRoot must be a safe repository-relative path.');
	}
	return root;
}

function contentPathFor(definition: SdkModelDefinition, slug: string, placement?: TreeseedContentPlacement, contentRoot?: string) {
	const collection = collectionFor(definition);
	const ext = extensionFor(definition.name);
	const root = normalizedContentRoot(contentRoot);
	if (placement?.path) {
		const safePath = slugifyTreeseedContent(placement.path).replace(/\.(md|mdx)$/iu, '');
		if (!safePath) throw new Error('placement.path must resolve to a safe content path.');
		return `${root}/${collection}/${safePath}.${ext}`;
	}
	if (definition.name === 'knowledge' && placement?.parentPath) {
		const parent = slugifyTreeseedContent(placement.parentPath).replace(/\/$/u, '');
		return `${root}/${collection}/${parent ? `${parent}/` : ''}${slug}.${ext}`;
	}
	return `${root}/${collection}/${slug}.${ext}`;
}

function normalizeContentModel(model: string, registry: SdkModelRegistry = buildBuiltinModelRegistry()) {
	const definition = resolveModelDefinition(model, registry);
	if (definition.storage !== 'content' || !definition.contentCollection) {
		throw new Error(`Model "${model}" is not a content-backed TreeSeed model.`);
	}
	if (!CONTENT_MODELS.has(definition.name as TreeseedContentModel)) {
		throw new Error(`Model "${model}" is not supported by TreeSeed content tools.`);
	}
	return definition as SdkModelDefinition & { name: TreeseedContentModel };
}

function defaultTitleField(definition: SdkModelDefinition) {
	if (definition.fields.title) return 'title';
	if (definition.fields.name) return 'name';
	return 'title';
}

function frontmatterId(definition: SdkModelDefinition, slug: string) {
	return `${definition.name}:${slug}`;
}

export function renderTreeseedContentRecord(input: RenderTreeseedContentInput): RenderedTreeseedContentRecord {
	const definition = normalizeContentModel(String(input.model), input.registry);
	const existingDocument = typeof input.existingContent === 'string'
		? parseFrontmatterDocument(input.existingContent)
		: null;
	const existingFrontmatter = {
		...(existingDocument?.frontmatter ?? {}),
		...(input.existingFrontmatter ?? {}),
	};
	const rawTitle = input.title
		?? input.fields?.title
		?? input.fields?.name
		?? existingFrontmatter.title
		?? existingFrontmatter.name;
	const slug = slugifyTreeseedContent(input.slug ?? rawTitle ?? input.id);
	if (!slug) throw new Error('A title or safe slug is required.');
	const now = input.now ?? new Date().toISOString();
	const titleField = defaultTitleField(definition);
	const rawFields = {
		...(rawTitle ? { [titleField]: rawTitle } : {}),
		...(input.fields ?? {}),
		...(definition.fields.slug ? { slug } : {}),
		...(definition.fields.updated_at ? { updated_at: input.fields?.updated_at ?? input.fields?.updatedAt ?? now } : {}),
	};
	const modelFieldNames = new Set([
		...Object.keys(definition.fields),
		...Object.values(definition.fields).flatMap((binding) => [
			...(binding.aliases ?? []),
			...(binding.contentKeys ?? []),
		]),
	]);
	const fields = normalizeMutationData(
		definition,
		Object.fromEntries(Object.entries(rawFields).filter(([key]) => modelFieldNames.has(key))),
	);
	const frontmatter = canonicalizeFrontmatter(definition, existingFrontmatter, fields);
	frontmatter.id = input.id ?? (typeof frontmatter.id === 'string' && frontmatter.id.trim() ? frontmatter.id : frontmatterId(definition, slug));
	if (!frontmatter.slug && definition.fields.slug) frontmatter.slug = slug;
	for (const relation of input.relations ?? []) {
		if (!relation.field || !relation.targetSlug) continue;
		const key = relation.field;
		const current = frontmatter[key];
		const next = Array.isArray(current) ? current.map(String) : typeof current === 'string' && current ? [current] : [];
		frontmatter[key] = [...new Set([...next, relation.targetSlug])];
	}
	const body = String(input.body ?? existingDocument?.body ?? '').trim();
	const collection = collectionFor(definition);
	const recordPath = contentPathFor(definition, slug, input.placement, input.contentRoot);
	const subjectFields = [
		'about',
		'relatedObjectives', 'related_objectives',
		'relatedQuestions', 'related_questions',
		'relatedProposals', 'related_proposals',
		'relatedDecisions', 'related_decisions',
	];
	const subjectEntry = subjectFields.flatMap((field) => {
		const value = frontmatter[field];
		const candidate = Array.isArray(value) ? value[0] : value;
		return typeof candidate === 'string' && candidate.trim() ? [{ field, id: candidate.trim() }] : [];
	})[0];
	const ref: TreeseedContentRef = {
		model: definition.name,
		collection,
		slug,
		id: typeof frontmatter.id === 'string' ? frontmatter.id : undefined,
		path: recordPath,
		href: `/app/work/${collection}/${encodeURIComponent(slug)}`,
		...(subjectEntry ? { subjectId: subjectEntry.id, subjectField: subjectEntry.field } : {}),
	};
	return {
		model: definition.name,
		collection,
		slug,
		path: recordPath,
		frontmatter,
		body,
		content: serializeFrontmatterDocument(frontmatter, body ? `\n${body}\n` : '\n'),
		ref,
		diagnostics: [],
	};
}

export function validateTreeseedContentRecord(model: string, source: string, registry: SdkModelRegistry = buildBuiltinModelRegistry()) {
	const definition = normalizeContentModel(model, registry);
	const parsed = parseFrontmatterDocument(source);
	const diagnostics: TreeseedContentDiagnostic[] = [];
	if (!parsed.frontmatter || typeof parsed.frontmatter !== 'object' || Array.isArray(parsed.frontmatter)) {
		diagnostics.push({ severity: 'error', code: 'frontmatter_missing', message: 'Content frontmatter must be an object.' });
	}
	const titleField = defaultTitleField(definition);
	const titleKeys = [titleField, ...(definition.fields[titleField]?.contentKeys ?? [])];
	if (!titleKeys.some((key) => typeof parsed.frontmatter[key] === 'string' && String(parsed.frontmatter[key]).trim())) {
		diagnostics.push({ severity: 'error', code: 'title_missing', field: titleField, message: `${titleCase(titleField)} is required.` });
	}
	return {
		ok: diagnostics.every((entry) => entry.severity !== 'error'),
		frontmatter: parsed.frontmatter,
		body: parsed.body,
		diagnostics,
	};
}

const GENERIC_MODEL_SCHEMA = { type: 'string' };
const STRING_ARRAY_SCHEMA = { type: 'array', items: { type: 'string' } };

export function genericTreeseedContentInputSchema(action: TreeseedContentAction): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		model: GENERIC_MODEL_SCHEMA,
		id: { type: 'string' },
		slug: { type: 'string' },
		title: { type: 'string' },
		fields: { type: 'object', additionalProperties: true },
		body: { type: 'string' },
		query: { type: 'string' },
		filters: { type: 'array', items: { type: 'object', additionalProperties: true } },
		relations: {
			type: 'array',
			minItems: action === 'link' ? 1 : 0,
			items: {
				type: 'object',
				properties: { field: { type: 'string', minLength: 1 }, targetModel: { type: 'string' }, targetSlug: { type: 'string', minLength: 1 } },
				required: ['field', 'targetSlug'],
				additionalProperties: false,
			},
		},
		placement: { type: 'object', additionalProperties: true },
		message: { type: 'string' },
	};
	const required = action === 'commit'
		? ['message']
		: action === 'query'
			? ['model']
			: action === 'describe'
				? []
				: action === 'link' ? ['model', 'relations'] : ['model'];
	return {
		type: 'object',
		properties,
		required,
		additionalProperties: false,
	};
}

function presetSchema(action: TreeseedContentAction, model: TreeseedContentModel): Record<string, unknown> {
	const base = genericTreeseedContentInputSchema(action);
	const properties = { ...base.properties as Record<string, unknown> };
	delete properties.model;
	if (action === 'query') {
		return { ...base, properties, required: [] };
	}
	if (action === 'read') {
		return { ...base, properties, required: [] };
	}
	if (action === 'commit') {
		return { ...base, properties: { message: { type: 'string' } }, required: ['message'] };
	}
	const required = model === 'person' || model === 'agent' ? [] : ['title'];
	return {
		...base,
		properties: {
			...properties,
			tags: STRING_ARRAY_SCHEMA,
		},
		required,
	};
}

export function createTreeseedContentToolPresets(registry: SdkModelRegistry = buildBuiltinModelRegistry()): TreeseedContentToolPreset[] {
	const presets: TreeseedContentToolPreset[] = [];
	for (const definition of Object.values(registry)) {
		if (definition.storage !== 'content' || !definition.contentCollection || !CONTENT_MODELS.has(definition.name as TreeseedContentModel)) continue;
		const model = definition.name as TreeseedContentModel;
		const plural = toolNamespaceFor(definition);
		for (const action of ['query', 'read', 'create', 'update'] as const) {
			if (!definition.operations.includes(action === 'query' ? 'search' : action)) continue;
			presets.push({
				id: `treeseed.${plural}.${action}`,
				action,
				model,
				title: `${titleCase(plural)} ${action}`,
				description: `${titleCase(action)} ${plural} through the TreeSeed model-aware content runtime.`,
				inputSchema: presetSchema(action, model),
			});
		}
	}
	presets.push({
		id: 'treeseed.books.add_knowledge',
		action: 'create',
		model: 'knowledge',
		title: 'Add knowledge to book',
		description: 'Create a knowledge page in a book or knowledge directory tree through TreeSeed content validation.',
		inputSchema: presetSchema('create', 'knowledge'),
	});
	presets.push({
		id: 'treeseed.content.link_note',
		action: 'link',
		model: 'note',
		title: 'Link note',
		description: 'Attach a note to another TreeSeed content record using validated relation fields.',
		inputSchema: genericTreeseedContentInputSchema('link'),
	});
	return presets;
}

export function findTreeseedContentToolPreset(id: string, registry?: SdkModelRegistry) {
	return createTreeseedContentToolPresets(registry).find((preset) => preset.id === id) ?? null;
}
