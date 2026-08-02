import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function disableTeamCapacityRegistrationKeyMethod(this: MarketClient, teamId: string, idempotencyKey: string) { return this.updateTeamCapacityRegistrationKeyStatus(teamId, 'disable', idempotencyKey); }
