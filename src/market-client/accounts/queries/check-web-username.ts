import type { AuthAvailabilityResult } from "../../../accounts/account-contracts.ts";
import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function checkWebUsernameMethod(this: MarketClient, username: string) {
    return this.request<{
        ok: true;
        payload: AuthAvailabilityResult;
    }>(`/v1/auth/availability/username?value=${encodeURIComponent(username)}`);
}
