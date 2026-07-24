import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import GithubSlugger from 'github-slugger';
import { toString } from 'mdast-util-to-string';
import { unified } from 'unified';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { parseFrontmatterDocument } from '../../content/frontmatter.ts';
import { resolveModelDefinition } from '../../entrypoints/models/model-registry.ts';
import { readCanonicalFieldValue } from '../../entrypoints/models/sdk-fields.ts';
import type { SdkGraphEdge, SdkGraphNode, SdkModelDefinition, SdkModelRegistry } from '../../entrypoints/models/sdk-types.ts';
import {
	AUTHORED_GRAPH_EDGE_TYPES,
	computeEdgeId,
	computeModelSignature,
	createEntityNodeId,
	createFileNodeId,
	emptyGraphMetrics,
	emptyGraphValidation,
	ensureArray,
	graphSnapshotRoot,
	normalizeText,
	resolveGraphModelConfig,
	type AuthoredGraphEdgeType,
	type GraphDelta,
	type GraphFileCatalogEntry,
	type GraphMetrics,
	type GraphSnapshot,
	type GraphValidation,
	type ParsedGraphDocument,
	type ParsedGraphHeading,
	type ParsedGraphLink,
	type ParsedGraphSection,
	GRAPH_SNAPSHOT_VERSION,
	sha1,
} from '../schema.ts';
import { GraphBuildState, walkMarkdownFiles } from './md-node.ts';
import { catalogForDocument, parseGraphDocument } from './parse-graph-document.ts';
import { buildGraphFromDocuments } from './build-graph-from-documents.ts';

export async function readSnapshotFile<T>(filePath: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(filePath, 'utf8')) as T;
	} catch {
		return null;
	}
}

export async function loadGraphSnapshot(repoRoot: string, models: SdkModelRegistry): Promise<GraphBuildState | null> {
	const snapshotRoot = graphSnapshotRoot(repoRoot);
	const graph = await readSnapshotFile<Pick<GraphSnapshot, 'version' | 'modelSignature' | 'documents' | 'nodes' | 'edges' | 'validation'>>(
		path.join(snapshotRoot, 'graph.json'),
	);
	const catalog = await readSnapshotFile<Pick<GraphSnapshot, 'catalog'>>(path.join(snapshotRoot, 'catalog.json'));
	const metrics = await readSnapshotFile<GraphMetrics>(path.join(snapshotRoot, 'metrics.json'));
	const delta = await readSnapshotFile<GraphDelta>(path.join(snapshotRoot, 'deltas.json'));
	const currentSignature = computeModelSignature(models);

	if (!graph || graph.version !== GRAPH_SNAPSHOT_VERSION || graph.modelSignature !== currentSignature || !catalog) {
		return null;
	}

	return {
		modelSignature: graph.modelSignature,
		documents: graph.documents,
		nodes: graph.nodes,
		edges: graph.edges,
		catalog: catalog.catalog,
		metrics: metrics ?? emptyGraphMetrics(),
		validation: graph.validation ?? emptyGraphValidation(),
		delta: delta ?? { added: [], modified: [], removed: [] },
		snapshotRoot,
	};
}

export async function saveGraphSnapshot(state: GraphBuildState) {
	await mkdir(state.snapshotRoot, { recursive: true });
	const graphPayload: Pick<GraphSnapshot, 'version' | 'modelSignature' | 'documents' | 'nodes' | 'edges' | 'validation'> = {
		version: GRAPH_SNAPSHOT_VERSION,
		modelSignature: state.modelSignature,
		documents: state.documents,
		nodes: state.nodes,
		edges: state.edges,
		validation: state.validation,
	};
	await Promise.all([
		writeFile(path.join(state.snapshotRoot, 'graph.json'), `${JSON.stringify(graphPayload, null, 2)}\n`, 'utf8'),
		writeFile(path.join(state.snapshotRoot, 'catalog.json'), `${JSON.stringify({ catalog: state.catalog }, null, 2)}\n`, 'utf8'),
		writeFile(path.join(state.snapshotRoot, 'metrics.json'), `${JSON.stringify(state.metrics, null, 2)}\n`, 'utf8'),
		writeFile(path.join(state.snapshotRoot, 'deltas.json'), `${JSON.stringify(state.delta, null, 2)}\n`, 'utf8'),
		writeFile(
			path.join(state.snapshotRoot, 'indexes.json'),
			`${JSON.stringify({ files: [], sections: [], entities: [] }, null, 2)}\n`,
			'utf8',
		),
	]);
}

export async function hashFile(filePath: string) {
	const source = await readFile(filePath, 'utf8');
	return {
		source,
		hash: sha1(source),
	};
}

export function contentDefinitions(models: SdkModelRegistry) {
	return Object.values(models)
		.filter((definition): definition is SdkModelDefinition & { contentDir: string } => definition.storage === 'content' && Boolean(definition.contentDir))
		.sort((left, right) => left.name.localeCompare(right.name));
}

export async function refreshGraphBuildState(
	repoRoot: string,
	models: SdkModelRegistry,
	request?: { paths?: string[] },
	priorState?: GraphBuildState | null,
): Promise<GraphBuildState> {
	const snapshotRoot = graphSnapshotRoot(repoRoot);
	const modelSignature = computeModelSignature(models);
	const priorDocuments = new Map((priorState?.documents ?? []).map((document) => [document.fileId, document]));
	const priorCatalog = new Map((priorState?.catalog ?? []).map((entry) => [path.resolve(entry.path), entry]));
	const nextDocuments = new Map(priorDocuments);
	const nextCatalog = new Map(priorCatalog);
	const requestedPaths = request?.paths?.map((entry) => path.resolve(repoRoot, entry)).filter(Boolean);

	const changed: GraphDelta = { added: [], modified: [], removed: [] };
	const trackedPaths = new Set<string>();
	const definitions = contentDefinitions(models);

	if (requestedPaths && requestedPaths.length > 0) {
		for (const requestedPath of requestedPaths) {
			const matchingDefinition = definitions.find((definition) => requestedPath.startsWith(path.resolve(definition.contentDir)));
			if (!matchingDefinition) {
				continue;
			}
			trackedPaths.add(requestedPath);
			try {
				const fileStats = await stat(requestedPath);
				if (!fileStats.isFile()) continue;
				const { source, hash } = await hashFile(requestedPath);
				const parsed = parseGraphDocument(matchingDefinition, requestedPath, source);
				const existing = priorCatalog.get(requestedPath);
				nextDocuments.set(parsed.fileId, parsed);
				nextCatalog.set(requestedPath, catalogForDocument(parsed, hash));
				if (!existing) {
					changed.added.push(parsed.fileId);
				} else if (existing.hash !== hash) {
					changed.modified.push(parsed.fileId);
				}
			} catch {
				const existing = priorCatalog.get(requestedPath);
				if (existing) {
					changed.removed.push(existing.fileId);
					nextCatalog.delete(requestedPath);
					nextDocuments.delete(existing.fileId);
				}
			}
		}
	} else {
		for (const definition of definitions) {
			const files = await walkMarkdownFiles(definition.contentDir);
			for (const filePath of files) {
				const resolvedPath = path.resolve(filePath);
				trackedPaths.add(resolvedPath);
				const { source, hash } = await hashFile(resolvedPath);
				const parsed = parseGraphDocument(definition, resolvedPath, source);
				const existing = priorCatalog.get(resolvedPath);
				nextDocuments.set(parsed.fileId, parsed);
				nextCatalog.set(resolvedPath, catalogForDocument(parsed, hash));
				if (!existing) {
					changed.added.push(parsed.fileId);
				} else if (existing.hash !== hash) {
					changed.modified.push(parsed.fileId);
				}
			}
		}
		for (const [existingPath, existing] of priorCatalog.entries()) {
			if (!trackedPaths.has(existingPath)) {
				changed.removed.push(existing.fileId);
				nextCatalog.delete(existingPath);
				nextDocuments.delete(existing.fileId);
			}
		}
	}

	const built = buildGraphFromDocuments(
		[...nextDocuments.values()].sort((left, right) => left.fileId.localeCompare(right.fileId)),
		models,
		priorState?.metrics,
		changed,
	);

	return {
		modelSignature,
		documents: [...nextDocuments.values()].sort((left, right) => left.fileId.localeCompare(right.fileId)),
		nodes: built.nodes,
		edges: built.edges,
		catalog: [...nextCatalog.values()].sort((left, right) => left.fileId.localeCompare(right.fileId)),
		metrics: built.metrics,
		validation: built.validation,
		delta: changed,
		snapshotRoot,
	};
}

export async function clearGraphSnapshot(repoRoot: string) {
	await rm(graphSnapshotRoot(repoRoot), { recursive: true, force: true });
}
