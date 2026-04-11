import crypto from 'node:crypto';
import path from 'node:path';
import type {
	SdkGraphEdge,
	SdkGraphEdgeType,
	SdkGraphModelConfig,
	SdkGraphNode,
	SdkGraphNodeType,
	SdkModelDefinition,
	SdkModelRegistry,
} from '../sdk-types.ts';

export const GRAPH_SNAPSHOT_VERSION = 1;

export const AUTHORED_GRAPH_EDGE_TYPES = [
	'REFERENCES',
	'HAS_TAG',
	'IN_SERIES',
	'RELATES_TO',
	'DEPENDS_ON',
	'IMPLEMENTS',
	'EXTENDS',
	'SUPERSEDES',
	'BELONGS_TO',
	'ABOUT',
	'USED_BY',
	'GENERATED_FROM',
] as const satisfies SdkGraphEdgeType[];

export type AuthoredGraphEdgeType = (typeof AUTHORED_GRAPH_EDGE_TYPES)[number];

export type GraphFileCatalogEntry = {
	path: string;
	relativePath: string;
	model: string;
	slug: string;
	fileId: string;
	hash: string;
};

export type ParsedGraphLink = {
	url: string;
	text: string;
	startOffset: number;
	endOffset: number;
};

export type ParsedGraphHeading = {
	text: string;
	slug: string;
	level: number;
	startOffset: number;
	endOffset: number;
};

export type ParsedGraphSection = {
	id: string;
	fileId: string;
	heading: string | null;
	headingSlug: string;
	headingPath: string;
	level: number;
	ordinal: number;
	startOffset: number;
	endOffset: number;
	rawText: string;
	normalizedText: string;
	outboundLinks: ParsedGraphLink[];
	referencedEntityIds: string[];
};

export type ParsedGraphDocument = {
	fileId: string;
	entityId: string;
	model: string;
	entityType: string;
	slug: string;
	title: string;
	path: string;
	relativePath: string;
	dirname: string;
	body: string;
	normalizedBody: string;
	frontmatter: Record<string, unknown>;
	explicitId: string | null;
	tags: string[];
	series: string | null;
	status: string | null;
	canonical: boolean;
	canonicalRef: string | null;
	version: string | null;
	domain: string | null;
	audience: string[];
	updatedAt: string | null;
	sections: ParsedGraphSection[];
	headings: ParsedGraphHeading[];
	links: ParsedGraphLink[];
	mdxImports: string[];
	explicitReferences: Array<{
		field: string;
		value: string;
		targetModels?: string[];
		edgeType: AuthoredGraphEdgeType;
	}>;
};

export type GraphValidation = {
	missingIds: string[];
	duplicateIds: string[];
	brokenReferences: Array<{ ownerFileId: string; value: string; edgeType: SdkGraphEdgeType }>;
	invalidEdgeTypes: Array<{ ownerFileId: string; field: string; edgeType: string }>;
	invalidCanonicalRefs: Array<{ ownerFileId: string; value: string }>;
	invalidSupersedesRefs: Array<{ ownerFileId: string; value: string }>;
};

export type GraphMetrics = {
	totalFiles: number;
	totalSections: number;
	totalEntities: number;
	totalEdges: number;
	unresolvedReferences: number;
	validation: {
		missingIds: number;
		duplicateIds: number;
		brokenReferences: number;
		invalidEdgeTypes: number;
		invalidCanonicalRefs: number;
		invalidSupersedesRefs: number;
	};
	queryCounts: Record<string, number>;
	topTraversedEdgeTypes: Record<string, number>;
	lastRefreshAt: string | null;
};

export type GraphDelta = {
	added: string[];
	modified: string[];
	removed: string[];
};

export type GraphSnapshot = {
	version: number;
	modelSignature: string;
	documents: ParsedGraphDocument[];
	nodes: SdkGraphNode[];
	edges: SdkGraphEdge[];
	catalog: GraphFileCatalogEntry[];
	metrics: GraphMetrics;
	validation: GraphValidation;
	delta: GraphDelta;
};

export function sha1(value: string) {
	return crypto.createHash('sha1').update(value).digest('hex');
}

export function computeEdgeId(sourceId: string, edgeType: SdkGraphEdgeType, targetId: string, provenance = '') {
	return `edge:${sha1(`${sourceId}|${edgeType}|${targetId}|${provenance}`)}`;
}

export function createFileNodeId(model: string, slug: string) {
	return `file:${model}:${slug}`;
}

export function createEntityNodeId(definition: SdkModelDefinition, slug: string, frontmatter: Record<string, unknown>) {
	const explicitId = typeof frontmatter.id === 'string' && frontmatter.id.trim() ? frontmatter.id.trim() : null;
	return explicitId ?? `entity:${definition.name}:${slug}`;
}

export function normalizeText(value: string) {
	return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function ensureArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
			.filter(Boolean);
	}
	if (typeof value === 'string' && value.trim()) {
		return [value.trim()];
	}
	return [];
}

export function builtinEntityTypeFor(model: string): SdkGraphNodeType {
	switch (model) {
		case 'agent':
			return 'Agent';
		case 'objective':
			return 'Objective';
		case 'question':
			return 'Question';
		case 'note':
			return 'Note';
		case 'knowledge':
			return 'Knowledge';
		case 'book':
			return 'Book';
		case 'page':
			return 'Page';
		case 'person':
			return 'Person';
		default:
			return 'Entity';
	}
}

export function resolveGraphModelConfig(definition: SdkModelDefinition): Required<SdkGraphModelConfig> {
	return {
		entityType: definition.graph?.entityType ?? builtinEntityTypeFor(definition.name),
		referenceFields: definition.graph?.referenceFields ?? [],
		tagField: definition.graph?.tagField ?? (definition.fields.tags ? 'tags' : ''),
		seriesField: definition.graph?.seriesField ?? '',
		titleField:
			definition.graph?.titleField
			?? (definition.fields.title ? 'title' : definition.fields.name ? 'name' : 'title'),
		enableSections: definition.graph?.enableSections ?? true,
	};
}

export function computeModelSignature(models: SdkModelRegistry) {
	const contentModels = Object.values(models)
		.filter((definition) => definition.storage === 'content' && definition.contentDir)
		.map((definition) => ({
			name: definition.name,
			contentDir: definition.contentDir,
			contentCollection: definition.contentCollection ?? null,
			fields: Object.keys(definition.fields).sort(),
			graph: resolveGraphModelConfig(definition),
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
	return sha1(JSON.stringify(contentModels));
}

export function graphSnapshotRoot(repoRoot: string) {
	return path.join(repoRoot, '.treeseed', 'state', 'graph');
}

export function emptyGraphMetrics(): GraphMetrics {
	return {
		totalFiles: 0,
		totalSections: 0,
		totalEntities: 0,
		totalEdges: 0,
		unresolvedReferences: 0,
		validation: {
			missingIds: 0,
			duplicateIds: 0,
			brokenReferences: 0,
			invalidEdgeTypes: 0,
			invalidCanonicalRefs: 0,
			invalidSupersedesRefs: 0,
		},
		queryCounts: {},
		topTraversedEdgeTypes: {},
		lastRefreshAt: null,
	};
}

export function emptyGraphValidation(): GraphValidation {
	return {
		missingIds: [],
		duplicateIds: [],
		brokenReferences: [],
		invalidEdgeTypes: [],
		invalidCanonicalRefs: [],
		invalidSupersedesRefs: [],
	};
}
