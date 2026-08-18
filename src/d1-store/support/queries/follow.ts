import type { SdkFilterCondition,SdkFollowRequest } from "../../../entrypoints/models/sdk-types.ts";
import { filterSinceField,MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export async function followMethod(this: MemoryAgentDatabase, request: SdkFollowRequest) {
    const filters: SdkFilterCondition[] = [
        ...(request.filters ?? []),
        {
            field: filterSinceField(request.model),
            op: 'updated_since',
            value: request.since,
        },
    ];
    return {
        items: await this.search({
            model: request.model,
            filters,
        }),
        since: request.since,
    };
}
