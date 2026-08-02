import type { TeamCapacityRegistrationKeyMetadata,TeamCapacityRegistrationKeyReveal } from "../../../../capacity-provider/contracts/index.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function updateTeamCapacityRegistrationKeyStatusMethod(this: MarketClient, teamId: string, action: 'rotate' | 'enable' | 'disable', idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: TeamCapacityRegistrationKeyMetadata | TeamCapacityRegistrationKeyReveal;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-registration-key/${action}`, { method: 'POST', requireAuth: true, headers: { 'idempotency-key': idempotencyKey } });
}
