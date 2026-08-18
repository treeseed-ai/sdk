import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function revokeWebSessionMethod(this: MarketClient, sessionId: string) {
    return this.request<{
        ok: true;
        payload: {
            sessionId: string;
            status: 'revoked' | 'already-revoked';
        };
    }>(`/v1/auth/web/sessions/${encodeURIComponent(sessionId)}/revoke`, { method: 'POST', requireAuth: true });
}
