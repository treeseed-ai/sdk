import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
import type { DeviceCodePollRequest,DeviceCodePollResponse } from "../../../entrypoints/clients/remote.ts";
export function pollDeviceLoginMethod(this: MarketClient, request: DeviceCodePollRequest) {
    return this.requestFirst<DeviceCodePollResponse>(this.localAuthPaths('/v1/auth/device/poll', '/auth/device/poll'), {
        method: 'POST',
        body: request,
    });
}
