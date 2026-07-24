import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from "../../rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from "../../tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../../d1-store.ts";
export async function permissionsForRolesMethod(this: D1AuthStore, roleKeys: string[]) {
    if (roleKeys.length === 0) {
        return [];
    }
    const placeholders = roleKeys.map(() => '?').join(', ');
    const rows = await this.all<{
        key: string;
    }>(`SELECT DISTINCT permissions.key AS key
			 FROM roles
			 INNER JOIN role_permissions ON role_permissions.role_id = roles.id
			 INNER JOIN permissions ON permissions.id = role_permissions.permission_id
			 WHERE roles.key IN (${placeholders})`, roleKeys);
    return rows.map((row) => row.key);
}
