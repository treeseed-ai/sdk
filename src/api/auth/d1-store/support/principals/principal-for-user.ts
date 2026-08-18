import { D1AuthStore,parseJson,PrincipalRecord } from "../../../d1-store.ts";
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
