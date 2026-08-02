import { TreeDxClient } from "../../../../../../support/client.ts";
export function headersMethod(this: TreeDxClient, bodyPresent: boolean) {
    const headers: Record<string, string> = {
        accept: 'application/json',
    };
    if (bodyPresent) {
        headers['content-type'] = 'application/json';
    }
    if (this.token) {
        headers.authorization = `Bearer ${this.token}`;
    }
    return headers;
}
