import type {
	SdkContextPack,
	SdkContextPackRequest,
	SdkGraphDslRelation,
	SdkGraphQueryStage,
	SdkGraphQueryView,
} from '../sdk-types.ts';

export type DeclarativeContextQueryPurpose =
	| 'plan'
	| 'research'
	| 'generate'
	| 'optimize'
	| 'implement'
	| 'review'
	| 'release'
	| string;

export type DeclarativeContextQueryFormat =
	| 'summary'
	| 'full'
	| 'sources'
	| 'list'
	| 'brief'
	| 'map'
	| string;

export interface DeclarativeContextQuery {
	id: string;
	purpose: DeclarativeContextQueryPurpose;
	query: string;
	scope?: string;
	relations?: string[];
	depth?: number;
	budget?: number;
	format?: DeclarativeContextQueryFormat;
	filters?: Record<string, unknown>;
	required?: boolean;
}

export type HandlerContextPackSource =
	| 'agent_spec'
	| 'content_frontmatter'
	| 'work_package'
	| 'task_payload'
	| 'default_role_context';

export interface DeclarativeContextQuerySourceRef {
	source: HandlerContextPackSource;
	ref?: string;
	priority: number;
}

export interface CompiledDeclarativeContextQuery {
	query: DeclarativeContextQuery;
	request: SdkContextPackRequest;
	warnings: string[];
}

export interface DeclarativeContextQueryCompileResult {
	ok: boolean;
	compiled: CompiledDeclarativeContextQuery | null;
	errors: string[];
	warnings: string[];
}

export interface ResolvedHandlerContextPack {
	id: string;
	purpose: string;
	source: HandlerContextPackSource;
	sourceRef?: string;
	query: DeclarativeContextQuery;
	request: SdkContextPackRequest;
	pack: SdkContextPack;
	warnings: string[];
}

const VALID_RELATIONS: readonly SdkGraphDslRelation[] = [
	'related',
	'depends_on',
	'implements',
	'references',
	'parent',
	'child',
	'supersedes',
];

const PURPOSE_TO_STAGE: Partial<Record<string, SdkGraphQueryStage>> = {
	plan: 'plan',
	research: 'research',
	implement: 'implement',
	debug: 'debug',
	review: 'review',
};

const FORMAT_TO_VIEW: Partial<Record<string, SdkGraphQueryView>> = {
	summary: 'brief',
	brief: 'brief',
	full: 'full',
	sources: 'list',
	list: 'list',
	map: 'map',
};

function asPositiveInteger(value: unknown) {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function normalizeString(value: string) {
	return value.trim();
}

export function declarativeContextPurposeToGraphStage(purpose: string): SdkGraphQueryStage {
	return PURPOSE_TO_STAGE[purpose.trim().toLowerCase()] ?? 'plan';
}

export function declarativeContextFormatToGraphView(format: string | undefined): SdkGraphQueryView {
	return FORMAT_TO_VIEW[(format ?? 'summary').trim().toLowerCase()] ?? 'brief';
}

export function compileDeclarativeContextQuery(
	query: DeclarativeContextQuery,
	options: {
		defaultLimit?: number;
		maxDepth?: number;
	} = {},
): DeclarativeContextQueryCompileResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const maxDepth = options.maxDepth ?? 3;
	const defaultLimit = options.defaultLimit ?? 8;

	const id = normalizeString(query.id ?? '');
	if (!id) {
		errors.push('Context query id is required.');
	}
	const purpose = normalizeString(query.purpose ?? '');
	if (!purpose) {
		errors.push(`Context query "${id || '<unknown>'}" purpose is required.`);
	}
	const textQuery = normalizeString(query.query ?? '');
	if (!textQuery) {
		errors.push(`Context query "${id || '<unknown>'}" query is required.`);
	}

	const depth = query.depth ?? 1;
	if (!Number.isInteger(depth) || depth < 0 || depth > maxDepth) {
		errors.push(`Context query "${id || '<unknown>'}" depth must be an integer between 0 and ${maxDepth}.`);
	}

	if (query.budget !== undefined && !asPositiveInteger(query.budget)) {
		errors.push(`Context query "${id || '<unknown>'}" budget must be a positive integer.`);
	}

	const scope = query.scope === undefined ? undefined : normalizeString(query.scope);
	if (scope !== undefined && (!scope || !scope.startsWith('/'))) {
		errors.push(`Context query "${id || '<unknown>'}" scope must start with "/".`);
	}

	const relations = (query.relations ?? ['related', 'references']).map((entry) => entry.trim().toLowerCase());
	const invalidRelations = relations.filter((relation) => !VALID_RELATIONS.includes(relation as SdkGraphDslRelation));
	if (invalidRelations.length > 0) {
		errors.push(`Context query "${id || '<unknown>'}" has invalid relations: ${invalidRelations.join(', ')}.`);
	}
	const uniqueRelations = [...new Set(relations)] as SdkGraphDslRelation[];
	if (uniqueRelations.length !== relations.length) {
		warnings.push(`Context query "${id || '<unknown>'}" included duplicate relations; duplicates were removed.`);
	}

	const stage = declarativeContextPurposeToGraphStage(purpose);
	if (stage === 'plan' && !['plan', ''].includes(purpose.toLowerCase()) && !PURPOSE_TO_STAGE[purpose.toLowerCase()]) {
		warnings.push(`Context query "${id || '<unknown>'}" purpose "${purpose}" is not a graph stage; using "plan".`);
	}
	const view = declarativeContextFormatToGraphView(query.format);
	if (query.format && !FORMAT_TO_VIEW[query.format.trim().toLowerCase()]) {
		warnings.push(`Context query "${id || '<unknown>'}" format "${query.format}" is not a graph view; using "brief".`);
	}

	if (errors.length > 0) {
		return { ok: false, compiled: null, errors, warnings };
	}

	const request: SdkContextPackRequest = {
		query: textQuery,
		stage,
		relations: uniqueRelations,
		view,
		options: {
			depth,
			limit: defaultLimit,
			maxNodes: defaultLimit,
		},
	};
	if (scope) {
		request.scopePaths = [scope];
	}
	if (query.budget !== undefined) {
		request.budget = {
			maxTokens: query.budget,
		};
	}

	return {
		ok: true,
		compiled: {
			query: {
				...query,
				id,
				purpose,
				query: textQuery,
				scope,
				relations: uniqueRelations,
			},
			request,
			warnings,
		},
		errors: [],
		warnings,
	};
}
