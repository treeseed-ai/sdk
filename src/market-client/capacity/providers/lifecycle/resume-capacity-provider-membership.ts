import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function resumeCapacityProviderMembershipMethod(this: MarketClient, teamId: string, membershipId: string, idempotencyKey: string) { return this.updateCapacityProviderMembershipStatus(teamId, membershipId, 'resume', idempotencyKey); }
