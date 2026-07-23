import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from ".././rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from ".././tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../d1-store.ts";
export async function authenticateServiceMethod(this: D1AuthStore, serviceId: string, secret: string): Promise<{
    principal: ApiPrincipal;
    credential: ApiCredential;
} | null> {
    await this.ensureInitialized();
    const row = await this.first<{
        id: string;
        name: string;
        secret_hash: string;
        roles_json: string;
        permissions_json: string;
        revoked_at: string | null;
    }>(`SELECT id, name, secret_hash, roles_json, permissions_json, revoked_at
			 FROM service_credentials
			 WHERE service_id = ?`, [serviceId]);
    if (!row || row.revoked_at)
        return null;
    const incomingHash = stableHash(secret, this.config.authSecret);
    if (!equalHash(row.secret_hash, incomingHash))
        return null;
    await this.run(`UPDATE service_credentials SET last_used_at = ?, updated_at = ? WHERE id = ?`, [isoNow(), isoNow(), row.id]);
    const roles = parseJson<string[]>(row.roles_json, []);
    const permissions = [
        ...new Set([
            ...await this.permissionsForRoles(roles),
            ...parseJson<string[]>(row.permissions_json, []),
        ]),
    ];
    return {
        principal: {
            id: serviceId,
            displayName: row.name,
            roles,
            permissions,
            scopes: this.scopesForPrincipal(permissions),
            metadata: { serviceId },
        },
        credential: { type: 'service_secret', id: row.id, label: row.name },
    };
}
