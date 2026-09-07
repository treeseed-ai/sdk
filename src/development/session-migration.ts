/** One-way normalization of pre-persistent development records. No expiry behavior survives. */
export function migrateDevelopmentRuntime(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== 'treeseed.development-runtime/v1') return value;
	const defaults = record.defaults;
	if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) return value;
	const { leaseSeconds: retired, ...persistentDefaults } = defaults as Record<string, unknown>;
	return { ...record, schemaVersion: 'treeseed.development-runtime/v2', defaults: persistentDefaults };
}

export function migrateDevelopmentSession(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== 'treeseed.development-session/v1') return value;
	const { expiresAt: retired, ...persistent } = record;
	const leases = Array.isArray(record.leases) ? record.leases.map(value => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
		const { expiresAt: retired, ...lease } = value as Record<string, unknown>;
		return lease;
	}) : record.leases;
	return { ...persistent, schemaVersion: 'treeseed.development-session/v2', status: record.status === 'expired' ? 'stopped' : record.status, leases };
}
