import { buildProvisioningSummary, cloudflareApiRequest, createTurnstileWidget, hasProvisionedCloudflareResources, isWranglerAlreadyExistsError, listD1Databases, listKvNamespaces, listPagesProjects, listQueues, listR2Buckets, listTurnstileWidgets, loadDeployState, reconcileCloudflareWebCacheRules, runWrangler, updateTurnstileWidget, writeDeployState } from "../../../operations/services/hosting/deployment/deploy.ts";
import type { ReconcileAdapterInput } from "../../support/contracts/contracts.ts";
import { nowIso, toDeployTarget } from '../hosting/to-deploy-target.ts';
import { buildCloudflareEnv, findCloudflareD1ByName, getCloudflareD1ById, getCloudflareKvById, hasLiveResourceId } from './build-workflow-meta-adapter.ts';
import { findTurnstileWidget, normalizeTurnstileDomains, turnstileDomainsEqual } from '../support/normalize-turnstile-domains.ts';
import { collectCloudflareEnvironmentSync } from '../hosting/first-railway-domain-string.ts';

export function reconcileCloudflareTarget(input: ReconcileAdapterInput, { planOnly = false } = {}) {
	const target = toDeployTarget(input.context.target);
	const deployConfig = input.context.deployConfig;
	const state = loadDeployState(input.context.tenantRoot, deployConfig, { target });
	const env = buildCloudflareEnv(input);
	const kvNamespaces = planOnly ? [] : listKvNamespaces(input.context.tenantRoot, env);
	const d1Databases = planOnly ? [] : listD1Databases(input.context.tenantRoot, env);
	const queues = planOnly ? [] : listQueues(input.context.tenantRoot, env);
	const buckets = planOnly ? [] : listR2Buckets(input.context.tenantRoot, env);
	const pagesProjects = planOnly ? [] : listPagesProjects(input.context.tenantRoot, env);
	const turnstileWidgets = planOnly ? [] : listTurnstileWidgets(input.context.tenantRoot, env);
	const runStep = <T>(label: string, fn: () => T): T => {
		try {
			return fn();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? '');
			throw new Error(`Cloudflare reconcile step ${label} failed: ${message}`);
		}
	};

	const ensureKv = (binding) => {
		const current = state.kvNamespaces[binding];
		if (hasLiveResourceId(current?.id)) {
			const liveById = getCloudflareKvById(env, current.id);
			if (liveById?.id) {
				state.kvNamespaces[binding].previewId = current.previewId ?? current.id;
				return;
			}
		}
		const existing = kvNamespaces.find((entry) => entry?.title === current.name);
		if (existing?.id) {
			state.kvNamespaces[binding].id = existing.id;
			state.kvNamespaces[binding].previewId = existing.id;
			return;
		}
		if (planOnly) {
			state.kvNamespaces[binding].id = `plan-${current.name}`;
			state.kvNamespaces[binding].previewId = `plan-${current.name}`;
			return;
		}
		runWrangler(['kv', 'namespace', 'create', current.name], {
			cwd: input.context.tenantRoot,
			capture: true,
			env,
		});
		const created = listKvNamespaces(input.context.tenantRoot, env).find((entry) => entry?.title === current.name);
		if (!created?.id) {
			throw new Error(`Unable to resolve created KV namespace id for ${current.name}.`);
		}
		state.kvNamespaces[binding].id = created.id;
		state.kvNamespaces[binding].previewId = created.id;
	};

	const ensureD1 = () => {
		const current = state.d1Databases.SITE_DATA_DB;
		if (hasLiveResourceId(current?.databaseId)) {
			const liveById = getCloudflareD1ById(env, current.databaseId);
			if (liveById?.uuid || liveById?.id) {
				current.previewDatabaseId = current.previewDatabaseId ?? current.databaseId;
				return;
			}
		}
		const existing = d1Databases.find((entry) => entry?.name === current.databaseName);
		if (existing?.uuid) {
			current.databaseId = existing.uuid;
			current.previewDatabaseId = existing.previewDatabaseUuid ?? existing.uuid;
			return;
		}
		if (planOnly) {
			current.databaseId = `plan-${current.databaseName}`;
			current.previewDatabaseId = `plan-${current.databaseName}`;
			return;
		}
		try {
			const created = cloudflareApiRequest(`/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/d1/database`, {
				method: 'POST',
				env,
				body: {
					name: current.databaseName,
				},
			})?.result;
			if (created?.uuid) {
				current.databaseId = created.uuid;
				current.previewDatabaseId = created.previewDatabaseUuid ?? created.uuid;
				return;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/already exists/i.test(message)) {
				throw error;
			}
		}
		const created = findCloudflareD1ByName(input, env, current.databaseName, { attempts: 12, delayMs: 500 });
		if (!created?.uuid) {
			throw new Error(`Unable to resolve created D1 database id for ${current.databaseName}.`);
		}
		current.databaseId = created.uuid;
		current.previewDatabaseId = created.previewDatabaseUuid ?? created.uuid;
	};

		const ensureR2Bucket = () => {
		const bucketName = state.content?.bucketName;
		if (!bucketName) {
			return;
		}
		let refreshedBuckets = buckets;
		const existing = refreshedBuckets.find((entry) => entry?.name === bucketName);
		if (existing || planOnly) {
			return;
		}
		try {
			runWrangler(['r2', 'bucket', 'create', bucketName], {
				cwd: input.context.tenantRoot,
				capture: true,
				env,
			});
		} catch (error) {
			if (!isWranglerAlreadyExistsError(error, [/bucket you tried to create already exists, and you own it/i, /\[code:\s*10004\]/i])) {
				throw error;
			}
		}
		refreshedBuckets = listR2Buckets(input.context.tenantRoot, env);
	};

	const ensurePagesProject = () => {
		const current = state.pages;
		if (!current?.projectName) {
			return;
		}
		const existing = pagesProjects.find((entry) => entry?.name === current.projectName);
		if (existing) {
			if (!planOnly && (existing.production_branch ?? 'main') !== (current.productionBranch ?? 'main')) {
				cloudflareApiRequest(
					`/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(current.projectName)}`,
					{
						method: 'PATCH',
						env,
						body: {
							production_branch: current.productionBranch ?? 'main',
						},
					},
				);
			}
			current.url = existing.subdomain ? `https://${existing.subdomain}` : current.url ?? `https://${current.projectName}.pages.dev`;
			return;
		}
		if (planOnly) {
			current.url = `https://${current.projectName}.pages.dev`;
			return;
		}
		try {
			runWrangler([
				'pages',
				'project',
				'create',
				current.projectName,
				'--production-branch',
				current.productionBranch ?? 'main',
			], {
				cwd: input.context.tenantRoot,
				capture: true,
				env,
			});
		} catch (error) {
			if (!isWranglerAlreadyExistsError(error, [/A project with this name already exists/i, /\[code:\s*8000002\]/i])) {
				throw error;
			}
		}
		current.url = `https://${current.projectName}.pages.dev`;
	};

	const ensureTurnstileWidget = () => {
		if (deployConfig.turnstile?.enabled !== true) {
			return;
		}
		const current = state.turnstileWidgets?.formGuard;
		if (!current?.name) {
			return;
		}
		const pagesHost = state.pages?.url ? new URL(state.pages.url).hostname : null;
		const desiredDomains = normalizeTurnstileDomains([
			...(Array.isArray(current.domains) ? current.domains : []),
			pagesHost,
		]);
		current.domains = desiredDomains;
		current.mode = 'managed';
		current.managed = true;
		const existing = findTurnstileWidget(turnstileWidgets, current, current.name);
		if (planOnly) {
			current.sitekey = current.sitekey ?? `plan-${current.name}-sitekey`;
			current.secret = current.secret ?? `plan-${current.name}-secret`;
			current.lastSyncedAt = nowIso();
			return;
		}
		if (existing?.sitekey) {
			const needsUpdate = existing.name !== current.name
				|| existing.mode !== 'managed'
				|| !turnstileDomainsEqual(existing.domains, desiredDomains);
			const updated = needsUpdate
				? updateTurnstileWidget(env, String(existing.sitekey), {
					name: current.name,
					domains: desiredDomains,
					mode: 'managed',
				})
				: existing;
			current.sitekey = String(updated?.sitekey ?? existing.sitekey);
			current.secret = String(updated?.secret ?? current.secret ?? '');
			current.lastSyncedAt = nowIso();
			return;
		}
		const created = createTurnstileWidget(env, {
			name: current.name,
			domains: desiredDomains,
			mode: 'managed',
		});
		if (!created?.sitekey || !created?.secret) {
			throw new Error(`Unable to resolve created Turnstile widget keys for ${current.name}.`);
		}
		current.sitekey = String(created.sitekey);
		current.secret = String(created.secret);
		current.lastSyncedAt = nowIso();
	};

	runStep('kv-form-guard', () => ensureKv('FORM_GUARD_KV'));
	runStep('d1', ensureD1);
	runStep('r2', ensureR2Bucket);
	runStep('pages', ensurePagesProject);
	runStep('turnstile-widget', ensureTurnstileWidget);
	runStep('web-cache', () => reconcileCloudflareWebCacheRules(input.context.tenantRoot, deployConfig, state, target, { planOnly, env }));
	state.readiness.configured = true;
	state.readiness.provisioned = hasProvisionedCloudflareResources(state);
	state.readiness.deployable = state.readiness.provisioned === true;
	state.readiness.phase = state.readiness.provisioned === true ? 'provisioned' : 'config_complete';
	state.readiness.initialized = true;
	state.readiness.initializedAt = new Date().toISOString();
	state.readiness.lastValidatedAt = state.readiness.initializedAt;
	state.readiness.blockers = [];
	state.readiness.warnings = [];
	state.readiness.lastValidationSummary = {
		cloudflare: state.readiness.provisioned === true ? 'ready' : 'incomplete',
		railway: 'configured',
	};
	writeDeployState(input.context.tenantRoot, state, { target });
	return { state, summary: buildProvisioningSummary(deployConfig, state, target) };
}

export function syncCloudflareSecretsForTarget(input: ReconcileAdapterInput, { planOnly = false } = {}) {
	const target = toDeployTarget(input.context.target);
	const deployConfig = input.context.deployConfig;
	const state = loadDeployState(input.context.tenantRoot, deployConfig, { target });
	const { secrets } = collectCloudflareEnvironmentSync(input);
	const synced = [];
	for (const [key, value] of Object.entries(secrets)) {
		if (!value) {
			continue;
		}
		synced.push(key);
	}
	state.generatedSecrets = {
		...(state.generatedSecrets ?? {}),
		FORM_TOKEN_SECRET: secrets.FORM_TOKEN_SECRET ?? state.generatedSecrets?.FORM_TOKEN_SECRET,
		TREESEED_EDITORIAL_PREVIEW_SECRET: secrets.TREESEED_EDITORIAL_PREVIEW_SECRET ?? state.generatedSecrets?.TREESEED_EDITORIAL_PREVIEW_SECRET,
	};
	writeDeployState(input.context.tenantRoot, state, { target });
	return synced;
}
