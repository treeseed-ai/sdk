import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function deliverableManifestMethod(this: MarketClient, manifestId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/deliverable-manifests/${encodeURIComponent(manifestId)}`, { requireAuth: true });
}
export function submitDeliverableManifestMethod(this:MarketClient,contractId:string,input:Record<string,unknown>){
	return this.request<{ok:true;payload:Record<string,unknown>}>(`/v1/deliverable-contracts/${encodeURIComponent(contractId)}/manifests`,{method:'POST',body:input,requireAuth:true});
}
export function approveDeliverableContractMethod(this:MarketClient,contractId:string,input:Record<string,unknown>){
	return this.request<{ok:true;payload:Record<string,unknown>}>(`/v1/deliverable-contracts/${encodeURIComponent(contractId)}/approve`,{method:'POST',body:input,requireAuth:true});
}
