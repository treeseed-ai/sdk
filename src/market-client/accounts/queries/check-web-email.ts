import type { AuthAvailabilityResult } from "../../../accounts/account-contracts.ts";
import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function checkWebEmailMethod(this: MarketClient, email: string) {
    return this.request<{
        ok: true;
        payload: AuthAvailabilityResult;
    }>(`/v1/auth/availability/email?value=${encodeURIComponent(email)}`);
}
