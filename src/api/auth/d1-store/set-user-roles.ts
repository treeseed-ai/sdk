import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from ".././rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from ".././tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../d1-store.ts";
export async function setUserRolesMethod(this: D1AuthStore, userId: string, roles: string[]) {
    await this.ensureInitialized();
    const requestedRoles = [...new Set(roles.map((role) => role.trim()).filter(Boolean))];
    await this.replaceRoles(userId, requestedRoles.length > 0 ? requestedRoles : ['member']);
    await this.writeAuditEvent({
        actorType: 'service',
        actorId: this.config.webServiceId,
        eventType: 'auth.user_roles_set',
        targetType: 'user',
        targetId: userId,
        data: { roles: requestedRoles },
    });
    return this.principalForUser(userId);
}
