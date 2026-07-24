import type {
	SdkGraphEdge,
	SdkGraphEdgeType,
	SdkGraphNode,
	SdkGraphQueryRequest,
	SdkGraphQueryStage,
	SdkGraphRankingBuildInput,
	SdkGraphRankingDiagnostics,
	SdkGraphRankingIndex,
	SdkGraphRankingNodeResult,
	SdkGraphRankingProvider,
	SdkGraphRankingQueryRequest,
	SdkGraphRankingQueryResult,
	SdkGraphRankingSearchRequest,
	SdkGraphSearchResult,
} from '../../entrypoints/models/sdk-types.ts';
import { normalizeText } from '../schema.ts';


export type RankingField =
	| 'title'
	| 'headings'
	| 'tags'
	| 'ids'
	| 'summary'
	| 'body'
	| 'path'
	| 'references';

export type RankingDocument = {
	node: SdkGraphNode;
	scope: 'files' | 'sections' | 'entities';
	title: string;
	fieldTerms: Map<RankingField, Map<string, number>>;
	fieldLengths: Record<RankingField, number>;
	normalizedTitle: string;
	normalizedPath: string;
};

export type RankingEdgeTraversal = {
	neighborId: string;
	edgeId: string;
	edgeType: SdkGraphEdgeType;
	weight: number;
};

export type FieldConfig = {
	weight: number;
	b: number;
};

export const BM25F_FIELDS: Record<RankingField, FieldConfig> = {
	title: { weight: 4.8, b: 0.3 },
	headings: { weight: 3.6, b: 0.35 },
	tags: { weight: 2.8, b: 0.2 },
	ids: { weight: 4.2, b: 0.1 },
	summary: { weight: 2.2, b: 0.4 },
	body: { weight: 1.0, b: 0.8 },
	path: { weight: 1.2, b: 0.25 },
	references: { weight: 0.8, b: 0.15 },
};

export const DEFAULT_EDGE_WEIGHTS: Record<SdkGraphEdgeType, number> = {
	HAS_SECTION: 0.8,
	BELONGS_TO_FILE: 0.8,
	PARENT_SECTION: 2.2,
	CHILD_SECTION: 2.2,
	NEXT_SECTION: 0.6,
	PREV_SECTION: 0.6,
	LINKS_TO: 1.1,
	REFERENCES: 2.6,
	MENTIONS: 0.8,
	HAS_TAG: 0.4,
	IN_SERIES: 0.5,
	SAME_DIRECTORY: 0.4,
	SAME_COLLECTION: 0.4,
	DEFINES: 0.7,
	DEFINED_BY: 0.7,
	RELATES_TO: 0.9,
	DEPENDS_ON: 3.3,
	IMPLEMENTS: 3.1,
	EXTENDS: 2.0,
	SUPERSEDES: 0.7,
	BELONGS_TO: 1.3,
	ABOUT: 1.6,
	USED_BY: 1.3,
	GENERATED_FROM: 1.6,
};

export const TOKEN_REGEX = /[a-z0-9]+/gu;

export const BM25F_K1 = 1.2;

export const RWR_RESTART_PROBABILITY = 0.2;

export const RWR_ITERATIONS = 18;

export const MAX_SEED_COUNT = 12;

export function tokenize(value: string) {
	return normalizeText(value).match(TOKEN_REGEX) ?? [];
}

export function mapTermFrequencies(tokens: string[]) {
	const counts = new Map<string, number>();
	for (const token of tokens) {
		counts.set(token, (counts.get(token) ?? 0) + 1);
	}
	return counts;
}

export function nodeScope(node: SdkGraphNode): 'files' | 'sections' | 'entities' {
	if (node.nodeType === 'File') {
		return 'files';
	}
	if (node.nodeType === 'Section') {
		return 'sections';
	}
	return 'entities';
}

export function normalizeDateScore(updatedAt?: string | null) {
	if (!updatedAt) {
		return 0.35;
	}
	const parsed = Date.parse(updatedAt);
	if (Number.isNaN(parsed)) {
		return 0.35;
	}
	const ageDays = Math.max(0, (Date.now() - parsed) / (1000 * 60 * 60 * 24));
	if (ageDays <= 30) return 1;
	if (ageDays <= 90) return 0.8;
	if (ageDays <= 180) return 0.55;
	if (ageDays <= 365) return 0.35;
	return 0.15;
}

export function clamp01(value: number) {
	return Math.max(0, Math.min(1, value));
}

export function stagePreference(node: SdkGraphNode, stage: SdkGraphQueryStage | undefined) {
	const frontmatter = node.data?.frontmatter as Record<string, unknown> | undefined;
	const rawType = typeof frontmatter?.type === 'string' ? frontmatter.type : node.entityType ?? node.sourceModel ?? node.nodeType;
	const type = normalizeText(String(rawType ?? ''));
	const title = normalizeText(node.title ?? '');
	const isCanonical = node.canonical === true || normalizeText(node.status ?? '') === 'canonical';
	switch (stage) {
		case 'plan':
			return clamp01(
				(isCanonical ? 0.5 : 0)
				+ (['architecture', 'decision', 'objective', 'knowledge'].includes(type) ? 0.35 : 0)
				+ (['knowledge', 'objective', 'book'].includes(normalizeText(node.sourceModel ?? '')) ? 0.2 : 0),
			);
		case 'implement':
			return clamp01(
				(node.nodeType === 'Section' ? 0.25 : 0)
				+ (['api', 'schema', 'guide', 'example'].includes(type) ? 0.55 : 0)
				+ (title.includes('api') || title.includes('schema') || title.includes('example') ? 0.2 : 0),
			);
		case 'research':
			return clamp01(0.25 + (node.nodeType === 'File' ? 0.1 : 0));
		case 'debug':
			return clamp01(
				(['runbook', 'troubleshooting', 'guide'].includes(type) ? 0.55 : 0)
				+ (title.includes('debug') || title.includes('troubleshoot') ? 0.2 : 0)
				+ (node.nodeType === 'Section' ? 0.1 : 0),
			);
		case 'review':
			return clamp01(
				(isCanonical ? 0.45 : 0)
				+ (type === 'decision' ? 0.35 : 0)
				+ (normalizeText(node.status ?? '') === 'deprecated' ? -0.3 : 0),
			);
		default:
			return 0.2;
	}
}

export function canonicalityScore(node: SdkGraphNode, outgoing: Map<string, RankingEdgeTraversal[]>, incoming: Map<string, RankingEdgeTraversal[]>) {
	const status = normalizeText(node.status ?? '');
	const hasOutgoingSupersedes = (outgoing.get(node.id) ?? []).some((edge) => edge.edgeType === 'SUPERSEDES');
	const hasIncomingSupersedes = (incoming.get(node.id) ?? []).some((edge) => edge.edgeType === 'SUPERSEDES');
	let score =
		node.canonical === true || status === 'canonical'
			? 1
			: status === 'live' || status === 'in progress'
				? 0.6
				: status === 'deprecated'
					? 0.1
					: 0.35;
	if (hasOutgoingSupersedes) {
		score += 0.15;
	}
	if (hasIncomingSupersedes) {
		score -= 0.3;
	}
	return clamp01(score);
}

export function createRankingDocument(
	node: SdkGraphNode,
	sectionsByFileId: Map<string, SdkGraphNode[]>,
	outgoingEdgeTargets: Map<string, string[]>,
): RankingDocument {
	const frontmatter = node.data?.frontmatter as Record<string, unknown> | undefined;
	const summary = typeof frontmatter?.summary === 'string'
		? frontmatter.summary
		: typeof frontmatter?.description === 'string'
			? frontmatter.description
			: '';
	const relatedSectionTitles = node.nodeType === 'File'
		? (sectionsByFileId.get(node.id) ?? []).map((section) => `${section.heading ?? ''} ${section.headingPath ?? ''}`).join(' ')
		: node.nodeType === 'Section'
			? `${node.heading ?? ''} ${node.headingPath ?? ''}`
			: '';
	const ids = [
		node.id,
		node.entityId,
		node.fileId,
		node.slug,
		node.canonicalId,
		typeof node.data?.explicitId === 'string' ? node.data.explicitId : null,
	]
		.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
		.join(' ');
	const references = (outgoingEdgeTargets.get(node.id) ?? []).join(' ');
	const fields: Record<RankingField, string> = {
		title: node.title ?? node.id,
		headings: relatedSectionTitles,
		tags: (node.tags ?? []).join(' '),
		ids,
		summary,
		body: node.text ?? '',
		path: [node.path ?? '', node.sourceModel ?? '', node.slug ?? '', typeof node.data?.relativePath === 'string' ? node.data.relativePath : ''].join(' '),
		references,
	};
	const fieldTerms = new Map<RankingField, Map<string, number>>();
	const fieldLengths = {} as Record<RankingField, number>;
	for (const field of Object.keys(fields) as RankingField[]) {
		const tokens = tokenize(fields[field]);
		fieldTerms.set(field, mapTermFrequencies(tokens));
		fieldLengths[field] = tokens.length;
	}
	return {
		node,
		scope: nodeScope(node),
		title: node.title ?? node.id,
		fieldTerms,
		fieldLengths,
		normalizedTitle: normalizeText(node.title ?? node.id),
		normalizedPath: normalizeText(node.path ?? node.slug ?? node.id),
	};
}

export function matchesScope(document: RankingDocument, scope: SdkGraphRankingSearchRequest['scope']) {
	return scope === 'all' || document.scope === scope;
}
