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
} from '../../sdk-types.ts';
import type { GraphBuildState } from '../build.ts';
import { parseGraphDsl } from '../dsl.ts';
import { DEFAULT_GRAPH_RANKING_PROVIDER } from '../ranking.ts';
import { normalizeText } from '../schema.ts';


export function statefulIds(nodes: Iterable<SdkGraphNode>, predicate: (node: SdkGraphNode) => boolean) {
	const ids = new Set<string>();
	for (const node of nodes) {
		if (predicate(node)) {
			ids.add(node.id);
		}
	}
	return ids;
}
