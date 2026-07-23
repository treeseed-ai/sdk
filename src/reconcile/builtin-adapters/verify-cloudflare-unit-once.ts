import { buildCloudflarePagesFunctionBindings, cloudflareApiRequest, getTurnstileWidget, listTurnstileWidgets, loadDeployState, queueId, queueName } from "../../operations/services/deploy.ts";
import type { TreeseedReconcileAdapterInput, TreeseedUnitPostcondition, TreeseedUnitVerificationCheck, TreeseedUnitVerificationResult } from ".././contracts.ts";
import { isTransientCloudflareReconcileError, sleepMs, toDeployTarget } from './to-deploy-target.ts';
import { summarizeVerification, unsupportedVerification } from './summarize-verification.ts';
import { collectCloudflareEnvironmentSync, verificationCheck } from './first-railway-domain-string.ts';
import { cloudflareObservationSnapshot, findTurnstileWidget, mergeTurnstileWidget, normalizeTurnstileDomains, turnstileDomainsEqual } from './normalize-turnstile-domains.ts';
import { findCloudflareD1ByName, findCloudflareQueueByName, getCloudflareD1ById, getCloudflareKvById } from './build-workflow-meta-adapter.ts';

export function verifyCloudflareUnitOnce(input: TreeseedReconcileAdapterInput, postconditions: TreeseedUnitPostcondition[]): TreeseedUnitVerificationResult {
	if (input.unit.unitType === 'edge-worker') {
		const target = toDeployTarget(input.context.target);
		const state = loadDeployState(input.context.tenantRoot, input.context.deployConfig, { target });
		return summarizeVerification(input.unit.unitId, [
			verificationCheck('edge-worker.generated', 'Generated Cloudflare worker config exists for the web runtime', 'sdk', {
				exists: Boolean(state.workerName),
				expected: state.workerName ?? null,
				observed: state.workerName ?? null,
				issues: state.workerName ? [] : ['Generated Cloudflare worker runtime metadata is missing.'],
			}),
		]);
	}
	const snapshot = cloudflareObservationSnapshot(input, true);
	const { state, kvNamespaces, d1Databases, queues, buckets, pagesProjects, turnstileWidgets, env } = snapshot;
	switch (input.unit.unitType) {
		case 'queue': {
			const queue = input.unit.spec;
			const liveQueue = findCloudflareQueueByName(input, env, queue?.name, { attempts: 12, delayMs: 500 });
			const liveDlq = queue?.dlqName
				? findCloudflareQueueByName(input, env, queue.dlqName, { attempts: 12, delayMs: 500 })
				: null;
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('queue.exists', 'Queue exists by name and id', 'cli', {
					exists: Boolean(liveQueue && queueId(liveQueue)),
					expected: queue?.name ?? null,
					observed: liveQueue ? { name: queueName(liveQueue), id: queueId(liveQueue) } : null,
					issues: liveQueue && queueId(liveQueue) ? [] : [`Cloudflare queue ${queue?.name ?? '(unset)'} was not found after reconcile.`],
				}),
				verificationCheck('queue.dlq', 'Dead-letter queue exists by name and id', 'cli', {
					exists: !queue?.dlqName || Boolean(liveDlq && queueId(liveDlq)),
					expected: queue?.dlqName ?? null,
					observed: liveDlq ? { name: queueName(liveDlq), id: queueId(liveDlq) } : null,
					issues: !queue?.dlqName || (liveDlq && queueId(liveDlq)) ? [] : [`Cloudflare dead-letter queue ${queue.dlqName} was not found after reconcile.`],
				}),
				verificationCheck('queue.binding', 'Queue binding matches desired config', 'sdk', {
					exists: Boolean(queue?.binding),
					configured: queue?.binding === input.unit.spec.binding,
					expected: input.unit.spec.binding,
					observed: queue?.binding ?? null,
					issues: queue?.binding === input.unit.spec.binding ? [] : ['Configured queue binding does not match the desired value.'],
				}),
			], postconditions.length > 0 ? [] : []);
		}
		case 'database': {
			const db = state.d1Databases?.SITE_DATA_DB;
			const live = getCloudflareD1ById(env, db?.databaseId)
				?? findCloudflareD1ByName(input, env, db?.databaseName, { attempts: 12, delayMs: 500 });
			const liveDatabaseId = live?.uuid ?? live?.id ?? null;
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('database.exists', 'D1 database exists by name and id', 'cli', {
					exists: Boolean(liveDatabaseId),
					expected: db?.databaseName ?? null,
					observed: live ? { name: live.name, id: liveDatabaseId } : null,
					issues: liveDatabaseId ? [] : [`Cloudflare D1 database ${db?.databaseName ?? '(unset)'} was not found after reconcile.`],
				}),
				verificationCheck('database.binding', 'Database binding matches desired config', 'sdk', {
					exists: Boolean(db?.binding),
					configured: db?.binding === input.unit.spec.binding,
					expected: input.unit.spec.binding,
					observed: db?.binding ?? null,
					issues: db?.binding === input.unit.spec.binding ? [] : ['Configured D1 binding does not match the desired value.'],
				}),
			]);
		}
		case 'kv-form-guard': {
			const binding = 'FORM_GUARD_KV';
			const namespace = state.kvNamespaces?.[binding];
			const live = getCloudflareKvById(env, namespace?.id)
				?? kvNamespaces.find((entry) => entry?.title === namespace?.name);
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('kv.exists', 'KV namespace exists by title and id', 'cli', {
					exists: Boolean(live?.id),
					expected: namespace?.name ?? null,
					observed: live ? { title: live.title, id: live.id } : null,
					issues: live?.id ? [] : [`Cloudflare KV namespace ${namespace?.name ?? '(unset)'} was not found after reconcile.`],
				}),
				verificationCheck('kv.binding', 'KV binding matches desired config', 'sdk', {
					exists: Boolean(namespace?.binding),
					configured: namespace?.binding === input.unit.spec.binding,
					expected: input.unit.spec.binding,
					observed: namespace?.binding ?? null,
					issues: namespace?.binding === input.unit.spec.binding ? [] : ['Configured KV binding does not match the desired value.'],
				}),
			]);
		}
		case 'turnstile-widget': {
			const current = state.turnstileWidgets?.formGuard ?? {};
			const cachedLive = findTurnstileWidget(turnstileWidgets, current, input.unit.spec.name as string);
			const refreshedListedLive = findTurnstileWidget(
				listTurnstileWidgets(input.context.tenantRoot, env),
				current,
				input.unit.spec.name as string,
			);
			const refreshedLive = current.sitekey ? getTurnstileWidget(env, String(current.sitekey)) : null;
			const live = mergeTurnstileWidget(
				cachedLive,
				refreshedListedLive,
				refreshedLive,
			);
			const pagesHost = state.pages?.url ? new URL(state.pages.url).hostname : null;
			const desiredDomains = normalizeTurnstileDomains([
				...(Array.isArray(input.unit.spec.domains) ? input.unit.spec.domains : []),
				...(Array.isArray(current.domains) ? current.domains : []),
				pagesHost,
			]);
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('turnstile.exists', 'Turnstile widget exists by name and sitekey', 'api', {
					exists: Boolean(live?.sitekey),
					expected: input.unit.spec.name ?? null,
					observed: live ? { name: live.name, sitekey: live.sitekey } : null,
					issues: live?.sitekey ? [] : [`Cloudflare Turnstile widget ${String(input.unit.spec.name ?? '(unset)')} was not found after reconcile.`],
				}),
				verificationCheck('turnstile.mode', 'Turnstile widget mode is managed', 'api', {
					exists: Boolean(live?.sitekey),
					configured: live?.mode === 'managed',
					expected: 'managed',
					observed: live?.mode ?? null,
					issues: live?.mode === 'managed' ? [] : ['Turnstile widget mode does not match managed.'],
				}),
				verificationCheck('turnstile.domains', 'Turnstile widget domains match desired config', 'api', {
					exists: Boolean(live?.sitekey),
					configured: turnstileDomainsEqual(live?.domains, desiredDomains),
					expected: desiredDomains,
					observed: normalizeTurnstileDomains(live?.domains),
					issues: turnstileDomainsEqual(live?.domains, desiredDomains) ? [] : ['Turnstile widget domains do not match desired config.'],
				}),
			]);
		}
		case 'content-store': {
			const bucketName = state.content?.bucketName;
			const live = buckets.find((entry) => entry?.name === bucketName);
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('r2.exists', 'R2 bucket exists by name', 'cli', {
					exists: Boolean(live?.name),
					expected: bucketName ?? null,
					observed: live?.name ?? null,
					issues: live?.name ? [] : [`Cloudflare R2 bucket ${bucketName ?? '(unset)'} was not found after reconcile.`],
				}),
				verificationCheck('r2.binding', 'R2 binding matches desired config', 'sdk', {
					exists: Boolean(state.content?.r2Binding),
					configured: state.content?.r2Binding === input.unit.spec.binding,
					expected: input.unit.spec.binding,
					observed: state.content?.r2Binding ?? null,
					issues: state.content?.r2Binding === input.unit.spec.binding ? [] : ['Configured R2 binding does not match the desired value.'],
				}),
			]);
		}
		case 'pages-project': {
			const current = state.pages;
			const liveProject = pagesProjects.find((entry) => entry?.name === current?.projectName);
			if (!env.CLOUDFLARE_ACCOUNT_ID || !current?.projectName) {
				return unsupportedVerification(input.unit.unitId, 'Cloudflare Pages verification requires CLOUDFLARE_ACCOUNT_ID and a configured project name.');
			}
			const project = cloudflareApiRequest(
				`/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(current.projectName)}`,
				{ env, allowFailure: true },
			)?.result;
			const branchKey = input.context.target.kind === 'persistent' && input.context.target.scope === 'prod' ? 'production' : 'preview';
			const branchConfig = project?.deployment_configs?.[branchKey] ?? {};
			const envVars = branchConfig?.env_vars && typeof branchConfig.env_vars === 'object' ? branchConfig.env_vars : {};
			const pageBindings = buildCloudflarePagesFunctionBindings(state);
			const pageBindingConfigured = (configKey: string, binding: string, expected: Record<string, unknown>) => {
				const observed = branchConfig?.[configKey]?.[binding];
				return Boolean(observed && Object.entries(expected).every(([key, value]) => observed?.[key] === value));
			};
			const sync = collectCloudflareEnvironmentSync(input);
			const expectedVars = Object.entries(sync.vars).filter(([, value]) => typeof value === 'string' && value.length > 0);
			const checks: TreeseedUnitVerificationCheck[] = [
				verificationCheck('pages.exists', 'Pages project exists', 'cli', {
					exists: Boolean(liveProject?.name || project?.name),
					expected: current.projectName,
					observed: liveProject?.name ?? project?.name ?? null,
					issues: liveProject?.name || project?.name ? [] : [`Cloudflare Pages project ${current.projectName} was not found after reconcile.`],
				}),
			];
			if (input.context.target.kind === 'persistent' && input.context.target.scope === 'prod') {
				checks.push(verificationCheck('pages.production-branch', 'Pages production branch matches desired config', 'api', {
					exists: typeof project?.production_branch === 'string' && project.production_branch.length > 0,
					configured: (project?.production_branch ?? current.productionBranch ?? 'main') === (current.productionBranch ?? 'main'),
					expected: current.productionBranch ?? 'main',
					observed: project?.production_branch ?? null,
					issues: (project?.production_branch ?? current.productionBranch ?? 'main') === (current.productionBranch ?? 'main') ? [] : ['Pages production branch does not match the desired value.'],
				}));
			}
			for (const [name, expectedValue] of expectedVars) {
				checks.push(verificationCheck(`pages.var:${name}`, `Pages variable ${name} exists with the expected value`, 'api', {
					exists: Boolean(envVars[name]),
					configured: envVars[name]?.value === expectedValue,
					expected: expectedValue,
					observed: envVars[name]?.value ?? null,
					issues: envVars[name]?.value === expectedValue ? [] : [`Pages variable ${name} does not match the expected value for ${branchKey}.`],
				}));
			}
			for (const name of sync.secretNames) {
				checks.push(verificationCheck(`pages.secret:${name}`, `Pages secret ${name} exists`, 'api', {
					exists: Boolean(envVars[name]),
					expected: true,
					observed: Boolean(envVars[name]),
					issues: envVars[name] ? [] : [`Pages secret ${name} is missing from the ${branchKey} deployment config.`],
				}));
			}
			for (const [binding, expected] of Object.entries(pageBindings.kv_namespaces ?? {})) {
				checks.push(verificationCheck(`pages.kv:${binding}`, `Pages KV binding ${binding} points at the expected namespace`, 'api', {
					exists: Boolean(branchConfig?.kv_namespaces?.[binding]),
					configured: pageBindingConfigured('kv_namespaces', binding, expected),
					expected,
					observed: branchConfig?.kv_namespaces?.[binding] ?? null,
					issues: pageBindingConfigured('kv_namespaces', binding, expected) ? [] : [`Pages KV binding ${binding} is missing or points at the wrong namespace for ${branchKey}.`],
				}));
			}
			for (const [binding, expected] of Object.entries(pageBindings.d1_databases ?? {})) {
				checks.push(verificationCheck(`pages.d1:${binding}`, `Pages D1 binding ${binding} points at the expected database`, 'api', {
					exists: Boolean(branchConfig?.d1_databases?.[binding]),
					configured: pageBindingConfigured('d1_databases', binding, expected),
					expected,
					observed: branchConfig?.d1_databases?.[binding] ?? null,
					issues: pageBindingConfigured('d1_databases', binding, expected) ? [] : [`Pages D1 binding ${binding} is missing or points at the wrong database for ${branchKey}.`],
				}));
			}
			for (const [binding, expected] of Object.entries(pageBindings.r2_buckets ?? {})) {
				checks.push(verificationCheck(`pages.r2:${binding}`, `Pages R2 binding ${binding} points at the expected bucket`, 'api', {
					exists: Boolean(branchConfig?.r2_buckets?.[binding]),
					configured: pageBindingConfigured('r2_buckets', binding, expected),
					expected,
					observed: branchConfig?.r2_buckets?.[binding] ?? null,
					issues: pageBindingConfigured('r2_buckets', binding, expected) ? [] : [`Pages R2 binding ${binding} is missing or points at the wrong bucket for ${branchKey}.`],
				}));
			}
			return summarizeVerification(input.unit.unitId, checks);
		}
		default:
			return unsupportedVerification(input.unit.unitId, `Cloudflare unit type ${input.unit.unitType} does not declare verification logic.`);
	}
}

export function verifyCloudflareUnit(input: TreeseedReconcileAdapterInput, postconditions: TreeseedUnitPostcondition[]): TreeseedUnitVerificationResult {
	let attempt = 0;
	for (;;) {
		try {
			return verifyCloudflareUnitOnce(input, postconditions);
		} catch (error) {
			if (attempt >= 2 || !isTransientCloudflareReconcileError(error)) {
				throw error;
			}
			attempt += 1;
			sleepMs(500 * attempt);
		}
	}
}
