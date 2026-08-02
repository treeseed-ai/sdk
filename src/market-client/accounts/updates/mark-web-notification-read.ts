import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function markWebNotificationReadMethod(this: MarketClient, notificationId: string) {
    return this.request<{
        ok: true;
        payload: {
            id: string;
            readAt: string;
        };
    }>(`/v1/auth/web/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST', requireAuth: true });
}
