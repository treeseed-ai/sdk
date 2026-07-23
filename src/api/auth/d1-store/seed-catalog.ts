import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from ".././rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from ".././tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../d1-store.ts";
export async function seedCatalogMethod(this: D1AuthStore) {
    const createdAt = isoNow();
    for (const permission of DEFAULT_PERMISSIONS) {
        await this.run(`INSERT OR IGNORE INTO permissions (id, key, resource, action, scope, description, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), permission.key, permission.resource, permission.action, permission.scope, permission.description, createdAt]);
    }
    for (const role of DEFAULT_ROLES) {
        await this.run(`INSERT OR IGNORE INTO roles (id, key, description, created_at)
				 VALUES (?, ?, ?, ?)`, [randomUUID(), role.key, role.description, createdAt]);
        const roleRow = await this.first<{
            id: string;
        }>(`SELECT id FROM roles WHERE key = ?`, [role.key]);
        if (!roleRow)
            continue;
        for (const permissionKey of role.permissions) {
            const permissionRow = await this.first<{
                id: string;
            }>(`SELECT id FROM permissions WHERE key = ?`, [permissionKey]);
            if (permissionRow) {
                await this.run(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id, created_at)
						 VALUES (?, ?, ?)`, [roleRow.id, permissionRow.id, createdAt]);
            }
        }
    }
}
