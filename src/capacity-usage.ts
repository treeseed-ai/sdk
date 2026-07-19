import type {
	CreditConversionProfile,
	DerivedCapacityAvailability,
	DerivedCapacityInput,
} from './sdk-types.ts';
import type {
	CapacityReservation,
	CapacityUsageActual,
	NativeUsageObservation,
} from './agent-capacity/contracts/financial-records.ts';
import type { CapacityExecutionProvider } from './capacity-provider/contracts/index.ts';

export const ACTUAL_CREDIT_FORMULA_VERSION = 'treeseed.actual-credits.v1';
export const DEFAULT_EXECUTION_PROFILE_ID = 'standard-code-model';

export interface ActualCreditCalculationInput {
	nativeUsage?: NativeUsageObservation | Record<string, unknown> | null;
	conversionProfile?: CreditConversionProfile | null;
	legacyActualCredits?: number | null;
	actualCreditsOverride?: boolean | null;
	reservedCredits?: number | null;
	actualUsd?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	cachedInputTokens?: number | null;
	quotaMinutes?: number | null;
	wallMinutes?: number | null;
	filesOpened?: number | null;
	filesChanged?: number | null;
	diffLinesAdded?: number | null;
	diffLinesRemoved?: number | null;
	testRuns?: number | null;
	retryCount?: number | null;
	source?: string | null;
}

export interface ActualCreditCalculation {
	actualCredits: number;
	formulaVersion: string;
	source: 'central_calculator' | 'conversion_profile' | 'blended_conversion_profile' | 'legacy_override' | 'legacy_fallback' | 'reserved_fallback' | 'zero_fallback';
	nativeUsage: NativeUsageObservation;
	components: Record<string, number>;
	partial: boolean;
	interrupted: boolean;
	conversionProfileId?: string | null;
	conversionConfidence?: string | null;
}

export interface NativeAccountingWindow {
	startAt: string | null;
	endAt: string | null;
	source: 'observation' | 'configured_reset' | 'unknown';
	known: boolean;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function number(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function firstNumber(...values: unknown[]): number | null {
	for (const value of values) {
		const parsed = number(value);
		if (parsed !== null) return parsed;
	}
	return null;
}

function flag(value: unknown) {
	return value === true || value === 'true' || value === 1 || value === '1';
}

function roundCredits(value: number) {
	return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
}

function percentile(values: Array<number | null | undefined>, requested: number) {
	const sorted = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((left, right) => left - right);
	if (!sorted.length) return null;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((Math.min(100, Math.max(0, requested)) / 100) * sorted.length) - 1));
	return sorted[index] ?? null;
}

function variance(values: number[]) {
	if (!values.length) return 0;
	const mean = values.reduce((total, value) => total + value, 0) / values.length;
	return values.reduce((total, value) => total + ((value - mean) ** 2), 0) / values.length;
}

export function isInterruptedUsageActual(actual: Pick<CapacityUsageActual, 'metadata'> | { metadata?: Record<string, unknown> | null }) {
	const metadata = record(actual.metadata);
	return flag(metadata.interrupted) || flag(metadata.partial) || ['interrupted', 'partial', 'cancelled', 'failed'].includes(String(metadata.status ?? ''));
}

export function nativeUsageUnit(input: NativeUsageObservation | Record<string, unknown> | null | undefined): string | null {
	const native = record(input);
	const explicit = typeof native.nativeUnit === 'string' ? native.nativeUnit.trim() : typeof native.native_unit === 'string' ? native.native_unit.trim() : '';
	if (explicit) return explicit;
	if (firstNumber(native.wallMinutes, native.wall_minutes, native.durationMinutes, native.duration_minutes) !== null) return 'wall_minute';
	if (firstNumber(native.quotaMinutes, native.quota_minutes) !== null) return 'quota_minute';
	if (firstNumber(native.usd, native.costUsd, native.cost_usd) !== null) return 'usd';
	if (firstNumber(native.inputTokens, native.input_tokens, native.outputTokens, native.output_tokens) !== null) return 'token';
	return null;
}

export function nativeUsageAmount(input: NativeUsageObservation | Record<string, unknown> | null | undefined, requestedUnit?: string | null): number | null {
	const native = record(input);
	const unit = requestedUnit?.trim() || nativeUsageUnit(native);
	if (unit === 'wall_minute') return firstNumber(native.wallMinutes, native.wall_minutes, native.durationMinutes, native.duration_minutes);
	if (unit === 'quota_minute') return firstNumber(native.quotaMinutes, native.quota_minutes);
	if (unit === 'usd') return firstNumber(native.usd, native.costUsd, native.cost_usd);
	if (unit === 'token') {
		const total = Math.max(0, (firstNumber(native.inputTokens, native.input_tokens) ?? 0) + (firstNumber(native.outputTokens, native.output_tokens) ?? 0) - (firstNumber(native.cachedInputTokens, native.cached_input_tokens) ?? 0));
		return total > 0 ? total : null;
	}
	return unit ? firstNumber(native.amount, native.value, native.nativeAmount, native.native_amount) : null;
}

export function selectCreditConversionProfile(input: {
	profiles?: CreditConversionProfile[] | null;
	taskSignature?: string | null;
	executionProfileId?: string | null;
	executionProviderKind?: string | null;
	nativeUnit?: string | null;
}) {
	const profileId = input.executionProfileId?.trim() || DEFAULT_EXECUTION_PROFILE_ID;
	if (!input.taskSignature?.trim() || !input.executionProviderKind?.trim() || !input.nativeUnit?.trim()) return null;
	return (input.profiles ?? []).find((profile) =>
		profile.taskSignature === input.taskSignature
		&& (profile.executionProfileId || DEFAULT_EXECUTION_PROFILE_ID) === profileId
		&& profile.executionProviderKind === input.executionProviderKind
		&& profile.nativeUnit === input.nativeUnit
	) ?? null;
}

export function buildCreditConversionProfileFromActuals(input: {
	taskSignature: string;
	executionProfileId?: string | null;
	executionProviderKind: string;
	nativeUnit: string;
	actuals: CapacityUsageActual[];
	formulaVersion?: string | null;
	now?: Date | string | null;
	id?: string | null;
}): CreditConversionProfile {
	const profileId = input.executionProfileId?.trim() || DEFAULT_EXECUTION_PROFILE_ID;
	const matching = input.actuals.filter((actual) => actual.taskSignature === input.taskSignature && (actual.executionProfileId || DEFAULT_EXECUTION_PROFILE_ID) === profileId);
	const interrupted = matching.filter(isInterruptedUsageActual);
	const completed = matching.filter((actual) => !isInterruptedUsageActual(actual)).map((actual) => {
		const nativeAmount = nativeUsageAmount(actual.nativeUsage, input.nativeUnit);
		const credits = number(actual.actualCredits);
		return nativeAmount && credits && nativeAmount > 0 && credits > 0 ? {
			nativeUnitsPerCredit: nativeAmount / credits,
			creditsPerNativeUnit: credits / nativeAmount,
			actualCredits: credits,
		} : null;
	}).filter((sample): sample is NonNullable<typeof sample> => sample !== null);
	const ratios = completed.map((sample) => sample.nativeUnitsPerCredit);
	const p50 = percentile(ratios, 50);
	const p90 = percentile(ratios, 90);
	const ratioVariance = variance(ratios);
	const outlierLimit = p90 === null ? null : Math.max(p90 * 1.5, (p50 ?? p90) + Math.sqrt(ratioVariance));
	const filtered = outlierLimit === null ? completed : completed.filter((sample) => sample.nativeUnitsPerCredit <= outlierLimit);
	const updatedAt = input.now instanceof Date ? input.now.toISOString() : typeof input.now === 'string' ? input.now : new Date().toISOString();
	const filteredP50 = percentile(filtered.map((sample) => sample.nativeUnitsPerCredit), 50);
	const spread = Math.sqrt(Math.max(0, ratioVariance)) / Math.max(1, filteredP50 ?? 1);
	const confidence = completed.length < 5 ? 'low' : completed.length < 20 || spread > 0.5 ? 'medium' : 'high';
	const dates = matching.map((actual) => actual.createdAt).filter(Boolean).sort();
	return {
		id: input.id ?? `${input.taskSignature}:${profileId}:${input.executionProviderKind}:${input.nativeUnit}`,
		taskSignature: input.taskSignature,
		executionProfileId: profileId,
		executionProviderKind: input.executionProviderKind.trim(),
		nativeUnit: input.nativeUnit.trim(),
		sampleCount: matching.length,
		completedSampleCount: completed.length,
		interruptedSampleCount: interrupted.length,
		nativeUnitsPerCreditP50: filteredP50,
		nativeUnitsPerCreditP90: percentile(filtered.map((sample) => sample.nativeUnitsPerCredit), 90),
		creditsPerNativeUnitP50: percentile(filtered.map((sample) => sample.creditsPerNativeUnit), 50),
		creditsPerNativeUnitP90: percentile(filtered.map((sample) => sample.creditsPerNativeUnit), 90),
		actualCreditsP50: percentile(filtered.map((sample) => sample.actualCredits), 50),
		actualCreditsP90: percentile(filtered.map((sample) => sample.actualCredits), 90),
		confidence,
		formulaVersion: input.formulaVersion ?? ACTUAL_CREDIT_FORMULA_VERSION,
		metadata: {
			outlierCount: completed.length - filtered.length,
			ratioVariance,
			partialCredits: interrupted.reduce((total, actual) => total + Math.max(0, number(actual.actualCredits) ?? 0), 0),
			partialNativeAmount: interrupted.reduce((total, actual) => total + Math.max(0, nativeUsageAmount(actual.nativeUsage, input.nativeUnit) ?? 0), 0),
			firstSampleAt: dates[0] ?? null,
			lastSampleAt: dates.at(-1) ?? null,
		},
		updatedAt,
	};
}

function reservationDebit(reservation: CapacityReservation, provider: CapacityExecutionProvider, nativeUnit: string) {
	if (!['reserved', 'consuming', 'consumed', 'failed', 'overran_pending_approval'].includes(reservation.state)) return { reserved: 0, consumed: 0 };
	if (reservation.nativeUnit === nativeUnit) return {
		reserved: ['reserved', 'consuming'].includes(reservation.state) ? Math.max(reservation.reservedNativeAmount ?? 0, reservation.consumedNativeAmount ?? 0) : 0,
		consumed: ['consumed', 'failed', 'overran_pending_approval'].includes(reservation.state) ? Math.max(reservation.consumedNativeAmount ?? 0, 0) : 0,
	};
	if (nativeUnit === 'usd') return {
		reserved: ['reserved', 'consuming'].includes(reservation.state) ? Math.max(reservation.reservedUsd ?? 0, reservation.consumedUsd ?? 0) : 0,
		consumed: ['consumed', 'failed', 'overran_pending_approval'].includes(reservation.state) ? Math.max(reservation.consumedUsd ?? 0, 0) : 0,
	};
	if (provider.nativeUnit === nativeUnit) return {
		reserved: ['reserved', 'consuming'].includes(reservation.state) ? Math.max(reservation.reservedProviderUnits ?? 0, reservation.consumedProviderUnits ?? 0) : 0,
		consumed: ['consumed', 'failed', 'overran_pending_approval'].includes(reservation.state) ? Math.max(reservation.consumedProviderUnits ?? 0, 0) : 0,
	};
	return { reserved: 0, consumed: 0 };
}

function validDate(value: unknown): Date | null {
	if (value instanceof Date && Number.isFinite(value.getTime())) return value;
	if (typeof value !== 'string' || !value.trim()) return null;
	const parsed = new Date(value);
	return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function configuredWindow(cadence: string, now: Date) {
	if (cadence === 'daily') {
		const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
		return { start, end: new Date(start.getTime() + 86_400_000) };
	}
	if (cadence === 'weekly') {
		const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
		const daysSinceMonday = (start.getUTCDay() + 6) % 7;
		start.setUTCDate(start.getUTCDate() - daysSinceMonday);
		return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
	}
	if (cadence === 'monthly') {
		const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
		return { start, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
	}
	return null;
}

export function resolveNativeAccountingWindow(input: DerivedCapacityInput, source?: 'observation' | 'configured_limit' | 'unknown'): NativeAccountingWindow {
	const resolvedSource = source ?? (nativeUsageAmount(input.latestObservation?.nativeRemaining, input.nativeUnit ?? input.nativeLimit?.nativeUnit) !== null
		? 'observation'
		: number(input.nativeLimit?.limitAmount) !== null ? 'configured_limit' : 'unknown');
	if (resolvedSource === 'observation') {
		const observedAt = validDate(input.latestObservation?.observedAt);
		if (!observedAt) return { startAt: null, endAt: null, source: 'unknown', known: false };
		return {
			startAt: observedAt.toISOString(),
			endAt: validDate(input.latestObservation?.resetAt ?? input.nativeLimit?.resetAt)?.toISOString() ?? null,
			source: 'observation',
			known: true,
		};
	}
	if (resolvedSource !== 'configured_limit') return { startAt: null, endAt: null, source: 'unknown', known: false };
	const now = validDate(input.now) ?? new Date();
	const metadata = record(input.nativeLimit?.metadata);
	const explicitStart = validDate(metadata.windowStartAt ?? metadata.window_start_at);
	const explicitEnd = validDate(input.nativeLimit?.resetAt ?? metadata.windowEndAt ?? metadata.window_end_at);
	if (explicitStart && explicitEnd && explicitStart < explicitEnd) {
		return { startAt: explicitStart.toISOString(), endAt: explicitEnd.toISOString(), source: 'configured_reset', known: true };
	}
	const cadence = String(input.nativeLimit?.resetCadence ?? input.executionProvider.resetCadence ?? input.nativeLimit?.scope ?? '').trim().toLowerCase();
	const window = configuredWindow(cadence, now);
	if (!window) return { startAt: null, endAt: explicitEnd?.toISOString() ?? null, source: 'unknown', known: false };
	return { startAt: window.start.toISOString(), endAt: window.end.toISOString(), source: 'configured_reset', known: true };
}

export function deriveAvailableCredits(input: DerivedCapacityInput): DerivedCapacityAvailability {
	const provider = input.executionProvider;
	const nativeUnit = input.nativeUnit?.trim() || input.nativeLimit?.nativeUnit || provider.nativeUnit;
	const configured = number(input.nativeLimit?.limitAmount);
	const observed = nativeUsageAmount({ ...record(input.latestObservation?.nativeRemaining), nativeUnit }, nativeUnit);
	const source = observed !== null ? 'observation' : configured !== null ? 'configured_limit' : 'unknown';
	const base = Math.max(0, observed ?? configured ?? 0);
	const reservations = (input.activeReservations ?? []).filter((reservation) => reservation.executionProviderId ? reservation.executionProviderId === provider.id : reservation.capacityProviderId === provider.capacityProviderId);
	const accountingWindow = resolveNativeAccountingWindow(input, source);
	const windowStartMs = Date.parse(accountingWindow.startAt ?? '');
	const windowEndMs = Date.parse(accountingWindow.endAt ?? '');
	const debits = reservations.map((reservation) => {
		const debit = reservationDebit(reservation, provider, nativeUnit);
		if (debit.consumed <= 0) return debit;
		const settledAtMs = Date.parse(reservation.updatedAt ?? reservation.createdAt ?? '');
		const insideWindow = accountingWindow.known
			&& Number.isFinite(settledAtMs)
			&& settledAtMs >= windowStartMs
			&& (!Number.isFinite(windowEndMs) || settledAtMs < windowEndMs);
		return { ...debit, consumed: insideWindow ? debit.consumed : 0 };
	});
	const activeReservedNativeAmount = input.reservationDebits?.activeReservedNativeAmount
		?? debits.reduce((total, debit) => total + debit.reserved, 0);
	const activeConsumedNativeAmount = input.reservationDebits?.activeConsumedNativeAmount
		?? debits.reduce((total, debit) => total + debit.consumed, 0);
	const reserveBufferPercent = Math.max(0, number(input.nativeLimit?.reserveBufferPercent) ?? 0);
	const reserveBufferNativeAmount = configured === null ? 0 : configured * reserveBufferPercent / 100;
	const availableNativeAmount = accountingWindow.known
		? Math.max(0, base - activeReservedNativeAmount - activeConsumedNativeAmount - reserveBufferNativeAmount)
		: 0;
	const profile = input.conversionProfile ?? null;
	const nativeUnitsPerCredit = profile?.nativeUnitsPerCreditP90 && profile.nativeUnitsPerCreditP90 > 0 ? profile.nativeUnitsPerCreditP90 : profile?.nativeUnitsPerCreditP50 ?? null;
	const confidence = source === 'unknown' || !accountingWindow.known ? 'low' : profile?.nativeUnitsPerCreditP90 ? profile.confidence : profile?.confidence === 'high' ? 'medium' : profile?.confidence ?? 'low';
	const reasons = [source === 'observation' ? 'observation_remaining' : source === 'configured_limit' ? 'configured_limit' : 'missing_native_limit'];
	if (activeReservedNativeAmount > 0) reasons.push('active_native_reservations');
	if (activeConsumedNativeAmount > 0) reasons.push(source === 'observation' ? 'native_usage_since_observation' : 'native_usage_in_reset_window');
	if (!accountingWindow.known) reasons.push('native_accounting_window_unknown');
	if (reserveBufferNativeAmount > 0) reasons.push('reserve_buffer');
	if (nativeUnitsPerCredit) reasons.push(profile?.nativeUnitsPerCreditP90 ? 'p90_conversion_profile' : 'p50_conversion_fallback');
	else reasons.push('missing_conversion_profile');
	return {
		executionProviderId: provider.id,
		capacityProviderId: provider.capacityProviderId,
		executionProviderKind: provider.kind,
		nativeUnit,
		scope: input.scope ?? input.nativeLimit?.scope ?? null,
		configuredNativeLimit: configured,
		observedNativeRemaining: observed,
		nativeRemainingSource: source,
		activeReservedNativeAmount,
		activeConsumedNativeAmount,
		reserveBufferPercent,
		reserveBufferNativeAmount,
		availableNativeAmount,
		nativeUnitsPerCredit,
		conversionProfileId: profile?.id ?? null,
		conversionTaskSignature: profile?.taskSignature ?? null,
		conversionConfidence: profile?.confidence ?? null,
		derivedAvailableCredits: accountingWindow.known && nativeUnitsPerCredit && nativeUnitsPerCredit > 0 ? Math.floor((availableNativeAmount / nativeUnitsPerCredit) * 100) / 100 : null,
		confidence,
		resetAt: input.latestObservation?.resetAt ?? input.nativeLimit?.resetAt ?? null,
		accountingWindowStartAt: accountingWindow.startAt,
		accountingWindowEndAt: accountingWindow.endAt,
		accountingWindowSource: accountingWindow.source,
		reasons: [...new Set(reasons)],
		metadata: { quotaVisibility: provider.quotaVisibility, latestObservedAt: input.latestObservation?.observedAt ?? null, conversionFormulaVersion: profile?.formulaVersion ?? null },
	};
}

export function calculateActualCredits(input: ActualCreditCalculationInput): ActualCreditCalculation {
	const native = record(input.nativeUsage);
	const metadata = record(native.metadata);
	const metrics = {
		wallMinutes: firstNumber(input.wallMinutes, native.wallMinutes, native.wall_minutes, native.durationMinutes, native.duration_minutes),
		quotaMinutes: firstNumber(input.quotaMinutes, native.quotaMinutes, native.quota_minutes),
		inputTokens: firstNumber(input.inputTokens, native.inputTokens, native.input_tokens),
		outputTokens: firstNumber(input.outputTokens, native.outputTokens, native.output_tokens),
		cachedInputTokens: firstNumber(input.cachedInputTokens, native.cachedInputTokens, native.cached_input_tokens),
		usd: firstNumber(input.actualUsd, native.usd, native.costUsd, native.cost_usd),
		filesOpened: firstNumber(input.filesOpened, native.filesOpened, native.files_opened),
		filesChanged: firstNumber(input.filesChanged, native.filesChanged, native.files_changed),
		diffLinesAdded: firstNumber(input.diffLinesAdded, native.diffLinesAdded, native.diff_lines_added),
		diffLinesRemoved: firstNumber(input.diffLinesRemoved, native.diffLinesRemoved, native.diff_lines_removed),
		testRuns: firstNumber(input.testRuns, native.testRuns, native.test_runs),
		retryCount: firstNumber(input.retryCount, native.retryCount, native.retry_count),
	};
	const partial = flag(native.partial) || flag(metadata.partial);
	const interrupted = flag(native.interrupted) || flag(metadata.interrupted);
	const nativeUsage: NativeUsageObservation = { ...native, ...metrics, nativeUnit: nativeUsageUnit(native) ?? (metrics.wallMinutes !== null ? 'wall_minute' : metrics.quotaMinutes !== null ? 'quota_minute' : metrics.usd !== null ? 'usd' : null), partial, interrupted, source: typeof native.source === 'string' ? native.source : input.source ?? null, metadata };
	const components: Record<string, number> = {};
	if (metrics.wallMinutes && metrics.wallMinutes > 0) components.wallMinutes = Math.ceil(metrics.wallMinutes / 5);
	else if (metrics.quotaMinutes && metrics.quotaMinutes > 0) components.quotaMinutes = Math.ceil(metrics.quotaMinutes / 5);
	if (metrics.usd && metrics.usd > 0) components.usd = Math.ceil((metrics.usd / 0.03) * 100) / 100;
	const billableTokens = Math.max(0, (metrics.inputTokens ?? 0) + (metrics.outputTokens ?? 0) - (metrics.cachedInputTokens ?? 0));
	if (billableTokens) components.tokens = Math.ceil(billableTokens / 8000);
	if (metrics.filesChanged && metrics.filesChanged > 0) components.filesChanged = Math.ceil(metrics.filesChanged) * 2;
	if (metrics.testRuns && metrics.testRuns > 0) components.testRuns = Math.ceil(metrics.testRuns);
	if (metrics.retryCount && metrics.retryCount > 0) components.retryCount = Math.ceil(metrics.retryCount) * 3;
	const componentTotal = Object.values(components).reduce((total, value) => total + value, 0);
	const profile = input.conversionProfile ?? null;
	const profileAmount = profile ? nativeUsageAmount(nativeUsage, profile.nativeUnit) : null;
	const profileCredits = profileAmount && profile?.nativeUnitsPerCreditP50 ? roundCredits(profileAmount / profile.nativeUnitsPerCreditP50) : null;
	let source: ActualCreditCalculation['source'];
	let actualCredits: number;
	if (number(input.legacyActualCredits) !== null && input.actualCreditsOverride === true) [source, actualCredits] = ['legacy_override', roundCredits(number(input.legacyActualCredits) ?? 0)];
	else if (profile?.confidence === 'high' && profileCredits !== null) [source, actualCredits] = ['conversion_profile', profileCredits];
	else if (profile?.confidence === 'medium' && profileCredits !== null && componentTotal > 0) [source, actualCredits] = ['blended_conversion_profile', roundCredits((profileCredits + componentTotal) / 2)];
	else if (componentTotal > 0) [source, actualCredits] = ['central_calculator', roundCredits(componentTotal)];
	else if (number(input.legacyActualCredits) !== null) [source, actualCredits] = ['legacy_fallback', roundCredits(number(input.legacyActualCredits) ?? 0)];
	else if (number(input.reservedCredits) !== null) [source, actualCredits] = ['reserved_fallback', roundCredits(number(input.reservedCredits) ?? 0)];
	else [source, actualCredits] = ['zero_fallback', 0];
	return { actualCredits, formulaVersion: ACTUAL_CREDIT_FORMULA_VERSION, source, nativeUsage, components: profileCredits === null ? components : { ...components, conversionProfile: profileCredits }, partial, interrupted, conversionProfileId: profile?.id ?? null, conversionConfidence: profile?.confidence ?? null };
}
