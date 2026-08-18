import { D1AuthStore } from "../../d1-store.ts";
export async function replaceRolesMethod(this: D1AuthStore, userId: string, roleKeys: string[]) {
    await this.run(`DELETE FROM user_role_bindings WHERE user_id = ?`, [userId]);
    for (const roleKey of roleKeys) {
        await this.assignRole(userId, roleKey);
    }
}
