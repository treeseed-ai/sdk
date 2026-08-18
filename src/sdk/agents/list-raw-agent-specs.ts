import { AgentSdk } from "../../entrypoints/models/sdk.ts";
export async function listRawAgentSpecsMethod(this: AgentSdk, options?: {
    enabled?: boolean;
}) {
    const filters = typeof options?.enabled === 'boolean'
        ? [{ field: 'enabled', op: 'eq' as const, value: options.enabled }]
        : [];
    const response = await this.search({
        model: 'agent',
        filters,
        sort: [{ field: 'name', direction: 'asc' }],
    });
    return response.payload;
}
