import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function localAuthPathsMethod(this: MarketClient, v1Path: string, legacyPath: string) {
    return this.options.profile.id === 'local' ? [legacyPath, v1Path] : [v1Path];
}
