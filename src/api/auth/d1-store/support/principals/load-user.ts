import { D1AuthStore,UserRow } from "../../../d1-store.ts";
export async function loadUserMethod(this: D1AuthStore, userId: string) {
    return this.first<UserRow>(`SELECT * FROM users WHERE id = ?`, [userId]);
}
