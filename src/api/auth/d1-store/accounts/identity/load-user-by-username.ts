import { D1AuthStore,UserRow } from "../../../d1-store.ts";
export async function loadUserByUsernameMethod(this: D1AuthStore, username: string) {
    return this.first<UserRow>(`SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND status = 'active' LIMIT 1`, [username]);
}
