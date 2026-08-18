import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
import type { DeviceCodeStartRequest,DeviceCodeStartResponse } from "../../../entrypoints/clients/remote.ts";
export function startDeviceLoginMethod(this: MarketClient, request: DeviceCodeStartRequest) {
    return this.requestFirst<DeviceCodeStartResponse>(this.localAuthPaths('/v1/auth/device/start', '/auth/device/start'), {
        method: 'POST',
        body: request,
    });
}
