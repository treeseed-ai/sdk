import type { UpsertTeamInboxItemRequest } from "../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../entrypoints/models/sdk.ts";
export async function upsertTeamInboxItemMethod(this: AgentSdk, request: UpsertTeamInboxItemRequest) {
    const payload = await this.database.upsertTeamInboxItem(request);
    return this.envelope('team_inbox_item', 'update', payload);
}
