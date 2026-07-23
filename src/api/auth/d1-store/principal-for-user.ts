import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from ".././rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from ".././tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../d1-store.ts";
export async function principalForUserMethod(this: D1AuthStore, userId: string): Promise<PrincipalRecord> {
    const user = await this.loadUser(userId);
    if (!user) {
        throw new Error(`Unknown user "${userId}".`);
    }
    const roles = await this.rolesForUser(userId);
    const permissions = await this.permissionsForUser(userId);
    return {
        userId,
        principal: {
            id: user.id,
            displayName: user.display_name ?? undefined,
            roles,
            permissions,
            scopes: this.scopesForPrincipal(permissions),
            metadata: {
                ...parseJson(user.metadata_json, {}),
                email: user.email ?? undefined,
                username: user.username ?? undefined,
            },
        },
    };
}
