import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function revokeCapacityProviderMembershipMethod(this: MarketClient, teamId: string, membershipId: string, idempotencyKey: string) { return this.updateCapacityProviderMembershipStatus(teamId, membershipId, 'revoke', idempotencyKey); }
