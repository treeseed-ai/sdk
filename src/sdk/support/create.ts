import { resolveModelDefinition } from "../../entrypoints/models/model-registry.ts";
import type { SdkMutationRequest } from "../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../entrypoints/models/sdk.ts";
export async function createMethod(this: AgentSdk, request: SdkMutationRequest) {
    const definition = resolveModelDefinition(request.model, this.models);
    const payload = definition.storage === 'content'
        ? await this.content.create({ ...request, model: definition.name })
        : await this.database.create({ ...request, model: definition.name });
    return this.envelope(definition.name, 'create', payload);
}
