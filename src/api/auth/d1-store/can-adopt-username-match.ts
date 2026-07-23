import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from ".././rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from ".././tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../d1-store.ts";
export function canAdoptUsernameMatchMethod(this: D1AuthStore, identity: UserIdentityProfileInput, user: UserRow | null) {
    if (!user?.id || !identity.username)
        return false;
    const profile = identity.profile && typeof identity.profile === 'object' ? identity.profile : {};
    if (identity.provider === 'acceptance' || profile.acceptance === true)
        return true;
    const existingEmail = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    const requestedEmail = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
    return Boolean(requestedEmail && existingEmail && requestedEmail === existingEmail && identity.emailVerified);
}
