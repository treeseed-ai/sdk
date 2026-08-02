import { resolveCloudflareTunnelApiToken } from '../../../../configuration/service-credentials.ts';
import { runManagedDevAction, checkHttpHealth } from '../../../providers/local-private.ts';
import type { ReconcileAdapter, ReconcileAdapterInput } from '../../../support/contracts/contracts.ts';
import { cloudflareApiRequest, resolveCloudflareZoneIdForHost } from '../../../../operations/services/hosting/deployment/deploy.ts';
import { resolveReconcileEnvironmentValues } from '../../reconciliation/build-workflow-meta-adapter.ts';
import { verificationCheck } from '../first-railway-domain-string.ts';
import { genericResult, noopDiff } from '../to-deploy-target.ts';
import { summarizeVerification } from '../../support/summarize-verification.ts';

function values(input: ReconcileAdapterInput) {
	const configured = resolveReconcileEnvironmentValues(input, 'local');
	const credential = resolveCloudflareTunnelApiToken({ ...process.env, ...input.context.launchEnv, ...configured });
	const accountId = String(configured.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? input.unit.spec.accountId ?? '').trim();
	const env = { ...configured, TREESEED_CLOUDFLARE_API_TOKEN: credential.token, CLOUDFLARE_API_TOKEN: credential.token,
		TREESEED_CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_ACCOUNT_ID: accountId };
	return { credential, accountId, env };
}

function resultItems(payload: any) { return Array.isArray(payload?.result) ? payload.result : []; }
function desiredIngress(input: ReconcileAdapterInput) {
	const hostname = String(input.unit.spec.hostname); const origin = String(input.unit.spec.originUrl);
	const paths = Array.isArray(input.unit.spec.allowedPaths) ? input.unit.spec.allowedPaths.map(String) : [];
	return [...paths.map((path) => ({ hostname, path: `^${path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, service: origin })), { service: 'http_status:404' }];
}

function findTunnel(input: ReconcileAdapterInput, env: Record<string, string>) {
	const accountId = String(env.CLOUDFLARE_ACCOUNT_ID); const name = String(input.unit.spec.name);
	const payload = cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`, { env, allowFailure: true });
	return resultItems(payload).find((entry: any) => entry?.name === name) ?? null;
}

function findDns(zoneId: string, hostname: string, env: Record<string, string>) {
	if (!zoneId) return null;
	const payload = cloudflareApiRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}&per_page=100`, { env, allowFailure: true });
	return resultItems(payload).find((entry: any) => entry?.name === hostname) ?? null;
}

function resolveZone(input: ReconcileAdapterInput, env: Record<string, string>) {
	return String(input.unit.spec.zoneId ?? '').trim() || resolveCloudflareZoneIdForHost(input.context.deployConfig, String(input.unit.spec.hostname), env) || '';
}

function tunnelMutationError(error: unknown, source: string) {
	const credential = source === 'tunnel' ? 'TREESEED_CLOUDFLARE_TUNNEL_API_TOKEN' : 'TREESEED_CLOUDFLARE_API_TOKEN fallback';
	const reason = error instanceof Error ? error.message : String(error);
	return new Error(`Cloudflare rejected Tunnel reconciliation using the ${credential}. Configure Account · Cloudflare Tunnel · Edit and the declared hostname's DNS · Edit permissions, then reconcile again. Provider response: ${reason}`);
}

async function observe(input: ReconcileAdapterInput) {
	const configured = values(input); const warnings = configured.credential.fallbackUsed ? ['Using broader TREESEED_CLOUDFLARE_API_TOKEN fallback for Tunnel reconciliation.'] : [];
	if (!configured.accountId || !configured.credential.token) return { exists: false, status: 'error' as const, live: {}, locators: {}, warnings: [...warnings, 'Cloudflare account ID and Tunnel API token are required.'] };
	try {
		const tunnel = findTunnel(input, configured.env); const zoneId = resolveZone(input, configured.env);
		const dns = findDns(zoneId, String(input.unit.spec.hostname), configured.env);
		const configuration = tunnel ? cloudflareApiRequest(`/accounts/${encodeURIComponent(configured.accountId)}/cfd_tunnel/${encodeURIComponent(tunnel.id)}/configurations`, { env: configured.env, allowFailure: true })?.result ?? null : null;
		const connector = await checkHttpHealth('http://127.0.0.1:20241/ready', 1_000);
		return { exists: Boolean(tunnel), status: tunnel ? 'ready' as const : 'pending' as const,
			live: { tunnel: tunnel ? { id: tunnel.id, name: tunnel.name, status: tunnel.status, connections: tunnel.connections?.length ?? 0 } : null,
				zoneId, dns: dns ? { id: dns.id, name: dns.name, content: dns.content, proxied: dns.proxied } : null,
				configuration: configuration ? { version: configuration.version, ingress: configuration.config?.ingress ?? [] } : null, connector,
				credentialSource: configured.credential.source }, locators: { tunnelId: tunnel?.id ?? null, dnsRecordId: dns?.id ?? null, zoneId: zoneId || null }, warnings };
	} catch (error) {
		return { exists: false, status: 'error' as const, live: {}, locators: {}, warnings: [...warnings, error instanceof Error ? error.message : String(error)] };
	}
}

export function buildCloudflareTunnelAdapter(): ReconcileAdapter {
	return {
		providerId: 'cloudflare', unitTypes: ['cloudflare-tunnel'],
		supports(unitType, providerId) { return unitType === 'cloudflare-tunnel' && providerId === 'cloudflare'; },
		validate(input) {
			const hostname = String(input.unit.spec.hostname ?? ''); const origin = String(input.unit.spec.originUrl ?? '');
			if (!/^[a-z0-9.-]+$/u.test(hostname) || !hostname.includes('.')) throw new Error('Local Tunnel requires a valid hostname.');
			if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(origin)) throw new Error('Local Tunnel origin must be an explicit loopback HTTP endpoint.');
			if (!Array.isArray(input.unit.spec.allowedPaths) || input.unit.spec.allowedPaths.length !== 6) throw new Error('Local Tunnel must declare exactly the provider setup, callback, and webhook paths.');
		},
		refresh: observe,
		diff(input) {
			const connectorAction = String(input.unit.spec.connectorAction ?? 'start');
			const connectorReady = (input.observed.live.connector as any)?.ok === true;
			if (connectorAction === 'stop') return connectorReady
				? { action: 'update', reasons: ['declared local Tunnel connector must stop while its provider resource remains configured'], before: input.observed.live, after: input.unit.spec }
				: noopDiff();
			if (input.observed.status === 'error') return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			if (!input.observed.exists) return { action: 'create', reasons: ['declared local provider Tunnel is missing'], before: input.observed.live, after: input.unit.spec };
			const desired = desiredIngress(input); const live = (input.observed.live.configuration as any)?.ingress ?? [];
			const tunnelId = input.observed.locators.tunnelId; const dns = input.observed.live.dns as any;
			const dnsReady = dns?.content === `${tunnelId}.cfargotunnel.com` && dns?.proxied === true;
			const restart = connectorAction === 'restart';
			return JSON.stringify(live) === JSON.stringify(desired) && dnsReady && connectorReady && !restart
				? noopDiff()
				: { action: 'update', reasons: [restart ? 'declared local Tunnel connector restart requested' : !connectorReady ? 'local Tunnel connector is not running' : 'Tunnel ingress or DNS differs from the declared callback-only route set'], before: input.observed.live, after: input.unit.spec };
		},
		async apply(input) {
			if (input.diff.action === 'blocked') return genericResult(input);
			if (input.unit.spec.connectorAction === 'stop') {
				await runManagedDevAction({ tenantRoot: input.context.tenantRoot, action: 'stop', surfaces: ['cloudflare-tunnel'], options: {}, env: input.context.launchEnv });
				return genericResult(input, { connector: 'stopped', remoteResourceRetained: true });
			}
			const configured = values(input);
			let tunnel: any = (input.observed.live as any).tunnel;
			try {
				if (!tunnel) tunnel = cloudflareApiRequest(`/accounts/${encodeURIComponent(configured.accountId)}/cfd_tunnel`, { method: 'POST', env: configured.env, body: { name: input.unit.spec.name, config_src: 'cloudflare' } })?.result;
			} catch (error) { throw tunnelMutationError(error, configured.credential.source); }
			if (!tunnel?.id) throw new Error('Cloudflare did not return the reconciled Tunnel ID.');
			cloudflareApiRequest(`/accounts/${encodeURIComponent(configured.accountId)}/cfd_tunnel/${encodeURIComponent(tunnel.id)}/configurations`, { method: 'PUT', env: configured.env, body: { config: { ingress: desiredIngress(input) } } });
			const zoneId = resolveZone(input, configured.env); if (!zoneId) throw new Error('Cloudflare zone for the Tunnel hostname is unavailable.');
			const hostname = String(input.unit.spec.hostname); const existingDns: any = findDns(zoneId, hostname, configured.env);
			const dnsBody = { type: 'CNAME', name: hostname, content: `${tunnel.id}.cfargotunnel.com`, proxied: true, ttl: 1 };
			cloudflareApiRequest(existingDns ? `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(existingDns.id)}` : `/zones/${encodeURIComponent(zoneId)}/dns_records`, { method: existingDns ? 'PUT' : 'POST', env: configured.env, body: dnsBody });
			const token = cloudflareApiRequest(`/accounts/${encodeURIComponent(configured.accountId)}/cfd_tunnel/${encodeURIComponent(tunnel.id)}/token`, { env: configured.env })?.result;
			if (typeof token !== 'string' || !token) throw new Error('Cloudflare did not return the connector token.');
			const managed = await runManagedDevAction({ tenantRoot: input.context.tenantRoot, action: input.unit.spec.connectorAction === 'restart' || input.diff.action === 'update' ? 'restart' : 'start', surfaces: ['cloudflare-tunnel'], options: {}, env: { ...input.context.launchEnv, TUNNEL_TOKEN: token } });
			return genericResult(input, { tunnel: { id: tunnel.id, name: tunnel.name }, zoneId, connector: managed.parsed });
		},
		async verify(input) {
			const live = await observe(input); const tunnel = live.live.tunnel as any; const dns = live.live.dns as any; const ready = await checkHttpHealth('http://127.0.0.1:20241/ready', 5_000);
			const connectorShouldRun = input.unit.spec.connectorAction !== 'stop';
			const checks = [
				verificationCheck('tunnel-live', 'Cloudflare reports the declared Tunnel', 'api', { exists: Boolean(tunnel), configured: Boolean(tunnel), ready: tunnel?.status === 'healthy', verified: tunnel?.status === 'healthy', observed: tunnel, issues: tunnel?.status === 'healthy' ? [] : ['Tunnel is not healthy.'] }),
				verificationCheck('tunnel-dns', 'Tunnel hostname resolves through the declared proxied CNAME', 'api', { exists: Boolean(dns), configured: dns?.proxied === true, ready: dns?.content === `${tunnel?.id}.cfargotunnel.com`, verified: dns?.proxied === true && dns?.content === `${tunnel?.id}.cfargotunnel.com`, observed: dns, issues: dns?.proxied === true && dns?.content === `${tunnel?.id}.cfargotunnel.com` ? [] : ['Tunnel DNS is missing or drifted.'] }),
				verificationCheck('tunnel-connector', connectorShouldRun ? 'Local cloudflared connector is ready' : 'Local cloudflared connector is stopped', 'api', { exists: connectorShouldRun ? ready.ok : true, configured: true, ready: connectorShouldRun ? ready.ok : !ready.ok, verified: connectorShouldRun ? ready.ok : !ready.ok, observed: ready, issues: (connectorShouldRun ? ready.ok : !ready.ok) ? [] : [connectorShouldRun ? 'Local cloudflared connector is not ready.' : 'Local cloudflared connector remained running.'] }),
			];
			return summarizeVerification(input.unit.unitId, checks, live.warnings);
		},
		async destroy(input) {
			await runManagedDevAction({ tenantRoot: input.context.tenantRoot, action: 'stop', surfaces: ['cloudflare-tunnel'], options: {}, env: input.context.launchEnv });
			if (input.unit.spec.preserveRemoteOnStop === true) return genericResult({ ...input, diff: { action: 'delete', reasons: ['stopped local Tunnel connector and retained its declared provider resource'], before: input.observed.live, after: input.unit.spec } });
			const configured = values(input); const tunnelId = input.observed.locators.tunnelId; const dnsId = input.observed.locators.dnsRecordId; const zoneId = input.observed.locators.zoneId;
			if (dnsId && zoneId) cloudflareApiRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(dnsId)}`, { method: 'DELETE', env: configured.env });
			if (tunnelId) cloudflareApiRequest(`/accounts/${encodeURIComponent(configured.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}`, { method: 'DELETE', env: configured.env });
			return genericResult({ ...input, diff: { action: 'delete', reasons: ['removed declared local provider Tunnel'], before: input.observed.live, after: {} } });
		},
		importOrAdopt(input) { return genericResult({ ...input, diff: { action: 'adopt', reasons: ['adopted matching Cloudflare Tunnel by declared name'], before: input.observed.live, after: input.unit.spec } }); },
	};
}
