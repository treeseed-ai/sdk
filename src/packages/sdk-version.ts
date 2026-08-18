function firstString(record: Record<string, unknown>, keys: string[]) {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === 'string' && value.trim().length > 0) {
			return value;
		}
	}

	return null;
}

export function resolveSdkRecordVersion(record: Record<string, unknown> | null | undefined) {
	if (!record) {
		return null;
	}

	return firstString(record, [
		'updatedAt',
		'updated_at',
		'leaseExpiresAt',
		'lease_expires_at',
		'finishedAt',
		'finished_at',
		'startedAt',
		'started_at',
		'createdAt',
		'created_at',
	]);
}

export function assertExpectedVersion(
	expectedVersion: string | undefined,
	record: Record<string, unknown> | null | undefined,
	label: string,
) {
	if (!expectedVersion) {
		return;
	}

	const currentVersion = resolveSdkRecordVersion(record);
	if (!currentVersion) {
		throw new Error(`${label} does not expose a comparable version for optimistic updates.`);
	}
	if (currentVersion !== expectedVersion) {
		throw new Error(`${label} version mismatch. Expected ${expectedVersion} but found ${currentVersion}.`);
	}
}
