import type { SdkDispatchNamespace, SdkDispatchPolicy } from '../entrypoints/models/sdk-types.ts';
import {
	createContentToolPresets,
	genericContentInputSchema,
	type ContentAction,
	type ContentModel,
} from '../operations/content-operations.ts';
import { AGENT_TOOL_DEFINITIONS } from './agent-tool-definitions.ts';

export const AGENT_TOOL_INDEX = new Map(AGENT_TOOL_DEFINITIONS.map((definition) => [definition.id, definition]));

export function findAgentToolDefinition(id: string | null | undefined) {
	return id ? AGENT_TOOL_INDEX.get(id) ?? null : null;
}

export function listAgentToolIds() {
	return AGENT_TOOL_DEFINITIONS.map((definition) => definition.id);
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
