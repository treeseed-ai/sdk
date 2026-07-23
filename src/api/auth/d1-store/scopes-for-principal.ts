import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from ".././rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from ".././tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../d1-store.ts";
export function scopesForPrincipalMethod(this: D1AuthStore, permissions: string[]) {
    const scopes = new Set<string>(['auth:me']);
    if (permissions.includes('*:*:*') || permissions.includes('sdk:execute:global'))
        scopes.add('sdk');
    if (permissions.includes('*:*:*') || permissions.includes('agent:execute:global'))
        scopes.add('agent');
    if (permissions.includes('*:*:*') || permissions.includes('operations:execute:global'))
        scopes.add('operations');
    return [...scopes];
}
