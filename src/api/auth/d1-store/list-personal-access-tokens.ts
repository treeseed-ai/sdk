import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from ".././rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from ".././tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../d1-store.ts";
export async function listPersonalAccessTokensMethod(this: D1AuthStore, userId: string) {
    await this.ensureInitialized();
    return this.all<{
        id: string;
        name: string;
        token_prefix: string;
        expires_at: string | null;
        last_used_at: string | null;
        revoked_at: string | null;
        created_at: string;
    }>(`SELECT id, name, token_prefix, expires_at, last_used_at, revoked_at, created_at
			 FROM api_tokens
			 WHERE user_id = ?
			 ORDER BY created_at DESC`, [userId]);
}
