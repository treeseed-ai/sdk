import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function deleteAccountMethod(this: MarketClient, body: {
    confirmation?: string;
    currentPassword?: string;
    reauthenticationGrantId?: string;
} = {}) {
    return this.request<{
        ok: true;
        payload: {
            deleted: true;
        };
    }>('/v1/auth/web/account', {
        method: 'DELETE',
        body,
        requireAuth: true,
    });
}
