import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { D1DatabaseLike } from "../../../../../types/cloudflare.ts";
import type { ApiConfig, ApiCredential, ApiPrincipal, DeviceCodeApproveRequest, DeviceCodePollRequest, DeviceCodePollResponse, DeviceCodeStartRequest, DeviceCodeStartResponse, TokenRefreshRequest, TokenRefreshResponse, TrustedUserAssertionClaims, UserIdentityProfileInput, } from "../../../../types.ts";
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES } from "../../../rbac.ts";
import { createAccessToken, nextOpaqueToken, principalFromAccessTokenPayload, verifyAccessToken } from "../../../tokens.ts";
import { approvalUrl, AUTH_SCHEMA_SQL, DeviceCodeRow, UserRow, PrincipalRecord, PersonalAccessTokenResult, ServiceCredentialResult, now, isoNow, addSeconds, parseJson, stableHash, equalHash, D1AuthStore } from "../../../d1-store.ts";
export async function ensureAuthSchemaMethod(this: D1AuthStore) {
    for (const statement of AUTH_SCHEMA_SQL)
        await this.run(statement);
    const result = await this.db.prepare('PRAGMA table_info(users)').all<{
        name: string;
    }>();
    const columns = new Set((result.results ?? []).map((row) => row.name));
    if (!columns.has('username')) {
        await this.run('ALTER TABLE users ADD COLUMN username TEXT');
    }
    await this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');
}
