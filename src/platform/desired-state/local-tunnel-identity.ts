import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';

const SCOPE_LENGTH = 12;
const DNS_LABEL_LIMIT = 63;

function digest(value: string | Buffer) {
	return createHash('sha256').update(value).digest('hex');
}

export function localTunnelDeploymentScope(tenantRoot: string) {
	const resolvedRoot = resolve(tenantRoot);
	const machineKeyPath = resolve(resolvedRoot, '.treeseed/config/machine.key');
	const machineIdentity = existsSync(machineKeyPath)
		? digest(readFileSync(machineKeyPath))
		: `${hostname()}:${process.getuid?.() ?? 'unknown'}`;
	return digest(`${machineIdentity}:${resolvedRoot}`).slice(0, SCOPE_LENGTH);
}

function scopedLabel(label: string, scope: string) {
	const suffix = `-${scope}`;
	if (label.endsWith(suffix)) return label;
	return `${label.slice(0, DNS_LABEL_LIMIT - suffix.length).replace(/-+$/u, '')}${suffix}`;
}

export function scopedLocalTunnelIdentity(tenantRoot: string, baseName: string, baseHostname: string) {
	const scope = localTunnelDeploymentScope(tenantRoot);
	const [firstLabel, ...domainLabels] = baseHostname.split('.');
	return {
		scope,
		baseName,
		baseHostname,
		name: scopedLabel(baseName, scope),
		hostname: [scopedLabel(firstLabel ?? '', scope), ...domainLabels].join('.'),
	};
}
