export interface CapabilityAccountingObservation {
	day: string;
	observedAt: string;
	healthy: boolean;
	activeSeconds: number;
	reservedSeconds: number;
}

/** Totals must cover the same accounting scope: provider/model or capability. */
export function remainingCapabilitySeconds(input: {
	now: string;
	maximumObservationAgeSeconds: number;
	dailyLimitSeconds: number;
	observation: CapabilityAccountingObservation;
	previousObservation?: CapabilityAccountingObservation;
	ledgerActiveSeconds: number;
	/** Union of outstanding reservation identities, not the sum of two reports. */
	ledgerReservedSeconds: number;
}) {
	const now = Date.parse(input.now), observed = Date.parse(input.observation.observedAt);
	const numbers = [input.maximumObservationAgeSeconds, input.dailyLimitSeconds, input.observation.activeSeconds,
		input.observation.reservedSeconds, input.ledgerActiveSeconds, input.ledgerReservedSeconds];
	if (!numbers.every((value) => Number.isFinite(value) && value >= 0)
		|| !Number.isFinite(now) || !Number.isFinite(observed)) throw new Error('capability_accounting_invalid');
	const day = new Date(now).toISOString().slice(0, 10);
	if (!input.observation.healthy) return { availableSeconds: 0, reason: 'unhealthy' as const };
	if (input.observation.day !== day || new Date(observed).toISOString().slice(0, 10) !== day
		|| observed > now || now - observed > input.maximumObservationAgeSeconds * 1000) {
		return { availableSeconds: 0, reason: 'stale' as const };
	}
	const previous = input.previousObservation;
	if (previous && (!Number.isFinite(Date.parse(previous.observedAt))
		|| !Number.isFinite(previous.activeSeconds) || previous.activeSeconds < 0)) throw new Error('capability_accounting_invalid');
	if (previous && (observed < Date.parse(previous.observedAt)
		|| (previous.day === day && input.observation.activeSeconds < previous.activeSeconds))) {
		return { availableSeconds: 0, reason: 'non-monotonic' as const };
	}
	const activeSeconds = Math.max(input.observation.activeSeconds, input.ledgerActiveSeconds);
	const reservedSeconds = Math.max(input.observation.reservedSeconds, input.ledgerReservedSeconds);
	return { availableSeconds: Math.max(0, Math.floor(input.dailyLimitSeconds - activeSeconds - reservedSeconds)),
		reason: 'accounted' as const, activeSeconds, reservedSeconds, day };
}
