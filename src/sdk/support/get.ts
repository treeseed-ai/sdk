import { resolveModelDefinition } from "../../entrypoints/models/model-registry.ts";
import type { SdkGetRequest } from "../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../entrypoints/models/sdk.ts";
export async function getMethod(this: AgentSdk, request: SdkGetRequest) {
    const definition = resolveModelDefinition(request.model, this.models);
    const payload = definition.storage === 'content'
        ? await this.content.get({ ...request, model: definition.name })
        : await this.database.get({ ...request, model: definition.name });
    return this.envelope(definition.name, 'get', payload);
}
