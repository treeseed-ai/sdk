import { resolveModelDefinition } from "../../../entrypoints/models/model-registry.ts";
import type { SdkSearchRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export async function searchMethod(this: AgentSdk, request: SdkSearchRequest) {
    const definition = resolveModelDefinition(request.model, this.models);
    const payload = definition.storage === 'content'
        ? await this.content.search({ ...request, model: definition.name })
        : await this.database.search({ ...request, model: definition.name });
    return this.envelope(definition.name, 'search', payload, {
        count: Array.isArray(payload) ? payload.length : 0,
    });
}
