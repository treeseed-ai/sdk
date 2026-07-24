import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from "../../../rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from "../../../tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../../../d1-store.ts";
export async function exchangeTrustedUserAssertionMethod(this: D1AuthStore, claims: TrustedUserAssertionClaims) {
    await this.ensureInitialized();
    const principalRecord = await this.principalForUser(claims.userId);
    const expiresAt = addSeconds(now(), this.config.webExchangeTtlSeconds);
    const accessToken = createAccessToken({
        sub: principalRecord.principal.id,
        displayName: principalRecord.principal.displayName,
        scopes: principalRecord.principal.scopes,
        roles: principalRecord.principal.roles,
        permissions: principalRecord.principal.permissions,
        metadata: {
            ...principalRecord.principal.metadata,
            actingSessionId: claims.sessionId,
            identityId: claims.identityId,
            teamId: claims.teamId ?? null,
            projectId: claims.projectId ?? null,
            membershipId: claims.membershipId ?? null,
            teamRoles: [...new Set((claims.teamRoles ?? []).filter((entry) => typeof entry === 'string' && entry.trim()))],
            teamCapabilities: [...new Set((claims.teamCapabilities ?? []).filter((entry) => typeof entry === 'string' && entry.trim()))],
            authTime: claims.authTime,
        },
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(expiresAt.getTime() / 1000),
        iss: this.config.issuer,
        jti: randomUUID(),
        tokenType: 'access',
    }, this.config.authSecret);
    await this.writeAuditEvent({
        actorType: 'service',
        actorId: this.config.webServiceId,
        eventType: 'auth.web_exchange',
        targetType: 'user',
        targetId: claims.userId,
        data: { sessionId: claims.sessionId },
    });
    return {
        ok: true as const,
        accessToken,
        tokenType: 'Bearer' as const,
        expiresAt: expiresAt.toISOString(),
        expiresInSeconds: this.config.webExchangeTtlSeconds,
        principal: principalRecord.principal,
    };
}
