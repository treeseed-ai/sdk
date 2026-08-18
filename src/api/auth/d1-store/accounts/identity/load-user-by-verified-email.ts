import { D1AuthStore,UserRow } from "../../../d1-store.ts";
export async function loadUserByVerifiedEmailMethod(this: D1AuthStore, email: string) {
    return this.first<UserRow>(`SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND status = 'active' LIMIT 1`, [email]);
}
