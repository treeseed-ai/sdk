import { resolveModelDefinition } from "../../../entrypoints/models/model-registry.ts";
import { normalizeFilterFields,normalizeRecordToCanonicalShape,normalizeSortFields } from "../../../entrypoints/models/sdk-fields.ts";
import { applyFilters,applySort } from "../../../entrypoints/models/sdk-filters.ts";
import type { SdkSearchRequest } from "../../../entrypoints/models/sdk-types.ts";
import { MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export async function searchMethod(this: MemoryAgentDatabase, request: SdkSearchRequest) {
    const definition = resolveModelDefinition(request.model);
    const rows = this.rowsForModel(request.model).map((row) => normalizeRecordToCanonicalShape(definition, row as Record<string, unknown>));
    const filtered = applyFilters(rows as Record<string, unknown>[], normalizeFilterFields(definition, request.filters), definition);
    const sorted = applySort(filtered as Record<string, unknown>[], normalizeSortFields(definition, request.sort), definition);
    return sorted.slice(0, request.limit ?? sorted.length) as Record<string, unknown>[];
}
