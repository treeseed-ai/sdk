import { resolveModelDefinition } from "../../../entrypoints/models/model-registry.ts";
import type { SdkJsonEnvelope } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export function envelopeMethod<TPayload>(this: AgentSdk, model: string, operation: SdkJsonEnvelope<TPayload>['operation'], payload: TPayload, meta?: Record<string, unknown>): SdkJsonEnvelope<TPayload> {
    return {
        ok: true,
        model: resolveModelDefinition(model, this.models).name,
        operation,
        payload,
        meta,
    };
}
