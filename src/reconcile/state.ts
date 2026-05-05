import { createHash } from 'node:crypto';
import { loadCliDeployConfig } from '../operations/services/runtime-tools.ts';
import { loadDeployState, resolveTreeseedResourceIdentity, writeDeployState } from '../operations/services/deploy.ts';
import type { TreeseedDesiredUnit, TreeseedReconcileStateRecord, TreeseedReconcileTarget, TreeseedUnitPersistedState } from './contracts.ts';
import { targetKey } from './units.ts';

function stableHash(value: unknown) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function railwayUnitTypeForServiceKey(serviceKey: string) {
	if (serviceKey === 'workdayStart') {
		return 'railway-service:workday-start' as const;
	}
	if (serviceKey === 'workdayReport') {
		return 'railway-service:workday-report' as const;
	}
	return `railway-service:${serviceKey}` as const;
}

function emptyPersistedUnitState(unit: TreeseedDesiredUnit): TreeseedUnitPersistedState {
	return {
		unitId: unit.unitId,
		unitType: unit.unitType,
		provider: unit.provider,
		identity: unit.identity,
		target: unit.target,
		logicalName: unit.logicalName,
		desiredSpecHash: stableHash(unit.spec),
		lastObservedAt: null,
		lastReconciledAt: null,
		lastVerifiedAt: null,
		lastStatus: 'pending',
		lastObservedState: {},
		lastReconciledState: {},
		lastDiff: null,
		lastVerification: null,
		lastAction: null,
		resourceLocators: {},
		warnings: [],
		error: null,
	};
}

export function migrateLegacyDeployStateUnits(legacyState: Record<string, any>, target: TreeseedReconcileTarget) {
	const identity = legacyState.identity ?? resolveTreeseedResourceIdentity({
		slug: legacyState.hosting?.projectId ?? legacyState.runtime?.projectId ?? 'project',
		hosting: legacyState.hosting ?? {},
		runtime: legacyState.runtime ?? {},
		cloudflare: {},
	} as any, target);
	const units: Record<string, TreeseedUnitPersistedState> = {};
	const queue = legacyState.queues?.agentWork;
	if (queue?.name) {
		units[`queue:${queue.name}`] = {
			unitId: `queue:${queue.name}`,
			unitType: 'queue',
			provider: 'cloudflare',
			identity,
			target,
			logicalName: queue.name,
			desiredSpecHash: '',
			lastObservedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastReconciledAt: legacyState.lastDeploymentTimestamp ?? null,
			lastVerifiedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastStatus: queue.queueId ? 'ready' : 'pending',
			lastObservedState: {
				name: queue.name,
				dlqName: queue.dlqName ?? null,
				queueId: queue.queueId ?? null,
				dlqId: queue.dlqId ?? null,
			},
			lastReconciledState: {
				name: queue.name,
				dlqName: queue.dlqName ?? null,
				queueId: queue.queueId ?? null,
				dlqId: queue.dlqId ?? null,
			},
			lastDiff: null,
			lastVerification: null,
			lastAction: null,
			resourceLocators: {
				queueId: queue.queueId ?? null,
				dlqId: queue.dlqId ?? null,
			},
			warnings: [],
			error: null,
		};
	}
	const db = legacyState.d1Databases?.SITE_DATA_DB;
	if (db?.databaseName) {
		units[`database:${db.databaseName}`] = {
			unitId: `database:${db.databaseName}`,
			unitType: 'database',
			provider: 'cloudflare',
			identity,
			target,
			logicalName: db.databaseName,
			desiredSpecHash: '',
			lastObservedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastReconciledAt: legacyState.lastDeploymentTimestamp ?? null,
			lastVerifiedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastStatus: db.databaseId ? 'ready' : 'pending',
			lastObservedState: {
				databaseName: db.databaseName,
				databaseId: db.databaseId ?? null,
				previewDatabaseId: db.previewDatabaseId ?? null,
			},
			lastReconciledState: {
				databaseName: db.databaseName,
				databaseId: db.databaseId ?? null,
				previewDatabaseId: db.previewDatabaseId ?? null,
			},
			lastDiff: null,
			lastVerification: null,
			lastAction: null,
			resourceLocators: {
				databaseId: db.databaseId ?? null,
				previewDatabaseId: db.previewDatabaseId ?? null,
			},
			warnings: [],
			error: null,
		};
	}
	for (const [binding, namespace] of Object.entries(legacyState.kvNamespaces ?? {})) {
		if (binding !== 'FORM_GUARD_KV') continue;
		const record = namespace as Record<string, any>;
		if (!record?.name) continue;
		const unitType = 'kv-form-guard';
		units[`${unitType}:${record.name}`] = {
			unitId: `${unitType}:${record.name}`,
			unitType,
			provider: 'cloudflare',
			identity,
			target,
			logicalName: record.name,
			desiredSpecHash: '',
			lastObservedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastReconciledAt: legacyState.lastDeploymentTimestamp ?? null,
			lastVerifiedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastStatus: record.id ? 'ready' : 'pending',
			lastObservedState: { ...record },
			lastReconciledState: { ...record },
			lastDiff: null,
			lastVerification: null,
			lastAction: null,
			resourceLocators: {
				id: record.id ?? null,
				previewId: record.previewId ?? null,
			},
			warnings: [],
			error: null,
		};
	}
	if (legacyState.content?.bucketName) {
		units[`content-store:${legacyState.content.bucketName}`] = {
			unitId: `content-store:${legacyState.content.bucketName}`,
			unitType: 'content-store',
			provider: 'cloudflare',
			identity,
			target,
			logicalName: legacyState.content.bucketName,
			desiredSpecHash: '',
			lastObservedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastReconciledAt: legacyState.lastDeploymentTimestamp ?? null,
			lastVerifiedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastStatus: 'ready',
			lastObservedState: { ...legacyState.content },
			lastReconciledState: { ...legacyState.content },
			lastDiff: null,
			lastVerification: null,
			lastAction: null,
			resourceLocators: {
				bucketName: legacyState.content.bucketName,
				r2Binding: legacyState.content.r2Binding ?? null,
			},
			warnings: [],
			error: null,
		};
	}
	if (legacyState.pages?.projectName) {
		units[`pages-project:${legacyState.pages.projectName}`] = {
			unitId: `pages-project:${legacyState.pages.projectName}`,
			unitType: 'pages-project',
			provider: 'cloudflare',
			identity,
			target,
			logicalName: legacyState.pages.projectName,
			desiredSpecHash: '',
			lastObservedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastReconciledAt: legacyState.lastDeploymentTimestamp ?? null,
			lastVerifiedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastStatus: 'ready',
			lastObservedState: { ...legacyState.pages },
			lastReconciledState: { ...legacyState.pages },
			lastDiff: null,
			lastVerification: null,
			lastAction: null,
			resourceLocators: {
				projectName: legacyState.pages.projectName,
				url: legacyState.pages.url ?? null,
			},
			warnings: [],
			error: null,
		};
	}
	if (legacyState.workerName) {
		units[`edge-worker:${legacyState.workerName}`] = {
			unitId: `edge-worker:${legacyState.workerName}`,
			unitType: 'edge-worker',
			provider: 'cloudflare',
			identity,
			target,
			logicalName: legacyState.workerName,
			desiredSpecHash: '',
			lastObservedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastReconciledAt: legacyState.lastDeploymentTimestamp ?? null,
			lastVerifiedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastStatus: legacyState.workerName ? 'ready' : 'pending',
			lastObservedState: { workerName: legacyState.workerName, lastDeployedUrl: legacyState.lastDeployedUrl ?? null },
			lastReconciledState: { workerName: legacyState.workerName, lastDeployedUrl: legacyState.lastDeployedUrl ?? null },
			lastDiff: null,
			lastVerification: null,
			lastAction: null,
			resourceLocators: {
				workerName: legacyState.workerName,
				url: legacyState.lastDeployedUrl ?? null,
			},
			warnings: [],
			error: null,
		};
	}
	for (const [serviceKey, service] of Object.entries(legacyState.services ?? {})) {
		const record = service as Record<string, any>;
		if (!record?.enabled || record.provider !== 'railway') {
			continue;
		}
		const unitType = railwayUnitTypeForServiceKey(serviceKey);
		const logicalName = record.serviceName ?? record.serviceId ?? serviceKey;
		units[`${unitType}:${logicalName}`] = {
			unitId: `${unitType}:${logicalName}`,
			unitType,
			provider: 'railway',
			identity,
			target,
			logicalName,
			desiredSpecHash: '',
			lastObservedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastReconciledAt: record.lastDeploymentTimestamp ?? null,
			lastVerifiedAt: legacyState.readiness?.lastValidatedAt ?? null,
			lastStatus: record.initialized ? 'ready' : 'pending',
			lastObservedState: { ...record },
			lastReconciledState: { ...record },
			lastDiff: null,
			lastVerification: null,
			lastAction: null,
			resourceLocators: {
				projectId: record.projectId ?? null,
				serviceId: record.serviceId ?? null,
				serviceName: record.serviceName ?? null,
				publicBaseUrl: record.publicBaseUrl ?? null,
			},
			warnings: [],
			error: null,
		};
	}
	return units;
}

export function loadTreeseedReconcileState(tenantRoot: string, target: TreeseedReconcileTarget): TreeseedReconcileStateRecord {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const legacyState = loadDeployState(tenantRoot, deployConfig, { target });
	const persistedUnits = legacyState.units && typeof legacyState.units === 'object'
		? legacyState.units as Record<string, TreeseedUnitPersistedState>
		: migrateLegacyDeployStateUnits(legacyState, target);
	return {
		version: 1,
		target,
		dependencyGraphVersion: legacyState.reconcile?.dependencyGraphVersion ?? 1,
		units: { ...persistedUnits },
	};
}

export function writeTreeseedReconcileState(tenantRoot: string, reconcileState: TreeseedReconcileStateRecord) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const legacyState = loadDeployState(tenantRoot, deployConfig, { target: reconcileState.target });
	writeDeployState(tenantRoot, {
		...legacyState,
		reconcile: {
			version: reconcileState.version,
			dependencyGraphVersion: reconcileState.dependencyGraphVersion,
			targetKey: targetKey(reconcileState.target),
		},
		units: reconcileState.units,
	}, { target: reconcileState.target });
}

export function ensureTreeseedPersistedUnitState(
	reconcileState: TreeseedReconcileStateRecord,
	unit: TreeseedDesiredUnit,
) {
	return reconcileState.units[unit.unitId] ?? emptyPersistedUnitState(unit);
}

export function updateTreeseedPersistedUnitState(
	reconcileState: TreeseedReconcileStateRecord,
	state: TreeseedUnitPersistedState,
) {
	reconcileState.units[state.unitId] = state;
}

export function desiredUnitSpecHash(unit: TreeseedDesiredUnit) {
	return stableHash(unit.spec);
}
