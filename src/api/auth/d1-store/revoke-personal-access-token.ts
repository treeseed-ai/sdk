import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from ".././rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from ".././tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../d1-store.ts";
export async function revokePersonalAccessTokenMethod(this: D1AuthStore, userId: string, tokenId: string) {
    await this.ensureInitialized();
    await this.run(`UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?`, [isoNow(), tokenId, userId]);
    await this.writeAuditEvent({
        actorType: 'user',
        actorId: userId,
        eventType: 'auth.pat_revoked',
        targetType: 'api_token',
        targetId: tokenId,
    });
}
