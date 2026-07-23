import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { IacClient } from 'railway';
import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../railway-cli.ts';
import { resolveTreeseedRailwayApiToken } from '../../../service-credentials.ts';
import { RailwayCustomDomainDnsRecord, RailwayCustomDomainSummary, RailwayEnvironmentSummary, RailwayProjectSummary, RailwayServiceDomainSummary, RailwayServiceSummary, RailwayVolumeInstanceSummary, RailwayVolumeSummary, RailwayWorkspaceSummary, normalizeConnectionNodes, railwayConnectionLabel } from './default-railway-api-url.ts';

export function normalizeWorkspace(node: Record<string, unknown>): RailwayWorkspaceSummary | null {
	const id = railwayConnectionLabel(node.id);
	const name = railwayConnectionLabel(node.name);
	if (!id || !name) {
		return null;
	}
	return { id, name };
}

export function normalizeEnvironment(node: Record<string, unknown>): RailwayEnvironmentSummary | null {
	const id = railwayConnectionLabel(node.id);
	const name = railwayConnectionLabel(node.name);
	if (!id || !name) {
		return null;
	}
	return { id, name };
}

export function normalizeService(node: Record<string, unknown>): RailwayServiceSummary | null {
	const id = railwayConnectionLabel(node.id);
	const name = railwayConnectionLabel(node.name);
	if (!id || !name) {
		return null;
	}
	return { id, name };
}

export function normalizeProject(node: Record<string, unknown>): RailwayProjectSummary | null {
	const id = railwayConnectionLabel(node.id);
	const name = railwayConnectionLabel(node.name);
	if (!id || !name) {
		return null;
	}
	const services = new Map<string, RailwayServiceSummary>();
	for (const service of normalizeConnectionNodes(node.services, normalizeService)) {
		services.set(service.id, service);
	}
	for (const environment of normalizeConnectionNodes(node.environments, (entry) => entry as Record<string, unknown>)) {
		for (const instance of normalizeConnectionNodes(environment.serviceInstances, (entry) => entry as Record<string, unknown>)) {
			const serviceId = railwayConnectionLabel(instance.serviceId);
			const serviceName = railwayConnectionLabel(instance.serviceName);
			if (serviceId && serviceName) {
				services.set(serviceId, { id: serviceId, name: serviceName });
			}
		}
	}
	return {
		id,
		name,
		workspaceId: railwayConnectionLabel(node.workspaceId) || null,
		deletedAt: railwayConnectionLabel(node.deletedAt) || null,
		environments: normalizeConnectionNodes(node.environments, normalizeEnvironment),
		services: [...services.values()],
	};
}

export function normalizeServiceInstanceService(node: Record<string, unknown>): RailwayServiceSummary | null {
	const id = railwayConnectionLabel(node.serviceId);
	const name = railwayConnectionLabel(node.serviceName);
	if (!id || !name) {
		return null;
	}
	return { id, name };
}

export function normalizeVariableMap(value: unknown): Record<string, string | null> {
	if (!value) {
		return {};
	}
	if (typeof value === 'string') {
		try {
			return normalizeVariableMap(JSON.parse(value));
		} catch {
			return {};
		}
	}
	if (typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
			if (typeof entryValue === 'string') {
				return [key, entryValue];
			}
			if (entryValue && typeof entryValue === 'object' && typeof (entryValue as { value?: unknown }).value === 'string') {
				return [key, (entryValue as { value: string }).value];
			}
			return [key, null];
		}),
	);
}

export function normalizeRailwayNumber(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

export function normalizeRailwayCustomDomainDnsRecord(node: Record<string, unknown>): RailwayCustomDomainDnsRecord | null {
	const fqdn = railwayConnectionLabel(node.fqdn);
	if (!fqdn) {
		return null;
	}
	return {
		fqdn,
		hostlabel: railwayConnectionLabel(node.hostlabel),
		recordType: railwayConnectionLabel(node.recordType),
		requiredValue: railwayConnectionLabel(node.requiredValue),
		currentValue: railwayConnectionLabel(node.currentValue),
		status: railwayConnectionLabel(node.status),
		zone: railwayConnectionLabel(node.zone),
		purpose: railwayConnectionLabel(node.purpose),
	};
}

export function normalizeRailwayCustomDomain(node: Record<string, unknown>): RailwayCustomDomainSummary | null {
	const id = railwayConnectionLabel(node.id);
	const domain = railwayConnectionLabel(node.domain);
	if (!id || !domain) {
		return null;
	}
	const status = node.status && typeof node.status === 'object' ? node.status as Record<string, unknown> : {};
	const dnsRecords = Array.isArray(status.dnsRecords)
		? status.dnsRecords
			.map((entry) => entry && typeof entry === 'object' ? normalizeRailwayCustomDomainDnsRecord(entry as Record<string, unknown>) : null)
			.filter(Boolean) as RailwayCustomDomainDnsRecord[]
		: [];
	return {
		id,
		domain,
		environmentId: railwayConnectionLabel(node.environmentId),
		serviceId: railwayConnectionLabel(node.serviceId),
		targetPort: typeof node.targetPort === 'number' && Number.isFinite(node.targetPort) ? node.targetPort : null,
		verified: status.verified === true,
		certificateStatus: railwayConnectionLabel(status.certificateStatus) || null,
		verificationDnsHost: railwayConnectionLabel(status.verificationDnsHost) || null,
		verificationToken: railwayConnectionLabel(status.verificationToken) || null,
		dnsRecords,
	};
}

export function normalizeRailwayDomain(node: unknown, kind: 'service' | 'custom' = 'service'): RailwayServiceDomainSummary | null {
	if (!node || typeof node !== 'object') {
		return null;
	}
	const record = node as Record<string, unknown>;
	const id = railwayConnectionLabel(record.id) || railwayConnectionLabel(record.domain);
	const domain = railwayConnectionLabel(record.domain);
	if (!id || !domain) {
		return null;
	}
	return {
		id,
		domain,
		kind,
		environmentId: railwayConnectionLabel(record.environmentId),
		serviceId: railwayConnectionLabel(record.serviceId),
		targetPort: normalizeRailwayNumber(record.targetPort),
	};
}

export function normalizeRailwayDomainList(value: unknown, kind: 'service' | 'custom') {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((entry) => normalizeRailwayDomain(entry, kind)).filter(Boolean) as RailwayServiceDomainSummary[];
}

export function normalizeRailwayVolumeInstance(node: Record<string, unknown>): RailwayVolumeInstanceSummary | null {
	const id = railwayConnectionLabel(node.id);
	if (!id) {
		return null;
	}
	const sizeGb = normalizeRailwayNumber(node.sizeGb ?? node.sizeGB ?? node.size_gb ?? node.capacityGb ?? node.capacityGB);
	const usedGb = normalizeRailwayNumber(node.usedGb ?? node.usedGB ?? node.used_gb ?? node.currentUsageGb ?? node.currentUsageGB);
	return {
		id,
		serviceId: railwayConnectionLabel(node.serviceId) || railwayConnectionLabel((node.service as { id?: unknown } | null)?.id) || null,
		environmentId: railwayConnectionLabel(node.environmentId) || railwayConnectionLabel((node.environment as { id?: unknown } | null)?.id) || null,
		mountPath: railwayConnectionLabel(node.mountPath) || railwayConnectionLabel(node.mount_path) || null,
		state: railwayConnectionLabel(node.state) || null,
		isPendingDeletion: node.isPendingDeletion === true || node.pendingDeletion === true,
		deletedAt: railwayConnectionLabel(node.deletedAt) || null,
		sizeGb,
		usedGb,
	};
}

export function isActiveRailwayVolumeInstance(instance: RailwayVolumeInstanceSummary) {
	const state = String(instance.state ?? 'READY').toUpperCase();
	return !instance.isPendingDeletion
		&& !(typeof instance.deletedAt === 'string' && instance.deletedAt.trim())
		&& state !== 'DELETING'
		&& state !== 'DELETED';
}

export function normalizeVolumeInstances(value: unknown): RailwayVolumeInstanceSummary[] {
	const direct = Array.isArray(value) ? value : null;
	if (direct) {
		return direct
			.map((entry) => entry && typeof entry === 'object' ? normalizeRailwayVolumeInstance(entry as Record<string, unknown>) : null)
			.filter(Boolean) as RailwayVolumeInstanceSummary[];
	}
	return normalizeConnectionNodes(value, normalizeRailwayVolumeInstance);
}

export function mergeRailwayVolumeInstances(instances: RailwayVolumeInstanceSummary[]) {
	const byId = new Map<string, RailwayVolumeInstanceSummary>();
	for (const instance of instances) {
		const existing = byId.get(instance.id);
		byId.set(instance.id, existing ? {
			...existing,
			serviceId: existing.serviceId || instance.serviceId,
			environmentId: existing.environmentId || instance.environmentId,
			mountPath: existing.mountPath || instance.mountPath,
			state: [existing.state, instance.state].find((state) => /^(?:DELETED|DELETING)$/u.test(String(state ?? '').toUpperCase()))
				?? existing.state
				?? instance.state,
			isPendingDeletion: existing.isPendingDeletion || instance.isPendingDeletion,
			deletedAt: existing.deletedAt || instance.deletedAt,
			sizeGb: existing.sizeGb ?? instance.sizeGb,
			usedGb: existing.usedGb ?? instance.usedGb,
		} : instance);
	}
	return [...byId.values()];
}

export function normalizeRailwayVolume(node: Record<string, unknown>): RailwayVolumeSummary | null {
	const id = railwayConnectionLabel(node.id);
	if (!id) {
		return null;
	}
	return {
		id,
		name: railwayConnectionLabel(node.name),
		projectId: railwayConnectionLabel(node.projectId) || null,
		instances: mergeRailwayVolumeInstances([
			...normalizeVolumeInstances(node.instances),
			...normalizeVolumeInstances(node.volumeInstances),
			...normalizeVolumeInstances(node.volume_instances),
		]),
	};
}
