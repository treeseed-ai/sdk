import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function rotateTeamCapacityRegistrationKeyMethod(this: MarketClient, teamId: string, idempotencyKey: string) { return this.updateTeamCapacityRegistrationKeyStatus(teamId, 'rotate', idempotencyKey); }
