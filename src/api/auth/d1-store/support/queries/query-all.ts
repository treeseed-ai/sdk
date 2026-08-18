import { D1AuthStore } from "../../../d1-store.ts";
export async function allMethod<T = Record<string, unknown>>(this: D1AuthStore, query: string, params: unknown[] = []) {
    const result = await this.db.prepare(query).bind(...params).all<T>();
    return result.results ?? [];
}
