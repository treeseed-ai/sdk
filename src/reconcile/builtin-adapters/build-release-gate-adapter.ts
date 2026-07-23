import type { TreeseedReconcileAdapter, TreeseedReconcileAdapterInput, TreeseedUnitVerificationResult, TreeseedReconcileUnitType } from ".././contracts.ts";
import { findTreeseedPackageAdapter } from "../../operations/services/package-adapters.ts";
import { dispatchReconcileGitHubWorkflow } from ".././providers/github-private.ts";
import { ensureTemplateReleaseTag, runHostedReconcileGate, runHostedVerifyGate, runReleaseVerifyCommand, runTemplateReleaseVerifyCommand, writeReleaseRecord } from ".././providers/release-private.ts";
import { checkedOutTemplateRepositories } from "../../operations/services/managed-repositories.ts";
import { genericObservedState, genericResult, noopDiff, nowIso } from './to-deploy-target.ts';
import { buildGitHubEnv, workflowName } from './build-graph-only-adapter.ts';
import { verificationCheck } from './first-railway-domain-string.ts';
import { summarizeVerification } from './summarize-verification.ts';

export function buildReleaseGateAdapter(): TreeseedReconcileAdapter {
	const unitTypes: TreeseedReconcileUnitType[] = [
		'release-gate:verify',
		'release-gate:template-verify',
		'release-gate:template-release-record',
		'release-gate:npm-publish',
		'release-gate:image-publish',
		'release-gate:hosted-reconcile',
		'release-gate:live-verify',
		'release-gate:candidate-record',
		'release-gate:production-record',
	];
	return {
		providerId: 'treeseed',
		unitTypes,
		supports(unitType, providerId) {
			return providerId === 'treeseed' && unitTypes.includes(unitType);
		},
		refresh(input) {
			const fingerprint = typeof input.unit.spec.fingerprint === 'string' ? input.unit.spec.fingerprint : null;
			const previousFingerprint = typeof input.persistedState?.lastReconciledState?.fingerprint === 'string'
				? input.persistedState.lastReconciledState.fingerprint
				: null;
			return {
				...genericObservedState(input),
				status: fingerprint && previousFingerprint === fingerprint ? 'ready' : 'pending',
				live: {
					...input.unit.spec,
					previousFingerprint,
					fingerprint,
				},
			};
		},
		diff(input) {
			return input.observed.status === 'ready'
				? noopDiff()
				: { action: 'update', reasons: ['release gate fingerprint has not been reconciled'], before: input.observed.live, after: input.unit.spec };
		},
		async apply(input) {
			if (input.diff.action === 'noop') return genericResult(input);
			const gateKind = String(input.unit.spec.gateKind ?? input.unit.unitType);
			const packageId = typeof input.unit.spec.packageId === 'string' ? input.unit.spec.packageId : null;
			const templateId = typeof input.unit.spec.templateId === 'string' ? input.unit.spec.templateId : null;
			if (process.env.TREESEED_WORKFLOW_RELEASE_GATES_MODE === 'skip') {
				return genericResult(input, {
					...input.observed.live,
					gateKind,
					packageId,
					templateId,
					skipped: true,
					reason: 'disabled',
					fingerprint: input.unit.spec.fingerprint,
				});
			}
			if (gateKind === 'release-gate:verify' && packageId) {
				const verify = await runReleaseVerifyCommand({ tenantRoot: input.context.tenantRoot, packageId, env: input.context.launchEnv });
				if (verify.ok !== true) {
					throw new Error([verify.stderr, verify.stdout].filter(Boolean).join('\n').trim() || `${packageId} release verification failed`);
				}
				return genericResult(input, { ...input.observed.live, verify, fingerprint: input.unit.spec.fingerprint });
			}
			if (gateKind === 'release-gate:template-verify' && templateId) {
				const verify = runTemplateReleaseVerifyCommand({ tenantRoot: input.context.tenantRoot, templateId, env: input.context.launchEnv });
				if (verify.ok !== true) {
					throw new Error([verify.stderr, verify.stdout].filter(Boolean).join('\n').trim() || `${templateId} template release verification failed`);
				}
				return genericResult(input, { ...input.observed.live, verify, fingerprint: input.unit.spec.fingerprint });
			}
			if (gateKind === 'release-gate:template-release-record' && templateId) {
				const releaseTag = typeof input.unit.spec.releaseTag === 'string' ? input.unit.spec.releaseTag : null;
				const tag = releaseTag && input.context.target.kind === 'persistent' && input.context.target.scope === 'prod'
					? ensureTemplateReleaseTag({ tenantRoot: input.context.tenantRoot, templateId, tagName: releaseTag })
					: null;
				const recordPath = typeof input.unit.spec.recordPath === 'string'
					? input.unit.spec.recordPath
					: `.treeseed/templates/${templateId}/latest-release.json`;
				const template = checkedOutTemplateRepositories(input.context.tenantRoot)
					.find((candidate) => candidate.templateManifest?.id === templateId);
				const record = writeReleaseRecord({
					tenantRoot: input.context.tenantRoot,
					recordPath,
					record: {
						schemaVersion: 1,
						kind: gateKind,
						templateId,
						releaseTag,
						tag,
						environment: input.unit.spec.environment ?? null,
						version: template?.templateManifest?.version ?? null,
						recordedAt: nowIso(),
					},
				});
				return genericResult(input, { ...input.observed.live, record, tag, fingerprint: input.unit.spec.fingerprint });
			}
			if ((gateKind === 'release-gate:npm-publish' || gateKind === 'release-gate:image-publish') && packageId) {
				const adapter = findTreeseedPackageAdapter(input.context.tenantRoot, packageId);
				const repository = typeof adapter?.metadata.repository === 'string' ? adapter.metadata.repository : null;
				if (!repository) {
					throw new Error(`${packageId} does not declare a GitHub repository.`);
				}
				const workflow = gateKind === 'release-gate:image-publish'
					? workflowName(adapter?.metadata.developmentImageWorkflow, 'publish.yml')
					: workflowName(adapter?.metadata.hostedVerifyWorkflow, 'publish.yml');
				const dispatch = await dispatchReconcileGitHubWorkflow({
					repository,
					workflow,
					branch: input.context.target.kind === 'persistent' && input.context.target.scope === 'prod' ? 'main' : 'staging',
					inputs: {},
					wait: input.context.target.kind === 'persistent' && input.context.target.scope === 'prod',
					env: buildGitHubEnv(input),
				});
				return genericResult(input, { ...input.observed.live, dispatch, fingerprint: input.unit.spec.fingerprint });
			}
			if (gateKind === 'release-gate:hosted-reconcile') {
				const environment = input.unit.spec.environment === 'prod' ? 'prod' : 'staging';
				const selector = typeof input.unit.spec.hostedSelector === 'object' && input.unit.spec.hostedSelector
					? input.unit.spec.hostedSelector as any
					: { environment, provider: ['cloudflare', 'railway', 'github', 'dockerhub'] };
				const nested = await runHostedReconcileGate({
					parentContext: input.context,
					selector,
					target: { kind: 'persistent', scope: environment },
					planOnly: input.context.planOnly === true,
				});
				return genericResult(input, { ...input.observed.live, nested, fingerprint: input.unit.spec.fingerprint });
			}
			if (gateKind === 'release-gate:live-verify') {
				const environment = input.unit.spec.environment === 'prod' ? 'prod' : 'staging';
				const selector = typeof input.unit.spec.hostedSelector === 'object' && input.unit.spec.hostedSelector
					? input.unit.spec.hostedSelector as any
					: { environment, provider: ['cloudflare', 'railway', 'github', 'dockerhub'] };
				const status = await runHostedVerifyGate({
					parentContext: input.context,
					selector,
					target: { kind: 'persistent', scope: environment },
				});
				if (!status.ready) {
					throw new Error(`Hosted live verification failed for ${environment}: ${status.blockers.join('\n')}`);
				}
				return genericResult(input, { ...input.observed.live, status, fingerprint: input.unit.spec.fingerprint });
			}
			if (gateKind === 'release-gate:candidate-record' || gateKind === 'release-gate:production-record') {
				const recordPath = typeof input.unit.spec.recordPath === 'string'
					? input.unit.spec.recordPath
					: gateKind === 'release-gate:production-record'
						? '.treeseed/workflow/releases/latest-production.json'
						: '.treeseed/workflow/release-candidates/latest-staging.json';
				const record = writeReleaseRecord({
					tenantRoot: input.context.tenantRoot,
					recordPath,
					record: {
						schemaVersion: 1,
						kind: gateKind,
						unitId: input.unit.unitId,
						fingerprint: input.unit.spec.fingerprint ?? null,
						environment: input.unit.spec.environment ?? null,
						recordedAt: nowIso(),
					},
				});
				return genericResult(input, { ...input.observed.live, record, fingerprint: input.unit.spec.fingerprint });
			}
			return genericResult(input, { ...input.observed.live, fingerprint: input.unit.spec.fingerprint });
		},
		verify(input) {
			const dependencyResults = input.context.session.get('treeseed:verification-results') as Map<string, TreeseedUnitVerificationResult> | undefined;
			const dependencyChecks = input.unit.dependencies.map((dependency) => {
				const verification = dependencyResults?.get(dependency);
				const ok = verification?.verified === true;
				return verificationCheck(`dependency:${dependency}`, `Release gate dependency ${dependency} passed`, 'derived', {
					exists: ok,
					configured: ok,
					ready: ok,
					verified: ok,
					observed: verification ?? null,
					issues: ok ? [] : [`Dependency ${dependency} is not verified.`],
				});
			});
			const ownCheck = verificationCheck('release-gate', 'Release gate reconciled its fingerprint', 'sdk', {
				exists: true,
				configured: true,
				ready: input.result?.state?.fingerprint === input.unit.spec.fingerprint || input.diff.action === 'noop',
				verified: input.result?.state?.fingerprint === input.unit.spec.fingerprint || input.diff.action === 'noop',
				expected: input.unit.spec.fingerprint ?? null,
				observed: input.result?.state?.fingerprint ?? input.observed.live.previousFingerprint ?? null,
			});
			return summarizeVerification(input.unit.unitId, [...dependencyChecks, ownCheck], input.observed.warnings);
		},
	};
}

export function workflowFingerprint(input: TreeseedReconcileAdapterInput) {
	return JSON.stringify({
		unitId: input.unit.unitId,
		unitType: input.unit.unitType,
		spec: input.unit.spec,
		dependencies: input.unit.dependencies,
	});
}
