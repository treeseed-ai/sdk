import path from 'node:path';
import type {
	SdkContextPack,
	SdkContextPackRequest,
	SdkGraphDslRelation,
	SdkGraphEdge,
	SdkGraphEdgeType,
	SdkGraphNode,
	SdkGraphQueryOptions,
	SdkGraphQueryRequest,
	SdkGraphQueryResult,
	SdkGraphQueryView,
	SdkGraphPathExplanation,
	SdkGraphRankingProvider,
	SdkGraphSearchOptions,
	SdkGraphSearchResult,
	SdkGraphSeed,
	SdkGraphSeedResolution,
	SdkGraphTraversalResult,
	SdkGraphWhereFilter,
} from '../../entrypoints/models/sdk-types.ts';
import type { GraphBuildState } from '../build.ts';
import { parseGraphDsl } from '../dsl.ts';
import { DEFAULT_GRAPH_RANKING_PROVIDER } from '../ranking.ts';
import { normalizeText } from '../schema.ts';


export const RELATION_TO_EDGE_TYPE: Record<SdkGraphDslRelation, SdkGraphEdgeType> = {
	related: 'RELATES_TO',
	depends_on: 'DEPENDS_ON',
	implements: 'IMPLEMENTS',
	references: 'REFERENCES',
	parent: 'PARENT_SECTION',
	child: 'CHILD_SECTION',
	supersedes: 'SUPERSEDES',
};

export function matchesNodeOptions(node: SdkGraphNode | undefined, options?: SdkGraphQueryOptions) {
	if (!node) {
		return false;
	}
	if (options?.models?.length && (!node.sourceModel || !options.models.includes(node.sourceModel))) {
		return false;
	}
	if (options?.nodeTypes?.length && !options.nodeTypes.includes(node.nodeType)) {
		return false;
	}
	return true;
}

export function dedupeResults(results: SdkGraphSearchResult[]) {
	return [...new Map(results.map((result) => [result.node.id, result])).values()];
}

export function tokenEstimate(text: string) {
	return Math.max(1, Math.ceil(text.trim().length / 4));
}

export function normalizeScopePath(value: string) {
	return value.replace(/\\/gu, '/').replace(/\/+/gu, '/').replace(/\/$/u, '') || '/';
}

export function stripExt(value: string) {
	return value.replace(/\.(md|mdx)$/iu, '');
}

export function nodeContentPath(node: SdkGraphNode) {
	const relativePath = typeof node.data?.relativePath === 'string'
		? node.data.relativePath.replace(/\.(md|mdx)$/iu, '')
		: typeof node.slug === 'string'
			? node.slug.replace(/#.*$/u, '')
			: '';
	const modelPrefix = node.sourceModel ? `/${node.sourceModel}` : '';
	if (!relativePath && modelPrefix) {
		return modelPrefix;
	}
	return normalizeScopePath(`${modelPrefix}/${relativePath}`);
}

export function nodeMatchesScope(node: SdkGraphNode, scopePaths?: string[]) {
	if (!scopePaths?.length) {
		return true;
	}
	const contentPath = nodeContentPath(node);
	return scopePaths.some((scopePath) => contentPath === normalizeScopePath(scopePath) || contentPath.startsWith(`${normalizeScopePath(scopePath)}/`));
}

export function nodeMetadataType(node: SdkGraphNode) {
	const frontmatter = node.data?.frontmatter as Record<string, unknown> | undefined;
	const frontmatterType = typeof frontmatter?.type === 'string' ? frontmatter.type : null;
	return normalizeText(frontmatterType ?? node.entityType ?? node.sourceModel ?? node.nodeType);
}

export function nodeMatchesWhere(node: SdkGraphNode, filters?: SdkGraphWhereFilter[]) {
	if (!filters?.length) {
		return true;
	}
	return filters.every((filter) => {
		const values =
			filter.field === 'type'
				? [nodeMetadataType(node)]
				: filter.field === 'status'
					? [normalizeText(node.status ?? '')]
					: filter.field === 'audience'
						? (node.audience ?? []).map(normalizeText)
						: filter.field === 'tag'
							? (node.tags ?? []).map(normalizeText)
							: filter.field === 'domain'
								? [normalizeText(node.domain ?? '')]
								: [];
		const expected = Array.isArray(filter.value) ? filter.value.map(normalizeText) : [normalizeText(filter.value)];
		return filter.op === 'eq'
			? expected.some((entry) => values.includes(entry))
			: expected.every((entry) => values.includes(entry));
	});
}

export function excerptForView(node: SdkGraphNode, view: SdkGraphQueryView) {
	const text = node.text ?? '';
	switch (view) {
		case 'list':
			return '';
		case 'map':
			return `${node.title ?? node.id}`;
		case 'brief':
			return text.slice(0, 480).trim();
		case 'full':
		default:
			return text;
	}
}
