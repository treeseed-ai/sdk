import { TreeDxClient } from "../../../../../../support/client.ts";
export async function prometheusMetricsMethod(this: TreeDxClient): Promise<string> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/metrics`, {
        method: 'GET',
        headers: { accept: 'text/plain' },
    });
    if (!response.ok) {
        let payload: unknown;
        try {
            payload = await response.json();
        }
        catch {
            payload = undefined;
        }
        this.throwApiError(response, payload);
    }
    return response.text();
}
