import { resolveModelDefinition } from "../../entrypoints/models/model-registry.ts";
import type { SdkUpdateRequest } from "../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../entrypoints/models/sdk.ts";
export async function updateMethod(this: AgentSdk, request: SdkUpdateRequest) {
    const definition = resolveModelDefinition(request.model, this.models);
    const payload = definition.storage === 'content'
        ? await this.content.update({ ...request, model: definition.name })
        : await this.database.update({ ...request, model: definition.name });
    return this.envelope(definition.name, 'update', payload);
}
