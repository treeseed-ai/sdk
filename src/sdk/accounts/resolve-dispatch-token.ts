import type { SdkDispatchCredentialSource } from "../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../entrypoints/models/sdk.ts";
export async function resolveDispatchTokenMethod(this: AgentSdk, source: SdkDispatchCredentialSource | undefined) {
    if (!source) {
        return null;
    }
    if (source.type === 'bearer') {
        return source.token;
    }
    return await source.resolveToken();
}
