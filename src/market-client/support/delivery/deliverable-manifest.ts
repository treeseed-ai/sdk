import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function deliverableManifestMethod(this: MarketClient, manifestId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/deliverable-manifests/${encodeURIComponent(manifestId)}`, { requireAuth: true });
}
