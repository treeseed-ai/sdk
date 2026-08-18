import { CatalogArtifactDownload,MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function artifactDownloadMethod(this: MarketClient, itemId: string, version: string) {
    return this.request<{
        ok: true;
        payload: CatalogArtifactDownload;
    }>(`/v1/catalog/${encodeURIComponent(itemId)}/artifacts/${encodeURIComponent(version)}/download`, { requireAuth: Boolean(this.accessToken) });
}
