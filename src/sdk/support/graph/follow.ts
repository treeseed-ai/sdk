import { resolveModelDefinition } from "../../../entrypoints/models/model-registry.ts";
import type { SdkFollowRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export async function followMethod(this: AgentSdk, request: SdkFollowRequest) {
    const definition = resolveModelDefinition(request.model, this.models);
    const payload = definition.storage === 'content'
        ? await this.content.follow({ ...request, model: definition.name })
        : await this.database.follow({ ...request, model: definition.name });
    return this.envelope(definition.name, 'follow', payload, {
        count: payload.items.length,
    });
}
