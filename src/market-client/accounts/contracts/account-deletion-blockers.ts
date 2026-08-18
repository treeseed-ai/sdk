import type { AccountDeletionBlocker } from "../../../accounts/account-contracts.ts";
import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function accountDeletionBlockersMethod(this: MarketClient) {
    return this.request<{
        ok: true;
        payload: {
            blockers: AccountDeletionBlocker[];
            canDelete: boolean;
        };
    }>('/v1/auth/web/account/deletion-blockers', { requireAuth: true });
}
