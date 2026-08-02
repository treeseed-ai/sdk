import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
import type { TokenRefreshRequest,TokenRefreshResponse } from "../../../entrypoints/clients/remote.ts";
export function refreshTokenMethod(this: MarketClient, request: TokenRefreshRequest) {
    return this.requestFirst<TokenRefreshResponse>(this.localAuthPaths('/v1/auth/token/refresh', '/auth/token/refresh'), {
        method: 'POST',
        body: request,
    });
}
