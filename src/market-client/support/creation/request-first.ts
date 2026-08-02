import { MarketClient,MarketClientError } from "../../../entrypoints/clients/market-client.ts";
export async function requestFirstMethod<T>(this: MarketClient, paths: string[], options: {
    method?: string;
    body?: unknown;
    requireAuth?: boolean;
    headers?: Record<string, string>;
} = {}): Promise<T> {
    let notFound: MarketClientError | null = null;
    for (const path of paths) {
        try {
            return await this.request<T>(path, options);
        }
        catch (error) {
            if (error instanceof MarketClientError && error.status === 404) {
                notFound = error;
                continue;
            }
            throw error;
        }
    }
    throw notFound ?? new MarketClientError('Market request failed with 404.', 404, {});
}
