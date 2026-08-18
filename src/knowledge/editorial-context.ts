import { createHash } from 'node:crypto';
import { EDITORIAL_CONTEXT_SCHEMA_VERSION } from './contracts.ts';

export const EDITORIAL_CONTEXT_LAYER_KINDS = [
	'core-objective', 'project-core', 'book-core', 'chapter-brief', 'target-page',
	'related-page', 'guarantee', 'evidence', 'source', 'assignment',
] as const;

export type EditorialContextLayerKind = (typeof EDITORIAL_CONTEXT_LAYER_KINDS)[number];

export interface EditorialContextLayer {
	kind: EditorialContextLayerKind;
	id: string;
	revision: string;
	content: string;
	path?: string;
	reason?: string;
}

export interface EditorialContextPack {
	schemaVersion: typeof EDITORIAL_CONTEXT_SCHEMA_VERSION;
	layers: EditorialContextLayer[];
	compiledEditorialInstructions: string;
	digest: string;
}

export interface CompileEditorialContextOptions {
	requiredKinds?: EditorialContextLayerKind[];
	requireUniqueKinds?: EditorialContextLayerKind[];
}

const order = new Map(EDITORIAL_CONTEXT_LAYER_KINDS.map((kind, index) => [kind, index]));

function validateLayer(layer: EditorialContextLayer) {
	if (!layer.id.trim()) throw new Error('Editorial context layers require an id.');
	if (!layer.revision.trim()) throw new Error(`Editorial context layer "${layer.id}" requires a revision.`);
	if (!layer.content.trim()) throw new Error(`Editorial context layer "${layer.id}" is empty.`);
}

export function compileEditorialContext(layers: EditorialContextLayer[], options: CompileEditorialContextOptions = {}): EditorialContextPack {
	if (!layers.length) throw new Error('Editorial context requires at least one layer.');
	layers.forEach(validateLayer);
	const identities = new Set<string>();
	for (const layer of layers) {
		const identity = `${layer.kind}:${layer.id}:${layer.revision}`;
		if (identities.has(identity)) throw new Error(`Duplicate editorial context layer "${identity}".`);
		identities.add(identity);
	}
	for (const kind of options.requiredKinds ?? []) {
		if (!layers.some((layer) => layer.kind === kind)) throw new Error(`Editorial context is missing required ${kind} layer.`);
	}
	for (const kind of options.requireUniqueKinds ?? []) {
		if (layers.filter((layer) => layer.kind === kind).length !== 1) {
			throw new Error(`Editorial context requires exactly one ${kind} layer.`);
		}
	}
	const sorted = layers.map((layer, index) => ({ layer, index })).sort((left, right) =>
		(order.get(left.layer.kind) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.layer.kind) ?? Number.MAX_SAFE_INTEGER)
		|| left.index - right.index).map(({ layer }) => ({ ...layer }));
	const compiledEditorialInstructions = sorted.map((layer) => [
		`## Editorial context: ${layer.kind} — ${layer.id}`,
		`Revision: ${layer.revision}`,
		...(layer.path ? [`Path: ${layer.path}`] : []),
		...(layer.reason ? [`Retrieval reason: ${layer.reason}`] : []),
		'', layer.content.trim(),
	].join('\n')).join('\n\n');
	const digest = createHash('sha256').update(JSON.stringify(sorted.map((layer) => ({
		kind: layer.kind, id: layer.id, revision: layer.revision, path: layer.path ?? null,
		reason: layer.reason ?? null, content: layer.content,
	})))).digest('hex');
	return { schemaVersion: EDITORIAL_CONTEXT_SCHEMA_VERSION, layers: sorted, compiledEditorialInstructions, digest };
}
