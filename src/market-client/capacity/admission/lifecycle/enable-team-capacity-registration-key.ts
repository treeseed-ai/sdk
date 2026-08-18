import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function enableTeamCapacityRegistrationKeyMethod(this: MarketClient, teamId: string, idempotencyKey: string) { return this.updateTeamCapacityRegistrationKeyStatus(teamId, 'enable', idempotencyKey); }
