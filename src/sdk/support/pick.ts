import { resolveModelDefinition } from "../../entrypoints/models/model-registry.ts";
import type { SdkPickRequest } from "../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../entrypoints/models/sdk.ts";
export async function pickMethod(this: AgentSdk, request: SdkPickRequest) {
    const definition = resolveModelDefinition(request.model, this.models);
    const payload = definition.storage === 'content'
        ? await this.localContentStore.pick({ ...request, model: definition.name })
        : await this.database.pick({ ...request, model: definition.name });
    return this.envelope(definition.name, 'pick', payload, {
        claimed: Boolean(payload.item),
    });
}
