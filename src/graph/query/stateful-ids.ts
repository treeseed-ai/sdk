import type {
SdkGraphNode
} from '../../entrypoints/models/sdk-types.ts';


export function statefulIds(nodes: Iterable<SdkGraphNode>, predicate: (node: SdkGraphNode) => boolean) {
	const ids = new Set<string>();
	for (const node of nodes) {
		if (predicate(node)) {
			ids.add(node.id);
		}
	}
	return ids;
}
