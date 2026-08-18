import { D1AuthStore } from "../../../d1-store.ts";
export async function runMethod(this: D1AuthStore, query: string, params: unknown[] = []) {
    await this.db.prepare(query).bind(...params).run();
}
