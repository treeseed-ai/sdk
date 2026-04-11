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
} from '../sdk-types.ts';
import { normalizeText } from './schema.ts';

type RankingField =
	| 'title'
	| 'headings'
	| 'tags'
	| 'ids'
	| 'summary'
	| 'body'
	| 'path'
	| 'references';

type RankingDocument = {
	node: SdkGraphNode;
	scope: 'files' | 'sections' | 'entities';
	title: string;
	fieldTerms: Map<RankingField, Map<string, number>>;
	fieldLengths: Record<RankingField, number>;
	normalizedTitle: string;
	normalizedPath: string;
};

type RankingEdgeTraversal = {
	neighborId: string;
	edgeId: string;
	edgeType: SdkGraphEdgeType;
	weight: number;
};

type FieldConfig = {
	weight: number;
	b: number;
};

const BM25F_FIELDS: Record<RankingField, FieldConfig> = {
	title: { weight: 4.8, b: 0.3 },
	headings: { weight: 3.6, b: 0.35 },
	tags: { weight: 2.8, b: 0.2 },
	ids: { weight: 4.2, b: 0.1 },
	summary: { weight: 2.2, b: 0.4 },
	body: { weight: 1.0, b: 0.8 },
	path: { weight: 1.2, b: 0.25 },
	references: { weight: 0.8, b: 0.15 },
};

const DEFAULT_EDGE_WEIGHTS: Record<SdkGraphEdgeType, number> = {
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

const TOKEN_REGEX = /[a-z0-9]+/gu;
const BM25F_K1 = 1.2;
const RWR_RESTART_PROBABILITY = 0.2;
const RWR_ITERATIONS = 18;
const MAX_SEED_COUNT = 12;

function tokenize(value: string) {
	return normalizeText(value).match(TOKEN_REGEX) ?? [];
}

function mapTermFrequencies(tokens: string[]) {
	const counts = new Map<string, number>();
	for (const token of tokens) {
		counts.set(token, (counts.get(token) ?? 0) + 1);
	}
	return counts;
}

function nodeScope(node: SdkGraphNode): 'files' | 'sections' | 'entities' {
	if (node.nodeType === 'File') {
		return 'files';
	}
	if (node.nodeType === 'Section') {
		return 'sections';
	}
	return 'entities';
}

function normalizeDateScore(updatedAt?: string | null) {
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

function clamp01(value: number) {
	return Math.max(0, Math.min(1, value));
}

function stagePreference(node: SdkGraphNode, stage: SdkGraphQueryStage | undefined) {
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

function canonicalityScore(node: SdkGraphNode, outgoing: Map<string, RankingEdgeTraversal[]>, incoming: Map<string, RankingEdgeTraversal[]>) {
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

function createRankingDocument(
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

function matchesScope(document: RankingDocument, scope: SdkGraphRankingSearchRequest['scope']) {
	return scope === 'all' || document.scope === scope;
}

export function createDefaultGraphRankingProvider(): SdkGraphRankingProvider {
	return {
		id: 'default-bm25f-ppr',
		capabilities: ['bm25f', 'query-biased-ppr', 'diagnostics'],
		buildIndex(input: SdkGraphRankingBuildInput): SdkGraphRankingIndex {
			const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
			const edgesById = new Map(input.edges.map((edge) => [edge.id, edge]));
			const outgoing = new Map<string, RankingEdgeTraversal[]>();
			const incoming = new Map<string, RankingEdgeTraversal[]>();
			const sectionsByFileId = new Map<string, SdkGraphNode[]>();
			const outgoingEdgeTargets = new Map<string, string[]>();
			for (const node of input.nodes) {
				if (node.nodeType === 'Section' && node.fileId) {
					const sections = sectionsByFileId.get(node.fileId) ?? [];
					sections.push(node);
					sectionsByFileId.set(node.fileId, sections);
				}
			}
			for (const sections of sectionsByFileId.values()) {
				sections.sort((left, right) => Number(left.data?.ordinal ?? 0) - Number(right.data?.ordinal ?? 0));
			}
			for (const edge of input.edges) {
				const weight = DEFAULT_EDGE_WEIGHTS[edge.type] ?? 1;
				const sourceEdges = outgoing.get(edge.sourceId) ?? [];
				sourceEdges.push({ neighborId: edge.targetId, edgeId: edge.id, edgeType: edge.type, weight });
				outgoing.set(edge.sourceId, sourceEdges);
				const targetEdges = incoming.get(edge.targetId) ?? [];
				targetEdges.push({ neighborId: edge.sourceId, edgeId: edge.id, edgeType: edge.type, weight });
				incoming.set(edge.targetId, targetEdges);
				const targetNode = nodesById.get(edge.targetId);
				if (targetNode) {
					const references = outgoingEdgeTargets.get(edge.sourceId) ?? [];
					references.push(targetNode.slug ?? targetNode.title ?? targetNode.id);
					outgoingEdgeTargets.set(edge.sourceId, references);
				}
			}

			const documents = input.nodes
				.filter((node) => !['Tag', 'Series', 'Reference'].includes(node.nodeType))
				.map((node) => createRankingDocument(node, sectionsByFileId, outgoingEdgeTargets));

			const docsByScope = {
				files: documents.filter((doc) => doc.scope === 'files'),
				sections: documents.filter((doc) => doc.scope === 'sections'),
				entities: documents.filter((doc) => doc.scope === 'entities'),
				all: documents,
			} as const;

			const averageFieldLengths = {} as Record<RankingField, number>;
			for (const field of Object.keys(BM25F_FIELDS) as RankingField[]) {
				const total = documents.reduce((sum, document) => sum + document.fieldLengths[field], 0);
				averageFieldLengths[field] = documents.length > 0 ? Math.max(1, total / documents.length) : 1;
			}

			const documentFrequency = new Map<string, number>();
			for (const document of documents) {
				const seen = new Set<string>();
				for (const frequencies of document.fieldTerms.values()) {
					for (const term of frequencies.keys()) {
						seen.add(term);
					}
				}
				for (const term of seen) {
					documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
				}
			}

			function bm25fScore(document: RankingDocument, query: string) {
				const queryTerms = tokenize(query);
				if (queryTerms.length === 0) {
					return 0;
				}
				let score = 0;
				for (const term of queryTerms) {
					const matchingTerms = new Set<string>();
					for (const frequencies of document.fieldTerms.values()) {
						for (const candidate of frequencies.keys()) {
							if (candidate === term || candidate.startsWith(term)) {
								matchingTerms.add(candidate);
							}
						}
					}
					if (matchingTerms.size === 0) {
						continue;
					}
					let weightedTf = 0;
					let termDf = 0;
					for (const matched of matchingTerms) {
						termDf += documentFrequency.get(matched) ?? 0;
						for (const field of Object.keys(BM25F_FIELDS) as RankingField[]) {
							const tf = document.fieldTerms.get(field)?.get(matched) ?? 0;
							if (tf <= 0) {
								continue;
							}
							const { weight, b } = BM25F_FIELDS[field];
							const normalizedTf = tf / (1 - b + b * (document.fieldLengths[field] / averageFieldLengths[field]));
							weightedTf += weight * normalizedTf;
						}
					}
					if (weightedTf <= 0) {
						continue;
					}
					const idf = Math.log(1 + ((documents.length - termDf + 0.5) / (termDf + 0.5)));
					score += idf * (((BM25F_K1 + 1) * weightedTf) / (BM25F_K1 + weightedTf));
				}
				const normalizedQuery = normalizeText(query);
				if (normalizedQuery && document.normalizedTitle.includes(normalizedQuery)) {
					score += 2.5;
				}
				if (normalizedQuery && document.normalizedPath.includes(normalizedQuery)) {
					score += 1.25;
				}
				return score;
			}

			function search(request: SdkGraphRankingSearchRequest): SdkGraphSearchResult[] {
				const collection = docsByScope[request.scope];
				const scored = collection
					.map((document) => ({
						document,
						score: bm25fScore(document, request.query),
					}))
					.filter((entry) => request.query.trim().length === 0 || entry.score > 0)
					.sort((left, right) => right.score - left.score || left.document.title.localeCompare(right.document.title) || left.document.node.id.localeCompare(right.document.node.id))
					.slice(0, request.options?.limit ?? 20);
				return scored.map(({ document, score }) => ({
					node: document.node,
					score,
					reason: `bm25f:${document.scope}`,
					highlights: tokenize(request.query),
					context: document.node.nodeType === 'File'
						? { topSections: (sectionsByFileId.get(document.node.id) ?? []).slice(0, 3).map((section) => section.id) }
						: document.node.nodeType === 'Section'
							? { fileId: document.node.fileId ?? null }
							: { fileId: document.node.fileId ?? null },
				}));
			}

			function buildTraversals(request: SdkGraphRankingQueryRequest) {
				const allowedNodeIds = new Set(request.allowedNodeIds ?? documents.map((document) => document.node.id));
				const requestedWeights = request.request.options?.edgeWeights ?? {};
				const allowedEdgeTypes = request.allowedEdgeTypes?.length ? new Set(request.allowedEdgeTypes) : null;
				const direction = request.request.options?.direction ?? 'both';
				const depthLimit = request.request.options?.depth ?? 1;
				const seeds = request.seedIds.slice(0, MAX_SEED_COUNT);
				const queue = seeds.map((nodeId) => ({ nodeId, depth: 0, seedId: nodeId }));
				const distances = new Map<string, number>();
				const reasons = new Map<string, Set<string>>();
				const seedIdsByNode = new Map<string, Set<string>>();
				const viaEdgeTypes = new Map<string, Set<SdkGraphEdgeType>>();
				const traversedEdgeIds = new Set<string>();

				for (const seedId of seeds) {
					distances.set(seedId, 0);
					reasons.set(seedId, new Set(['seed']));
					seedIdsByNode.set(seedId, new Set([seedId]));
					viaEdgeTypes.set(seedId, new Set());
				}

				while (queue.length > 0) {
					const current = queue.shift()!;
					if (current.depth >= depthLimit) {
						continue;
					}
					const traversals: RankingEdgeTraversal[] = [];
					if (direction !== 'incoming') {
						traversals.push(...(outgoing.get(current.nodeId) ?? []).map((edge) => ({ ...edge, weight: requestedWeights[edge.edgeType] ?? edge.weight })));
					}
					if (direction !== 'outgoing') {
						traversals.push(...(incoming.get(current.nodeId) ?? []).map((edge) => ({ ...edge, weight: requestedWeights[edge.edgeType] ?? edge.weight })));
					}
					for (const traversal of traversals) {
						if (allowedEdgeTypes && !allowedEdgeTypes.has(traversal.edgeType)) {
							continue;
						}
						if (!allowedNodeIds.has(traversal.neighborId)) {
							continue;
						}
						traversedEdgeIds.add(traversal.edgeId);
						const nextDepth = current.depth + 1;
						const previousDepth = distances.get(traversal.neighborId);
						if (previousDepth === undefined || nextDepth < previousDepth) {
							distances.set(traversal.neighborId, nextDepth);
							queue.push({ nodeId: traversal.neighborId, depth: nextDepth, seedId: current.seedId });
						}
						const nodeReasons = reasons.get(traversal.neighborId) ?? new Set<string>();
						nodeReasons.add(`via:${traversal.edgeType}`);
						reasons.set(traversal.neighborId, nodeReasons);
						const nodeSeedIds = seedIdsByNode.get(traversal.neighborId) ?? new Set<string>();
						nodeSeedIds.add(current.seedId);
						seedIdsByNode.set(traversal.neighborId, nodeSeedIds);
						const nodeVia = viaEdgeTypes.get(traversal.neighborId) ?? new Set<SdkGraphEdgeType>();
						nodeVia.add(traversal.edgeType);
						viaEdgeTypes.set(traversal.neighborId, nodeVia);
					}
				}

				return { allowedNodeIds, distances, reasons, seedIdsByNode, viaEdgeTypes, traversedEdgeIds };
			}

			function runQueryBiasedPageRank(request: SdkGraphRankingQueryRequest, lexicalScores: Map<string, number>) {
				const traversal = buildTraversals(request);
				const frontierIds = [...traversal.distances.keys()];
				if (frontierIds.length === 0) {
					return { scores: new Map<string, number>(), traversal };
				}

				const seedWeights = new Map<string, number>();
				const fallbackWeight = request.seedMatches?.length ? request.seedMatches[0]!.score || 1 : 1;
				for (const seedId of request.seedIds.slice(0, MAX_SEED_COUNT)) {
					const lexical = lexicalScores.get(seedId) ?? request.seedMatches?.find((match) => match.node.id === seedId)?.score ?? fallbackWeight;
					seedWeights.set(seedId, Math.max(lexical, 0.0001));
				}
				const seedWeightSum = [...seedWeights.values()].reduce((sum, value) => sum + value, 0) || 1;
				const seedProbability = new Map([...seedWeights.entries()].map(([nodeId, value]) => [nodeId, value / seedWeightSum]));
				let current = new Map(frontierIds.map((nodeId) => [nodeId, seedProbability.get(nodeId) ?? 0]));
				const requestedWeights = request.request.options?.edgeWeights ?? {};
				const allowedEdgeTypes = request.allowedEdgeTypes?.length ? new Set(request.allowedEdgeTypes) : null;
				const direction = request.request.options?.direction ?? 'both';

				for (let iteration = 0; iteration < RWR_ITERATIONS; iteration += 1) {
					const next = new Map(frontierIds.map((nodeId) => [nodeId, RWR_RESTART_PROBABILITY * (seedProbability.get(nodeId) ?? 0)]));
					for (const nodeId of frontierIds) {
						const currentScore = current.get(nodeId) ?? 0;
						if (currentScore <= 0) {
							continue;
						}
						const traversals: RankingEdgeTraversal[] = [];
						if (direction !== 'incoming') {
							traversals.push(...(outgoing.get(nodeId) ?? []).map((edge) => ({ ...edge, weight: requestedWeights[edge.edgeType] ?? edge.weight })));
						}
						if (direction !== 'outgoing') {
							traversals.push(...(incoming.get(nodeId) ?? []).map((edge) => ({ ...edge, weight: requestedWeights[edge.edgeType] ?? edge.weight })));
						}
						const filtered = traversals.filter((edge) => frontierIds.includes(edge.neighborId) && (!allowedEdgeTypes || allowedEdgeTypes.has(edge.edgeType)));
						const weightSum = filtered.reduce((sum, edge) => sum + Math.max(edge.weight, 0.0001), 0);
						if (weightSum <= 0) {
							const restart = next.get(nodeId) ?? 0;
							next.set(nodeId, restart + ((1 - RWR_RESTART_PROBABILITY) * currentScore));
							continue;
						}
						for (const edge of filtered) {
							const share = ((1 - RWR_RESTART_PROBABILITY) * currentScore * Math.max(edge.weight, 0.0001)) / weightSum;
							next.set(edge.neighborId, (next.get(edge.neighborId) ?? 0) + share);
						}
					}
					current = next;
				}

				return { scores: current, traversal };
			}

			function rankQuery(request: SdkGraphRankingQueryRequest): SdkGraphRankingQueryResult {
				const eligibleIds = new Set(request.allowedNodeIds ?? documents.map((document) => document.node.id));
				const lexicalScores = new Map<string, number>();
				if (request.request.query?.trim()) {
					for (const document of documents) {
						if (!eligibleIds.has(document.node.id)) {
							continue;
						}
						const score = bm25fScore(document, request.request.query);
						if (score > 0) {
							lexicalScores.set(document.node.id, score);
						}
					}
				}
				for (const match of request.seedMatches ?? []) {
					if (eligibleIds.has(match.node.id)) {
						lexicalScores.set(match.node.id, Math.max(match.score, lexicalScores.get(match.node.id) ?? 0));
					}
				}
				for (const seedId of request.seedIds) {
					if (eligibleIds.has(seedId)) {
						lexicalScores.set(seedId, Math.max(lexicalScores.get(seedId) ?? 0, 1));
					}
				}
				const maxLexical = Math.max(1, ...lexicalScores.values());
				const { scores: graphScores, traversal } = runQueryBiasedPageRank(request, lexicalScores);
				const maxGraph = Math.max(1e-6, ...graphScores.values(), 0);
				const maxNodes = request.request.options?.maxNodes ?? request.request.options?.limit ?? 25;
				const ranked: SdkGraphRankingNodeResult[] = [...traversal.distances.entries()]
					.map(([nodeId, depth]) => {
						const node = nodesById.get(nodeId)!;
						const lexicalScore = clamp01((lexicalScores.get(nodeId) ?? 0) / maxLexical);
						const graphScore = clamp01((graphScores.get(nodeId) ?? 0) / maxGraph);
						const nodeCanonicality = canonicalityScore(node, outgoing, incoming);
						const freshnessScore = normalizeDateScore(node.updatedAt);
						const stageScore = stagePreference(node, request.request.stage);
						const priorScore = clamp01((0.5 * nodeCanonicality) + (0.2 * freshnessScore) + (0.3 * stageScore));
						const finalScore = (0.55 * lexicalScore) + (0.25 * graphScore) + (0.20 * priorScore);
						const diagnostics: SdkGraphRankingDiagnostics = {
							providerId: 'default-bm25f-ppr',
							lexicalScore,
							graphScore,
							priorScore,
							canonicalityScore: nodeCanonicality,
							freshnessScore,
							stageScore,
							finalScore,
						};
						return {
							nodeId,
							score: finalScore,
							depth,
							reasons: [...(traversal.reasons.get(nodeId) ?? new Set(['seed']))],
							seedIds: [...(traversal.seedIdsByNode.get(nodeId) ?? new Set(request.seedIds.includes(nodeId) ? [nodeId] : request.seedIds))],
							viaEdgeTypes: [...(traversal.viaEdgeTypes.get(nodeId) ?? new Set())],
							diagnostics,
						};
					})
					.filter((entry) => entry.score >= (request.request.options?.scoreThreshold ?? Number.NEGATIVE_INFINITY))
					.sort((left, right) => right.score - left.score || left.depth - right.depth || (nodesById.get(left.nodeId)?.title ?? left.nodeId).localeCompare(nodesById.get(right.nodeId)?.title ?? right.nodeId))
					.slice(0, maxNodes);

				return {
					providerId: 'default-bm25f-ppr',
					nodes: ranked,
					edgeIds: [...traversal.traversedEdgeIds],
					diagnostics: {
						seedCount: request.seedIds.length,
						frontierNodeCount: traversal.distances.size,
						maxLexicalScore: maxLexical,
						maxGraphScore: maxGraph,
					},
				};
			}

			return {
				search,
				rankQuery,
				serialize() {
					return {
						providerId: 'default-bm25f-ppr',
						documentCount: documents.length,
						scopeCounts: {
							files: docsByScope.files.length,
							sections: docsByScope.sections.length,
							entities: docsByScope.entities.length,
						},
					};
				},
			};
		},
	};
}

export const DEFAULT_GRAPH_RANKING_PROVIDER = createDefaultGraphRankingProvider();
