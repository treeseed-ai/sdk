import { D1AuthStore } from "../../../d1-store.ts";
export async function firstMethod<T = Record<string, unknown>>(this: D1AuthStore, query: string, params: unknown[] = []) {
    return this.db.prepare(query).bind(...params).first<T>();
}
