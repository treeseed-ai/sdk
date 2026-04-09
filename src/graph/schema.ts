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
	tags: string[];
	series: string | null;
	sections: ParsedGraphSection[];
	headings: ParsedGraphHeading[];
	links: ParsedGraphLink[];
	mdxImports: string[];
	explicitReferences: Array<{
		field: string;
		value: string;
		targetModels?: string[];
		edgeType: Extract<SdkGraphEdgeType, 'REFERENCES' | 'HAS_TAG' | 'IN_SERIES'>;
	}>;
};

export type GraphMetrics = {
	totalFiles: number;
	totalSections: number;
	totalEntities: number;
	totalEdges: number;
	unresolvedReferences: number;
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
		queryCounts: {},
		topTraversedEdgeTypes: {},
		lastRefreshAt: null,
	};
}
