import type { SdkDispatchNamespace, SdkDispatchPolicy } from '../sdk-types.ts';
import {
	createTreeseedContentToolPresets,
	genericTreeseedContentInputSchema,
	type TreeseedContentAction,
	type TreeseedContentModel,
} from '../content-operations.ts';
import { TREESEED_AGENT_TOOL_DEFINITIONS } from './treeseed-agent-tool-definitions.ts';

export const AGENT_TOOL_INDEX = new Map(TREESEED_AGENT_TOOL_DEFINITIONS.map((definition) => [definition.id, definition]));

export function findAgentToolDefinition(id: string | null | undefined) {
	return id ? AGENT_TOOL_INDEX.get(id) ?? null : null;
}

export function listAgentToolIds() {
	return TREESEED_AGENT_TOOL_DEFINITIONS.map((definition) => definition.id);
}

export function assertKnownAgentToolIds(ids: string[]) {
	const seen = new Set<string>();
	const known: string[] = [];
	const unknown: string[] = [];
	const duplicates: string[] = [];
	for (const id of ids) {
		if (seen.has(id)) {
			duplicates.push(id);
			continue;
		}
		seen.add(id);
		if (AGENT_TOOL_INDEX.has(id)) {
			known.push(id);
		} else {
			unknown.push(id);
		}
	}
	return { known, unknown, duplicates };
}
