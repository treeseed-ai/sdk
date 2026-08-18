import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function updateWebPasswordMethod(this: MarketClient, body: {
    currentPassword?: string;
    password: string;
    reauthenticationGrantId?: string;
}) {
    return this.request<{
        ok: true;
        payload: {
            changed: true;
        };
    }>('/v1/auth/web/password', {
        method: 'PATCH',
        body,
        requireAuth: true,
    });
}
