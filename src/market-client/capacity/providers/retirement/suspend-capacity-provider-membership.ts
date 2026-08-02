import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function suspendCapacityProviderMembershipMethod(this: MarketClient, teamId: string, membershipId: string, idempotencyKey: string) { return this.updateCapacityProviderMembershipStatus(teamId, membershipId, 'suspend', idempotencyKey); }
