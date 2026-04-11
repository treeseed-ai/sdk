import type {
	SdkContextPackRequest,
	SdkGraphDslParseResult,
	SdkGraphDslRelation,
	SdkGraphQueryStage,
	SdkGraphQueryView,
	SdkGraphSeed,
	SdkGraphWhereFilter,
} from '../sdk-types.ts';

const CLAUSE_KEYWORDS = new Set(['for', 'in', 'via', 'depth', 'where', 'limit', 'budget', 'as']);
const VALID_STAGES: SdkGraphQueryStage[] = ['plan', 'implement', 'research', 'debug', 'review'];
const VALID_VIEWS: SdkGraphQueryView[] = ['list', 'brief', 'full', 'map'];
const VALID_RELATIONS: SdkGraphDslRelation[] = ['related', 'depends_on', 'implements', 'references', 'parent', 'child', 'supersedes'];
const VALID_WHERE_FIELDS = new Set(['type', 'status', 'audience', 'tag', 'domain']);

function tokenize(source: string) {
	const tokens: string[] = [];
	let current = '';
	let quote: '"' | "'" | null = null;

	for (let index = 0; index < source.length; index += 1) {
		const char = source[index]!;
		if (quote) {
			if (char === quote) {
				tokens.push(current);
				current = '';
				quote = null;
			} else {
				current += char;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			if (current.trim()) {
				tokens.push(current.trim());
				current = '';
			}
			quote = char;
			continue;
		}
		if (/\s/u.test(char)) {
			if (current.trim()) {
				tokens.push(current.trim());
				current = '';
			}
			continue;
		}
		current += char;
	}

	if (quote) {
		return { tokens, error: 'Unterminated quoted string in ctx query.' };
	}
	if (current.trim()) {
		tokens.push(current.trim());
	}
	return { tokens, error: null };
}

function nextClauseIndex(tokens: string[], start: number) {
	for (let index = start; index < tokens.length; index += 1) {
		if (CLAUSE_KEYWORDS.has(tokens[index]!)) {
			return index;
		}
	}
	return tokens.length;
}

function nextClauseIndexForClause(tokens: string[], start: number, clause: string) {
	for (let index = start; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		if (!CLAUSE_KEYWORDS.has(token)) {
			continue;
		}
		if (clause === 'where' && token === 'in') {
			continue;
		}
		return index;
	}
	return tokens.length;
}

function parseTarget(rawTarget: string): SdkGraphSeed {
	if (rawTarget.startsWith('@')) {
		return { id: 'seed:0', kind: 'id', value: rawTarget.slice(1) };
	}
	if (rawTarget.startsWith('/')) {
		return { id: 'seed:0', kind: 'path', value: rawTarget };
	}
	if (rawTarget.startsWith('#')) {
		return { id: 'seed:0', kind: 'tag', value: rawTarget.slice(1) };
	}
	if (rawTarget.startsWith('%')) {
		return { id: 'seed:0', kind: 'type', value: rawTarget.slice(1) };
	}
	return { id: 'seed:0', kind: 'query', value: rawTarget };
}

function parseWhere(expression: string): SdkGraphWhereFilter[] | { error: string } {
	const equality = expression.match(/^\s*([a-z_]+)\s*=\s*([^)]+?)\s*$/iu);
	if (equality) {
		const field = equality[1]!.toLowerCase();
		if (!VALID_WHERE_FIELDS.has(field)) {
			return { error: `Unsupported where field "${field}".` };
		}
		return [{ field: field as SdkGraphWhereFilter['field'], op: 'eq', value: equality[2]!.trim() }];
	}

	const membership = expression.match(/^\s*([a-z_]+)\s+in\s*\(([^)]*)\)\s*$/iu);
	if (membership) {
		const field = membership[1]!.toLowerCase();
		if (!VALID_WHERE_FIELDS.has(field)) {
			return { error: `Unsupported where field "${field}".` };
		}
		const values = membership[2]!
			.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean);
		if (values.length === 0) {
			return { error: 'where in (...) must include at least one value.' };
		}
		return [{ field: field as SdkGraphWhereFilter['field'], op: 'in', value: values }];
	}

	return { error: `Invalid where clause "${expression}".` };
}

export function parseGraphDsl(source: string): SdkGraphDslParseResult {
	const errors: string[] = [];
	const request: SdkContextPackRequest = {
		stage: 'plan',
		relations: ['related', 'references'],
		view: 'brief',
		options: {
			depth: 1,
			limit: 8,
			maxNodes: 8,
		},
	};
	const budget: NonNullable<SdkContextPackRequest['budget']> = {};
	const seenClauses = new Set<string>();
	const tokenized = tokenize(source.trim());
	if (tokenized.error) {
		return { ok: false, query: null, errors: [tokenized.error] };
	}

	const { tokens } = tokenized;
	if (tokens.length === 0) {
		return { ok: false, query: null, errors: ['ctx query is empty.'] };
	}
	if (tokens[0] !== 'ctx') {
		return { ok: false, query: null, errors: ['ctx query must start with the `ctx` command.'] };
	}

	const firstClause = nextClauseIndex(tokens, 1);
	const targetTokens = tokens.slice(1, firstClause);
	if (targetTokens.length === 0) {
		return { ok: false, query: null, errors: ['ctx query must include a target.'] };
	}
	request.seeds = [parseTarget(targetTokens.join(' '))];

	for (let index = firstClause; index < tokens.length;) {
		const clause = tokens[index]!;
		if (!CLAUSE_KEYWORDS.has(clause)) {
			errors.push(`Unexpected token "${clause}".`);
			index += 1;
			continue;
		}
		if (seenClauses.has(clause)) {
			errors.push(`Clause "${clause}" may only appear once.`);
		}
		seenClauses.add(clause);
		const valueStart = index + 1;
		const valueEnd = nextClauseIndexForClause(tokens, valueStart, clause);
		const rawValue = tokens.slice(valueStart, valueEnd).join(' ').trim();
		if (!rawValue) {
			errors.push(`Clause "${clause}" requires a value.`);
			index = valueEnd;
			continue;
		}

		switch (clause) {
			case 'for':
				if (!VALID_STAGES.includes(rawValue as SdkGraphQueryStage)) {
					errors.push(`Invalid stage "${rawValue}".`);
				} else {
					request.stage = rawValue as SdkGraphQueryStage;
				}
				break;
			case 'in': {
				const scopePaths = rawValue
					.split('+')
					.map((entry) => entry.trim())
					.filter(Boolean);
				if (scopePaths.length === 0 || scopePaths.some((entry) => !entry.startsWith('/'))) {
					errors.push(`Invalid scope path list "${rawValue}".`);
				} else {
					request.scopePaths = scopePaths;
				}
				break;
			}
			case 'via': {
				const relations = rawValue
					.split(',')
					.map((entry) => entry.trim().toLowerCase())
					.filter(Boolean) as SdkGraphDslRelation[];
				const invalid = relations.filter((entry) => !VALID_RELATIONS.includes(entry));
				if (invalid.length > 0) {
					errors.push(`Invalid relations: ${invalid.join(', ')}`);
				} else {
					request.relations = relations;
				}
				break;
			}
			case 'depth': {
				const depth = Number(rawValue);
				if (!Number.isInteger(depth) || depth < 0 || depth > 3) {
					errors.push(`Depth must be an integer between 0 and 3, received "${rawValue}".`);
				} else {
					request.options = { ...(request.options ?? {}), depth };
				}
				break;
			}
			case 'where': {
				const parsed = parseWhere(rawValue);
				if ('error' in parsed) {
					errors.push(parsed.error);
				} else {
					request.where = parsed;
				}
				break;
			}
			case 'limit': {
				const limit = Number(rawValue);
				if (!Number.isInteger(limit) || limit <= 0) {
					errors.push(`Limit must be a positive integer, received "${rawValue}".`);
				} else {
					request.options = { ...(request.options ?? {}), limit, maxNodes: limit };
					budget.maxNodes = limit;
				}
				break;
			}
			case 'budget': {
				const maxTokens = Number(rawValue);
				if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
					errors.push(`Budget must be a positive integer, received "${rawValue}".`);
				} else {
					budget.maxTokens = maxTokens;
				}
				break;
			}
			case 'as':
				if (!VALID_VIEWS.includes(rawValue as SdkGraphQueryView)) {
					errors.push(`Invalid view "${rawValue}".`);
				} else {
					request.view = rawValue as SdkGraphQueryView;
				}
				break;
			default:
				errors.push(`Unknown clause "${clause}".`);
		}

		index = valueEnd;
	}

	if (Object.keys(budget).length > 0) {
		request.budget = budget;
	}

	return {
		ok: errors.length === 0,
		query: errors.length === 0 ? request : null,
		errors,
	};
}
