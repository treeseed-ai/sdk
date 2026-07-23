import { resolveCloudflareZoneIdForHost } from "../../operations/services/deploy.ts";
import { ensureRailwayCustomDomain, deleteRailwayCustomDomain, listRailwayCustomDomains, listRailwayServices } from "../../operations/services/railway-api.ts";
import type { TreeseedReconcileAdapterInput, TreeseedReconcileResult, TreeseedReconcileUnitDiff, TreeseedUnitVerificationResult } from ".././contracts.ts";
import { buildCloudflareEnv } from './build-workflow-meta-adapter.ts';
import { dnsRecordContentMatches, dnsRecordIdentityMatches, dnsRecordMatches, dnsRecordProxiedMatches, dnsRecordsFromCurrentResult, ensureCloudflareDnsRecord, ensureCloudflarePagesDomain, getCloudflarePagesDomain, listCloudflareDnsRecords, storeCustomDomainState } from './normalize-turnstile-domains.ts';
import { summarizeVerification, unsupportedVerification } from './summarize-verification.ts';
import { observeRailwayCustomDomainLive, verificationCheck } from './first-railway-domain-string.ts';
import { observeCustomDomainUnit, observeDnsRecordUnit, resolveDesiredDnsRecords } from './capacity-provider-variables-for-service.ts';
import { findRailwayTopologyEntry, resolveRailwayUnitTopology } from './railway-verification-may-settle.ts';
import { traceRailwayReconcile } from './resolve-railway-topology-for-scope.ts';
import { isTransientCloudflareReconcileError, sleepMs } from './to-deploy-target.ts';

export async function verifyCustomDomainUnit(input: TreeseedReconcileAdapterInput): Promise<TreeseedUnitVerificationResult> {
	switch (input.unit.unitType) {
		case 'custom-domain:web': {
			const domain = String(input.unit.spec.domain ?? '').trim();
			const projectName = String(input.unit.spec.projectName ?? '').trim();
			const env = buildCloudflareEnv(input);
			const live = domain && projectName ? getCloudflarePagesDomain(env, projectName, domain) : null;
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('custom-domain.exists', 'Pages custom domain attachment exists', 'api', {
					exists: Boolean(live?.name || live?.domain),
					expected: domain || null,
					observed: live?.name ?? live?.domain ?? null,
					issues: live?.name || live?.domain ? [] : [`Cloudflare Pages custom domain ${domain || '(unset)'} is missing.`],
				}),
			]);
		}
		case 'custom-domain:api': {
			const domain = String(input.unit.spec.domain ?? '').trim();
			const live = await observeRailwayCustomDomainLive(input, domain);
			const dnsRecords = Array.isArray(live?.dnsRecords) ? live.dnsRecords : [];
			const certificateStatus = typeof live?.certificateStatus === 'string'
				? live.certificateStatus.trim().toUpperCase()
				: null;
			const verified = live?.verified === true;
			const hasDnsRequirements = dnsRecords.length > 0
				|| (typeof live?.serviceDomain === 'string' && live.serviceDomain.trim().length > 0)
				|| (typeof live?.verificationDnsHost === 'string' && live.verificationDnsHost.trim().length > 0
					&& typeof live?.verificationToken === 'string' && live.verificationToken.trim().length > 0);
			const certificateFailed = certificateStatus ? /FAILED|ERROR|MISSING/u.test(certificateStatus) : false;
			const certificatePending = certificateStatus ? /VALIDATING|ISSUING|GENERATING|PENDING/u.test(certificateStatus) : false;
			const certificateReady = verified && !certificateFailed && !certificatePending;
			const certificateAcceptable = certificateReady || (hasDnsRequirements && certificatePending);
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('custom-domain.exists', 'Railway custom domain attachment exists', 'cli', {
					exists: Boolean(live?.domain),
					expected: domain || null,
					observed: typeof live?.domain === 'string' ? live.domain : null,
					issues: live?.domain ? [] : [`Railway custom domain ${domain || '(unset)'} is missing.`],
				}),
				verificationCheck('custom-domain.service', 'Railway custom domain is attached to the desired service', 'api', {
					exists: Boolean(live?.serviceId),
					configured: String(live?.serviceName ?? '') === String(input.unit.spec.serviceName ?? ''),
					expected: input.unit.spec.serviceName ?? null,
					observed: live?.serviceName ?? null,
					issues: String(live?.serviceName ?? '') === String(input.unit.spec.serviceName ?? '')
						? []
						: [`Railway custom domain ${domain || '(unset)'} is not attached to ${String(input.unit.spec.serviceName ?? '(unset service)')}.`],
				}),
				verificationCheck('custom-domain.dns-requirements', 'Railway custom domain exposes DNS requirements', 'api', {
					exists: hasDnsRequirements,
					expected: true,
					observed: dnsRecords.length > 0 ? dnsRecords.length : {
						serviceDomain: typeof live?.serviceDomain === 'string' ? live.serviceDomain : null,
						verificationDnsHost: typeof live?.verificationDnsHost === 'string' ? live.verificationDnsHost : null,
					},
					issues: hasDnsRequirements ? [] : [`Railway custom domain ${domain || '(unset)'} did not expose DNS requirements.`],
				}),
				verificationCheck('custom-domain.certificate', 'Railway custom domain certificate is issued or pending provider validation', 'api', {
					exists: Boolean(live?.domain),
					ready: certificateAcceptable,
					verified: certificateAcceptable,
					expected: {
						verified: true,
						certificateStatus: 'issued or provider validation pending with DNS requirements',
					},
					observed: {
						verified,
						certificateStatus,
						hasDnsRequirements,
					},
					issues: certificateAcceptable ? [] : [`Railway custom domain ${domain || '(unset)'} certificate is not ready (verified=${verified}, status=${certificateStatus ?? '(unknown)'}).`],
				}),
			]);
		}
		default:
			return unsupportedVerification(input.unit.unitId, `Unsupported custom-domain unit type ${input.unit.unitType}.`);
	}
}

export function verifyDnsRecordUnit(input: TreeseedReconcileAdapterInput): TreeseedUnitVerificationResult {
	const env = buildCloudflareEnv(input);
	const domain = String(input.unit.spec.domain ?? '').trim();
	const zoneId = domain ? resolveCloudflareZoneIdForHost(input.context.deployConfig, domain, env) : null;
	const desiredRecords = resolveDesiredDnsRecords(input);
	if (!zoneId) {
		return unsupportedVerification(input.unit.unitId, `Cloudflare DNS zone could not be resolved for ${domain || '(unset)'}.`);
	}
	if (desiredRecords.length === 0 && input.unit.spec.targetKind === 'railway-service') {
		return summarizeVerification(input.unit.unitId, [
			verificationCheck('dns-record.requirements', 'Railway custom domain exposes DNS requirements', 'api', {
				exists: false,
				expected: true,
				observed: 0,
				issues: [`Railway custom domain ${domain || '(unset)'} did not expose DNS requirements, so Cloudflare DNS records could not be created.`],
			}),
		]);
	}
	const checks = desiredRecords.map((record, index) => {
		const live = listCloudflareDnsRecords(env, zoneId, record.name)
			.find((entry) => dnsRecordIdentityMatches(entry, record)) ?? null;
		const reconciled = dnsRecordsFromCurrentResult(input).find((entry) =>
			dnsRecordIdentityMatches(entry, record),
		) ?? null;
		const effective = dnsRecordMatches(live, record) ? live : reconciled ?? live;
		const contentMatches = dnsRecordContentMatches(effective?.content, record.content, record.type);
		const proxiedMatches = dnsRecordProxiedMatches(effective, record);
		return verificationCheck(`dns-record:${index + 1}`, `DNS record ${record.type} ${record.name} matches the desired value`, 'api', {
			exists: Boolean(effective?.id),
			configured: contentMatches && proxiedMatches,
			expected: `${record.type} ${record.name} -> ${record.content}${record.proxied === undefined ? '' : ` proxied=${record.proxied}`}`,
			observed: effective ? `${effective.type} ${effective.name} -> ${effective.content}${typeof effective.proxied === 'boolean' ? ` proxied=${effective.proxied}` : ''}` : null,
			issues: effective?.id
				? ((contentMatches && proxiedMatches) ? [] : [`DNS record ${record.name} does not match the expected value.`])
				: [`DNS record ${record.type} ${record.name} is missing.`],
		});
	});
	return summarizeVerification(input.unit.unitId, checks);
}

export async function reconcileCustomDomainUnit(input: TreeseedReconcileAdapterInput, diff: TreeseedReconcileUnitDiff): Promise<TreeseedReconcileResult> {
	switch (input.unit.unitType) {
		case 'custom-domain:web': {
			const env = buildCloudflareEnv(input);
			const domain = String(input.unit.spec.domain ?? '').trim();
			const projectName = String(input.unit.spec.projectName ?? '').trim();
			const state = ensureCloudflarePagesDomain(env, projectName, domain) ?? { domain };
			storeCustomDomainState(input, 'cloudflare', domain, state);
			const observed = await observeCustomDomainUnit(input);
			return {
				unit: input.unit,
				observed,
				diff,
				action: diff.action === 'create' || diff.action === 'update' ? 'update' : diff.action,
				warnings: observed.warnings,
				resourceLocators: observed.locators,
				state,
				verification: null,
			};
		}
		case 'custom-domain:api': {
			const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
			const domain = String(input.unit.spec.domain ?? '').trim();
			const serviceKey = String(input.unit.metadata.serviceKey ?? 'api').trim();
			const topology = await resolveRailwayUnitTopology(input, scope, {
				refresh: false,
				includeInstances: false,
				includeVariables: false,
				cacheSuffix: 'post-apply',
			});
			const entry = findRailwayTopologyEntry(topology, serviceKey);
			if (!entry?.project?.id || !entry.environment?.id || !entry.service?.id || !domain) {
				throw new Error(`Railway custom domain reconciliation could not resolve ${domain || '(unset domain)'} and its desired service.`);
			}
			const projectServices = await listRailwayServices({ projectId: entry.project.id, env: topology.env });
			const detachedServiceIds: string[] = [];
			for (const candidate of projectServices) {
				if (candidate.id === entry.service.id) continue;
				const domains = await listRailwayCustomDomains({
					projectId: entry.project.id,
					environmentId: entry.environment.id,
					serviceId: candidate.id,
					env: topology.env,
				}).catch(() => []);
				for (const stale of domains.filter((candidateDomain) => candidateDomain.domain === domain)) {
					if (!stale.id) throw new Error(`Railway custom domain ${domain} is attached to ${candidate.name} but has no provider id for safe transfer.`);
					traceRailwayReconcile(topology.env, 'sync:custom-domain:detach-stale', `${domain}:${candidate.name}`);
					await deleteRailwayCustomDomain({
						projectId: entry.project.id,
						environmentId: entry.environment.id,
						serviceId: candidate.id,
						domainId: stale.id,
						env: topology.env,
					});
					detachedServiceIds.push(candidate.id);
				}
			}
			for (const detachedServiceId of detachedServiceIds) {
				let stillAttached = true;
				for (let detachAttempt = 0; detachAttempt < 12 && stillAttached; detachAttempt += 1) {
					const domains = await listRailwayCustomDomains({
						projectId: entry.project.id,
						environmentId: entry.environment.id,
						serviceId: detachedServiceId,
						env: topology.env,
					});
					stillAttached = domains.some((candidateDomain) => candidateDomain.domain === domain);
					if (stillAttached) sleepMs(2_000);
				}
				if (stillAttached) {
					throw new Error(`Railway custom domain ${domain} remained attached to stale service ${detachedServiceId} after deletion.`);
				}
			}
			await ensureRailwayCustomDomain({
				projectId: entry.project.id,
				environmentId: entry.environment.id,
				serviceId: entry.service.id,
				domain,
				env: topology.env,
			});
			let observed = await observeCustomDomainUnit(input);
			for (let domainAttempt = 0; domainAttempt < 12 && (!observed.exists || observed.locators.serviceId !== entry.service.id); domainAttempt += 1) {
				sleepMs(2_000);
				observed = await observeCustomDomainUnit(input);
			}
			if (!observed.exists || observed.locators.serviceId !== entry.service.id) {
				throw new Error(`Railway did not attach custom domain ${domain} to ${entry.service.name}.`);
			}
			return {
				unit: input.unit,
				observed,
				diff,
				action: diff.action === 'create' || diff.action === 'update' ? 'update' : diff.action,
				warnings: observed.warnings,
				resourceLocators: observed.locators,
				state: observed.live,
				verification: null,
			};
		}
		default:
			throw new Error(`Unsupported custom-domain unit type ${input.unit.unitType}.`);
	}
}

export function reconcileDnsRecordUnit(input: TreeseedReconcileAdapterInput, diff: TreeseedReconcileUnitDiff): TreeseedReconcileResult {
	let attempt = 0;
	for (;;) {
		try {
			const env = buildCloudflareEnv(input);
			const domain = String(input.unit.spec.domain ?? '').trim();
			const zoneId = resolveCloudflareZoneIdForHost(input.context.deployConfig, domain, env);
			if (!zoneId) {
				throw new Error(`Cloudflare DNS zone could not be resolved for ${domain || '(unset)'}.`);
			}
			const desiredRecords = resolveDesiredDnsRecords(input);
			const created = desiredRecords.map((record) => ensureCloudflareDnsRecord(env, zoneId, record));
			const observed = observeDnsRecordUnit(input);
			return {
				unit: input.unit,
				observed,
				diff,
				action: diff.action === 'create' || diff.action === 'update' ? 'update' : diff.action,
				warnings: observed.warnings,
				resourceLocators: observed.locators,
				state: {
					zoneId,
					records: created,
				},
				verification: null,
			};
		} catch (error) {
			if (attempt >= 2 || !isTransientCloudflareReconcileError(error)) {
				throw error;
			}
			attempt += 1;
			sleepMs(500 * attempt);
		}
	}
}
