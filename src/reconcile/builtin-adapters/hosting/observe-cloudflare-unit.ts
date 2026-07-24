import { queueId, queueName } from "../../../operations/services/hosting/deployment/deploy.ts";
import type { ObservedUnitState, ReconcileAdapterInput } from "../../support/contracts/contracts.ts";
import { cloudflareObservationSnapshot, findTurnstileWidget } from '../support/normalize-turnstile-domains.ts';
import { hasLiveResourceId } from '../reconciliation/build-workflow-meta-adapter.ts';
import { noopObservedState } from './to-deploy-target.ts';

export function observeCloudflareUnit(input: ReconcileAdapterInput): ObservedUnitState {
	const snapshot = cloudflareObservationSnapshot(input);
	const { state, kvNamespaces, d1Databases, queues, buckets, pagesProjects, turnstileWidgets } = snapshot;
	switch (input.unit.unitType) {
		case 'queue': {
			const name = input.unit.spec.name;
			const dlqName = input.unit.spec.dlqName;
			const liveQueue = queues.find((entry) => queueName(entry) === name);
			const liveDlq = dlqName ? queues.find((entry) => queueName(entry) === dlqName) : null;
			return {
				exists: Boolean(liveQueue),
				status: liveQueue ? 'ready' : 'pending',
				live: { name, dlqName },
				locators: {
					queueId: queueId(liveQueue) ?? null,
					dlqId: queueId(liveDlq) ?? null,
				},
				warnings: [],
			};
		}
		case 'database': {
			const liveDatabase = d1Databases.find((entry) => entry?.name === state.d1Databases?.SITE_DATA_DB?.databaseName);
			return {
				exists: Boolean(liveDatabase || hasLiveResourceId(state.d1Databases?.SITE_DATA_DB?.databaseId)),
				status: liveDatabase ? 'ready' : 'pending',
				live: { ...(state.d1Databases?.SITE_DATA_DB ?? {}) },
				locators: {
					databaseId: liveDatabase?.uuid ?? state.d1Databases?.SITE_DATA_DB?.databaseId ?? null,
				},
				warnings: [],
			};
		}
		case 'content-store': {
			const liveBucket = buckets.find((entry) => entry?.name === state.content?.bucketName);
			return {
				exists: Boolean(liveBucket || state.content?.bucketName),
				status: liveBucket ? 'ready' : 'pending',
				live: { ...(state.content ?? {}) },
				locators: {
					bucketName: liveBucket?.name ?? state.content?.bucketName ?? null,
				},
				warnings: [],
			};
		}
		case 'kv-form-guard': {
			const liveNamespace = kvNamespaces.find((entry) => entry?.title === state.kvNamespaces?.FORM_GUARD_KV?.name);
			return {
				exists: Boolean(liveNamespace || hasLiveResourceId(state.kvNamespaces?.FORM_GUARD_KV?.id)),
				status: liveNamespace ? 'ready' : 'pending',
				live: { ...(state.kvNamespaces?.FORM_GUARD_KV ?? {}) },
				locators: { id: liveNamespace?.id ?? state.kvNamespaces?.FORM_GUARD_KV?.id ?? null },
				warnings: [],
			};
		}
		case 'turnstile-widget': {
			const current = state.turnstileWidgets?.formGuard ?? {};
			const liveWidget = findTurnstileWidget(turnstileWidgets, current, input.unit.spec.name as string);
			return {
				exists: Boolean(liveWidget?.sitekey || current?.sitekey),
				status: liveWidget?.sitekey ? 'ready' : 'pending',
				live: { ...current, ...(liveWidget ?? {}) },
				locators: { sitekey: String(liveWidget?.sitekey ?? current?.sitekey ?? '') || null },
				warnings: [],
			};
		}
		case 'pages-project': {
			const liveProject = pagesProjects.find((entry) => entry?.name === state.pages?.projectName);
			return {
				exists: Boolean(liveProject || state.pages?.projectName),
				status: liveProject ? 'ready' : 'pending',
				live: { ...(state.pages ?? {}) },
				locators: {
					projectName: liveProject?.name ?? state.pages?.projectName ?? null,
					url: liveProject?.subdomain ? `https://${liveProject.subdomain}` : state.pages?.url ?? null,
				},
				warnings: [],
			};
		}
		case 'edge-worker':
			return {
				exists: Boolean(state.workerName),
				status: state.workerName ? 'ready' : 'pending',
				live: { workerName: state.workerName, lastDeployedUrl: state.lastDeployedUrl ?? null },
				locators: { workerName: state.workerName ?? null, url: state.lastDeployedUrl ?? null },
				warnings: [],
			};
		default:
			return noopObservedState(input);
	}
}
