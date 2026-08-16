import type {
SdkContextPack,
SdkContextPackRequest,
SdkGraphDslRelation,
SdkGraphQueryStage,
SdkGraphQueryView,
} from '../entrypoints/models/sdk-types.ts';

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
	revision?: number;
	maturity?: 'draft' | 'validated' | 'simulated' | 'proven';
	purpose: DeclarativeContextQueryPurpose;
	query: string;
	target?: { kind:'content'|'graph'|'code'|'mixed'; models?:string[]; paths?:string[] };
	scope?: string;
	codeScopes?: string[];
	relations?: string[];
	depth?: number;
	budget?: number;
	resultLimit?: number;
	contextBudget?: { maxItems:number; maxCharacters?:number };
	tokenBudget?: number;
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

export const VALID_RELATIONS: readonly SdkGraphDslRelation[] = [
	'related',
	'depends_on',
	'implements',
	'references',
	'parent',
	'child',
	'supersedes',
];

export const PURPOSE_TO_STAGE: Partial<Record<string, SdkGraphQueryStage>> = {
	plan: 'plan',
	research: 'research',
	implement: 'implement',
	debug: 'debug',
	review: 'review',
};

export const FORMAT_TO_VIEW: Partial<Record<string, SdkGraphQueryView>> = {
	summary: 'brief',
	brief: 'brief',
	full: 'full',
	sources: 'list',
	list: 'list',
	map: 'map',
};

const FORMAT_TO_CONTEXT_MODE = {
	summary:'brief',brief:'brief',full:'detailed',sources:'citations',list:'citations',map:'mixed',
} as const;

export function asPositiveInteger(value: unknown) {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function normalizeString(value: string) {
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
	if (query.resultLimit !== undefined && !asPositiveInteger(query.resultLimit)) errors.push(`Context query "${id || '<unknown>'}" resultLimit must be a positive integer.`);
	if (query.tokenBudget !== undefined && !asPositiveInteger(query.tokenBudget)) errors.push(`Context query "${id || '<unknown>'}" tokenBudget must be a positive integer.`);

	const scope = query.scope === undefined ? undefined : normalizeString(query.scope);
	if (scope !== undefined && (!scope || !scope.startsWith('/'))) {
		errors.push(`Context query "${id || '<unknown>'}" scope must start with "/".`);
	}
	const codeScopes = query.codeScopes === undefined
		? undefined
		: Array.isArray(query.codeScopes)
			? [...new Set(query.codeScopes.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean))]
			: [];
	if (query.codeScopes !== undefined && (!Array.isArray(query.codeScopes) || codeScopes.length === 0)) {
		errors.push(`Context query "${id || '<unknown>'}" codeScopes must be a non-empty array of strings.`);
	}
	const targetPaths = [...new Set((query.target?.paths ?? []).map((entry) => entry.trim()).filter(Boolean))];
	if (targetPaths.some((entry) => !entry.startsWith('/'))) {
		errors.push(`Context query "${id || '<unknown>'}" target paths must start with "/".`);
	}
	const targetModels = [...new Set((query.target?.models ?? []).map((entry) => entry.trim()).filter(Boolean))];
	const filterFields = new Set(['type','model','status','audience','directGroupId','effectiveGroupId','domain']);
	const where = Object.entries(query.filters ?? {}).flatMap(([field,value]) => {
		if (!filterFields.has(field)) {
			errors.push(`Context query "${id || '<unknown>'}" filter "${field}" is not supported by TreeDX graph queries.`);
			return [];
		}
		const values = Array.isArray(value) ? value : [value];
		if (!values.length || values.some((entry) => typeof entry !== 'string' || !entry.trim())) {
			errors.push(`Context query "${id || '<unknown>'}" filter "${field}" must be a string or non-empty string array.`);
			return [];
		}
		const normalized = values.map((entry) => String(entry).trim());
		return [{ field:field as 'type'|'model'|'status'|'audience'|'directGroupId'|'effectiveGroupId'|'domain',op:normalized.length === 1 ? 'eq' as const : 'in' as const,value:normalized.length === 1 ? normalized[0]! : normalized }];
	});
	if (targetModels.length && !Object.hasOwn(query.filters ?? {},'model')) {
		where.unshift({ field:'model',op:targetModels.length === 1 ? 'eq' : 'in',value:targetModels.length === 1 ? targetModels[0]! : targetModels });
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
		...(targetPaths.length ? { seeds:targetPaths.map((path,index) => ({ id:`target-path-${index + 1}`,kind:'path' as const,value:path,scope:'files' as const })) } : {}),
		scope:targetModels.length || query.target?.kind === 'content' ? 'files' : undefined,
		stage,
		relations: uniqueRelations,
		view,
		mode:FORMAT_TO_CONTEXT_MODE[(query.format ?? 'summary').trim().toLowerCase() as keyof typeof FORMAT_TO_CONTEXT_MODE] ?? 'brief',
		options: {
			depth,
			limit: query.resultLimit ?? defaultLimit,
			maxNodes: query.contextBudget?.maxItems ?? query.resultLimit ?? defaultLimit,
		},
	};
	const scopePaths = [...new Set([...(scope ? [scope] : []),...targetPaths])];
	if (scopePaths.length) request.scopePaths = scopePaths;
	if (where.length) request.where = where;
	if (query.tokenBudget !== undefined || query.budget !== undefined || query.contextBudget?.maxItems !== undefined || query.resultLimit !== undefined) {
		request.budget = {
			...(query.tokenBudget !== undefined || query.budget !== undefined ? { maxTokens:query.tokenBudget ?? query.budget! } : {}),
			maxNodes:query.contextBudget?.maxItems ?? query.resultLimit ?? defaultLimit,
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
				codeScopes,
				relations: uniqueRelations,
			},
			request,
			warnings,
		},
		errors: [],
		warnings,
	};
}
