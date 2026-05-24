import type {
	AttentionEstimate,
	AttentionPolicy,
	CapacityEstimateConfidence,
	CapacityGrant,
	CapacityPlan,
	CapacityProvider,
	CapacityProviderLane,
	CapacityReservation,
	CapacityScarcityLevel,
	CreditConversionProfile,
	CreateCapacityReservationRequest,
	CreateCapacityRoutingDecisionRequest,
	DerivedCapacityAvailability,
	DerivedCapacityInput,
	ExecutionProfile,
	ExecutionProvider,
	HybridExecutionPlan,
	NativeUsageObservation,
	PlannedTaskNode,
	PlanningAdmissionResult,
	PlanningPolicy,
	PredictiveReservePolicy,
	ProjectEnvironmentName,
	RecordCapacityUsageRequest,
	ReservePrediction,
	TaskAdmissionDecision,
	TaskAdmissionPolicy,
	TaskClassification,
	TaskEstimateProfile,
	TaskPlanProposal,
	TaskMutationScope,
	TaskUsageActual,
	UtilityEstimate,
	UtilityPolicy,
	WorkdayBudgetEnvelope,
} from './sdk-types.ts';
import type { AgentProviderProfile } from './types/agents.ts';

export const ACTUAL_CREDIT_FORMULA_VERSION = 'treeseed.actual-credits.v1';

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

function finiteActualMetric(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function firstActualMetric(...values: unknown[]): number | null {
	for (const value of values) {
		const next = finiteActualMetric(value);
		if (next !== null) return next;
	}
	return null;
}

function objectActualValue(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function booleanActualFlag(value: unknown): boolean {
	return value === true || value === 'true' || value === 1 || value === '1';
}

function roundActualCredits(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.round(value * 100) / 100;
}

function roundUpCreditComponent(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.ceil(value * 100) / 100;
}

function stringActualValue(value: unknown, fallback = '') {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function nativeUsageUnit(input: NativeUsageObservation | Record<string, unknown> | null | undefined): string | null {
	const native = objectActualValue(input);
	const explicit = stringActualValue(native.nativeUnit, stringActualValue(native.native_unit));
	if (explicit) return explicit;
	if (firstActualMetric(native.wallMinutes, native.wall_minutes, native.durationMinutes, native.duration_minutes) !== null) return 'wall_minute';
	if (firstActualMetric(native.quotaMinutes, native.quota_minutes) !== null) return 'quota_minute';
	if (firstActualMetric(native.usd, native.costUsd, native.cost_usd) !== null) return 'usd';
	if (firstActualMetric(native.inputTokens, native.input_tokens, native.outputTokens, native.output_tokens) !== null) return 'token';
	return null;
}

export function nativeUsageAmount(input: NativeUsageObservation | Record<string, unknown> | null | undefined, nativeUnit?: string | null): number | null {
	const native = objectActualValue(input);
	const unit = nativeUnit?.trim() || nativeUsageUnit(native);
	if (!unit) return null;
	if (unit === 'wall_minute') {
		return firstActualMetric(native.wallMinutes, native.wall_minutes, native.durationMinutes, native.duration_minutes);
	}
	if (unit === 'quota_minute') {
		return firstActualMetric(native.quotaMinutes, native.quota_minutes);
	}
	if (unit === 'usd') {
		return firstActualMetric(native.usd, native.costUsd, native.cost_usd);
	}
	if (unit === 'token') {
		const inputTokens = firstActualMetric(native.inputTokens, native.input_tokens) ?? 0;
		const outputTokens = firstActualMetric(native.outputTokens, native.output_tokens) ?? 0;
		const cachedInputTokens = firstActualMetric(native.cachedInputTokens, native.cached_input_tokens) ?? 0;
		const total = Math.max(0, inputTokens + outputTokens - cachedInputTokens);
		return total > 0 ? total : null;
	}
	return firstActualMetric(native.amount, native.value, native.nativeAmount, native.native_amount);
}

function conversionConfidence(input: {
	completedSampleCount: number;
	ratioVariance: number;
	nativeUnitsPerCreditP50: number | null;
}) {
	if (input.completedSampleCount < 5) return 'low';
	if (input.completedSampleCount < 20) return 'medium';
	const p50 = Math.max(1, input.nativeUnitsPerCreditP50 ?? 1);
	const spread = Math.sqrt(Math.max(0, input.ratioVariance)) / p50;
	return spread <= 0.5 ? 'high' : 'medium';
}

export function selectCreditConversionProfile(input: {
	profiles?: CreditConversionProfile[] | null;
	taskSignature?: string | null;
	executionProfileId?: string | null;
	executionProviderKind?: string | null;
	nativeUnit?: string | null;
}) {
	const taskSignature = input.taskSignature?.trim();
	const executionProfileId = input.executionProfileId?.trim() || DEFAULT_EXECUTION_PROFILE_ID;
	const executionProviderKind = input.executionProviderKind?.trim();
	const nativeUnit = input.nativeUnit?.trim();
	if (!taskSignature || !executionProviderKind || !nativeUnit) return null;
	return (input.profiles ?? []).find((profile) =>
		profile.taskSignature === taskSignature
		&& (profile.executionProfileId || DEFAULT_EXECUTION_PROFILE_ID) === executionProfileId
		&& profile.executionProviderKind === executionProviderKind
		&& profile.nativeUnit === nativeUnit
	) ?? null;
}

export function buildCreditConversionProfileFromActuals(input: {
	taskSignature: string;
	executionProfileId?: string | null;
	executionProviderKind: string;
	nativeUnit: string;
	actuals: TaskUsageActual[];
	formulaVersion?: string | null;
	now?: Date | string | null;
	id?: string | null;
}): CreditConversionProfile {
	const taskSignature = input.taskSignature;
	const executionProfileId = input.executionProfileId?.trim() || DEFAULT_EXECUTION_PROFILE_ID;
	const executionProviderKind = input.executionProviderKind.trim();
	const nativeUnit = input.nativeUnit.trim();
	const matching = input.actuals.filter((actual) =>
		actual.taskSignature === taskSignature
		&& (actual.executionProfileId || DEFAULT_EXECUTION_PROFILE_ID) === executionProfileId
	);
	const completed = matching.filter((actual) => !isInterruptedUsageActual(actual));
	const interrupted = matching.filter((actual) => isInterruptedUsageActual(actual));
	const completedRatios = completed
		.map((actual) => {
			const amount = nativeUsageAmount(actual.nativeUsage, nativeUnit);
			const credits = finiteOrParsedNumber(actual.actualCredits);
			if (amount === null || amount <= 0 || credits === null || credits <= 0) return null;
			return {
				nativeUnitsPerCredit: amount / credits,
				creditsPerNativeUnit: credits / amount,
				actualCredits: credits,
				nativeAmount: amount,
			};
		})
		.filter((value): value is {
			nativeUnitsPerCredit: number;
			creditsPerNativeUnit: number;
			actualCredits: number;
			nativeAmount: number;
		} => value !== null);
	const ratioP50 = estimateLearningPercentile(completedRatios.map((sample) => sample.nativeUnitsPerCredit), 50);
	const ratioP90 = estimateLearningPercentile(completedRatios.map((sample) => sample.nativeUnitsPerCredit), 90);
	const ratioVariance = estimateLearningVariance(completedRatios.map((sample) => sample.nativeUnitsPerCredit));
	const outlierLimit = ratioP90 === null ? null : Math.max(ratioP90 * 1.5, (ratioP50 ?? ratioP90) + Math.sqrt(ratioVariance));
	const filteredRatios = outlierLimit === null
		? completedRatios
		: completedRatios.filter((sample) => sample.nativeUnitsPerCredit <= outlierLimit);
	const dates = matching
		.map((actual) => actual.createdAt)
		.filter((value): value is string => typeof value === 'string' && value.length > 0)
		.sort();
	const partialCredits = interrupted.reduce((total, actual) => total + Math.max(0, finiteOrParsedNumber(actual.actualCredits) ?? 0), 0);
	const partialNativeAmount = interrupted.reduce((total, actual) => total + Math.max(0, nativeUsageAmount(actual.nativeUsage, nativeUnit) ?? 0), 0);
	const updatedAt = input.now instanceof Date ? input.now.toISOString() : typeof input.now === 'string' ? input.now : new Date().toISOString();
	const nativeUnitsPerCreditP50 = estimateLearningPercentile(filteredRatios.map((sample) => sample.nativeUnitsPerCredit), 50);
	const nativeUnitsPerCreditP90 = estimateLearningPercentile(filteredRatios.map((sample) => sample.nativeUnitsPerCredit), 90);
	return {
		id: input.id ?? `${taskSignature}:${executionProfileId}:${executionProviderKind}:${nativeUnit}`,
		taskSignature,
		executionProfileId,
		executionProviderKind,
		nativeUnit,
		sampleCount: matching.length,
		completedSampleCount: completedRatios.length,
		interruptedSampleCount: interrupted.length,
		nativeUnitsPerCreditP50,
		nativeUnitsPerCreditP90,
		creditsPerNativeUnitP50: estimateLearningPercentile(filteredRatios.map((sample) => sample.creditsPerNativeUnit), 50),
		creditsPerNativeUnitP90: estimateLearningPercentile(filteredRatios.map((sample) => sample.creditsPerNativeUnit), 90),
		actualCreditsP50: estimateLearningPercentile(filteredRatios.map((sample) => sample.actualCredits), 50),
		actualCreditsP90: estimateLearningPercentile(filteredRatios.map((sample) => sample.actualCredits), 90),
		confidence: conversionConfidence({
			completedSampleCount: completedRatios.length,
			ratioVariance,
			nativeUnitsPerCreditP50,
		}),
		formulaVersion: input.formulaVersion ?? ACTUAL_CREDIT_FORMULA_VERSION,
		metadata: {
			outlierCount: outlierLimit === null ? 0 : completedRatios.length - filteredRatios.length,
			ratioVariance,
			partialCredits,
			partialNativeAmount,
			firstSampleAt: dates[0] ?? null,
			lastSampleAt: dates.at(-1) ?? null,
		},
		updatedAt,
	};
}

function derivedConfidenceRank(value: string | null | undefined) {
	if (value === 'high') return 3;
	if (value === 'medium') return 2;
	return 1;
}

function derivedConfidenceFromRank(rank: number): 'low' | 'medium' | 'high' {
	if (rank >= 3) return 'high';
	if (rank >= 2) return 'medium';
	return 'low';
}

function lowerDerivedConfidence(value: string | null | undefined): 'low' | 'medium' | 'high' {
	return derivedConfidenceFromRank(Math.min(derivedConfidenceRank(value), 2));
}

function nativeRemainingAmount(input: Record<string, unknown>, nativeUnit: string) {
	return nativeUsageAmount({
		...input,
		nativeUnit,
	}, nativeUnit);
}

function reservationNativeDebit(reservation: CapacityReservation, executionProvider: ExecutionProvider, nativeUnit: string) {
	if (!['reserved', 'consuming', 'consumed', 'failed', 'overran_pending_approval'].includes(reservation.state)) {
		return { reserved: 0, consumed: 0, inferred: false };
	}
	const metadata = readRecord(reservation.metadata);
	const metadataNativeUnit = typeof metadata.nativeUnit === 'string' && metadata.nativeUnit.trim()
		? metadata.nativeUnit.trim()
		: typeof metadata.native_unit === 'string' && metadata.native_unit.trim()
			? metadata.native_unit.trim()
			: null;
	const directReserved = finiteOrParsedNumber(reservation.reservedNativeAmount);
	const directConsumed = finiteOrParsedNumber(reservation.consumedNativeAmount);
	if ((reservation.nativeUnit ?? null) === nativeUnit && (directReserved !== null || directConsumed !== null)) {
		return {
			reserved: ['reserved', 'consuming'].includes(reservation.state) ? Math.max(directReserved ?? 0, directConsumed ?? 0) : 0,
			consumed: ['consumed', 'failed', 'overran_pending_approval'].includes(reservation.state) ? Math.max(directConsumed ?? 0, 0) : 0,
			inferred: false,
		};
	}
	const metadataReserved = finiteOrParsedNumber(metadata.reservedNativeAmount) ?? finiteOrParsedNumber(metadata.reserved_native_amount);
	const metadataConsumed = finiteOrParsedNumber(metadata.consumedNativeAmount) ?? finiteOrParsedNumber(metadata.consumed_native_amount);
	if (metadataNativeUnit === nativeUnit && (metadataReserved !== null || metadataConsumed !== null)) {
		return {
			reserved: ['reserved', 'consuming'].includes(reservation.state) ? Math.max(metadataReserved ?? 0, metadataConsumed ?? 0) : 0,
			consumed: ['consumed', 'failed', 'overran_pending_approval'].includes(reservation.state) ? Math.max(metadataConsumed ?? 0, 0) : 0,
			inferred: true,
		};
	}
	if (nativeUnit === 'usd' && reservation.reservedUsd !== null) {
		return {
			reserved: ['reserved', 'consuming'].includes(reservation.state) ? Math.max(reservation.reservedUsd ?? 0, reservation.consumedUsd ?? 0) : 0,
			consumed: ['consumed', 'failed', 'overran_pending_approval'].includes(reservation.state) ? Math.max(reservation.consumedUsd ?? 0, 0) : 0,
			inferred: true,
		};
	}
	if (reservation.reservedProviderUnits !== null && executionProvider.nativeUnit === nativeUnit) {
		return {
			reserved: ['reserved', 'consuming'].includes(reservation.state) ? Math.max(reservation.reservedProviderUnits ?? 0, reservation.consumedProviderUnits ?? 0) : 0,
			consumed: ['consumed', 'failed', 'overran_pending_approval'].includes(reservation.state) ? Math.max(reservation.consumedProviderUnits ?? 0, 0) : 0,
			inferred: true,
		};
	}
	return { reserved: 0, consumed: 0, inferred: false };
}

function roundDownCredits(value: number) {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.floor(value * 100) / 100;
}

export function deriveAvailableCredits(input: DerivedCapacityInput): DerivedCapacityAvailability {
	const executionProvider = input.executionProvider;
	const nativeUnit = input.nativeUnit?.trim() || input.nativeLimit?.nativeUnit || executionProvider.nativeUnit;
	const reasons: string[] = [];
	const configuredNativeLimit = finiteOrParsedNumber(input.nativeLimit?.limitAmount);
	const observationRemaining = nativeRemainingAmount(readRecord(input.latestObservation?.nativeRemaining), nativeUnit);
	let nativeBase: number | null = null;
	let nativeRemainingSource: DerivedCapacityAvailability['nativeRemainingSource'] = 'unknown';
	if (observationRemaining !== null) {
		nativeBase = Math.max(0, observationRemaining);
		nativeRemainingSource = 'observation';
		reasons.push('observation_remaining');
	} else if (configuredNativeLimit !== null) {
		nativeBase = Math.max(0, configuredNativeLimit);
		nativeRemainingSource = 'configured_limit';
		reasons.push(executionProvider.quotaVisibility === 'opaque' ? 'opaque_limit_fallback' : 'configured_limit');
	} else {
		reasons.push('missing_native_limit');
	}
	const scopedReservations = (input.activeReservations ?? []).filter((reservation) =>
		reservation.executionProviderId
			? reservation.executionProviderId === executionProvider.id
			: reservation.capacityProviderId === executionProvider.capacityProviderId
	);
	let activeReservedNativeAmount = 0;
	let activeConsumedNativeAmount = 0;
	let inferredReservationCount = 0;
	for (const reservation of scopedReservations) {
		const debit = reservationNativeDebit(reservation, executionProvider, nativeUnit);
		activeReservedNativeAmount += debit.reserved;
		activeConsumedNativeAmount += debit.consumed;
		if (debit.inferred && (debit.reserved > 0 || debit.consumed > 0)) inferredReservationCount += 1;
	}
	if (activeReservedNativeAmount > 0) reasons.push('active_native_reservations');
	if (inferredReservationCount > 0) reasons.push('inferred_legacy_native_reservations');
	const reserveBufferPercent = Math.max(0, finiteOrParsedNumber(input.nativeLimit?.reserveBufferPercent) ?? 0);
	const reserveBufferNativeAmount = configuredNativeLimit === null ? 0 : (configuredNativeLimit * reserveBufferPercent) / 100;
	if (reserveBufferNativeAmount > 0) reasons.push('reserve_buffer');
	const availableNativeAmount = Math.max(0, (nativeBase ?? 0) - activeReservedNativeAmount - reserveBufferNativeAmount);
	const profile = input.conversionProfile ?? null;
	let nativeUnitsPerCredit = profile?.nativeUnitsPerCreditP90 ?? null;
	let confidence = profile?.confidence ?? 'low';
	if (nativeUnitsPerCredit !== null && nativeUnitsPerCredit > 0) {
		reasons.push('p90_conversion_profile');
	} else if (profile?.nativeUnitsPerCreditP50 !== null && profile?.nativeUnitsPerCreditP50 !== undefined && profile.nativeUnitsPerCreditP50 > 0) {
		nativeUnitsPerCredit = profile.nativeUnitsPerCreditP50;
		confidence = lowerDerivedConfidence(profile.confidence);
		reasons.push('p50_conversion_fallback');
	} else {
		reasons.push('missing_conversion_profile');
	}
	if (nativeRemainingSource === 'unknown') confidence = 'low';
	const derivedAvailableCredits = nativeUnitsPerCredit !== null && nativeUnitsPerCredit > 0
		? roundDownCredits(availableNativeAmount / nativeUnitsPerCredit)
		: null;
	return {
		executionProviderId: executionProvider.id,
		capacityProviderId: executionProvider.capacityProviderId,
		executionProviderKind: executionProvider.kind,
		nativeUnit,
		scope: input.scope ?? input.nativeLimit?.scope ?? null,
		configuredNativeLimit,
		observedNativeRemaining: observationRemaining,
		nativeRemainingSource,
		activeReservedNativeAmount,
		activeConsumedNativeAmount,
		reserveBufferPercent,
		reserveBufferNativeAmount,
		availableNativeAmount,
		nativeUnitsPerCredit,
		conversionProfileId: profile?.id ?? null,
		conversionTaskSignature: profile?.taskSignature ?? null,
		conversionConfidence: profile?.confidence ?? null,
		derivedAvailableCredits,
		confidence,
		resetAt: input.latestObservation?.resetAt ?? input.nativeLimit?.resetAt ?? null,
		reasons: [...new Set(reasons)],
		metadata: {
			quotaVisibility: executionProvider.quotaVisibility,
			latestObservedAt: input.latestObservation?.observedAt ?? null,
			conversionFormulaVersion: profile?.formulaVersion ?? null,
		},
	};
}

export function calculateActualCredits(input: ActualCreditCalculationInput): ActualCreditCalculation {
	const native = objectActualValue(input.nativeUsage);
	const metadata = objectActualValue(native.metadata);
	const wallMinutes = firstActualMetric(input.wallMinutes, native.wallMinutes, native.wall_minutes, native.durationMinutes, native.duration_minutes);
	const quotaMinutes = firstActualMetric(input.quotaMinutes, native.quotaMinutes, native.quota_minutes);
	const inputTokens = firstActualMetric(input.inputTokens, native.inputTokens, native.input_tokens);
	const outputTokens = firstActualMetric(input.outputTokens, native.outputTokens, native.output_tokens);
	const cachedInputTokens = firstActualMetric(input.cachedInputTokens, native.cachedInputTokens, native.cached_input_tokens);
	const usd = firstActualMetric(input.actualUsd, native.usd, native.costUsd, native.cost_usd);
	const filesOpened = firstActualMetric(input.filesOpened, native.filesOpened, native.files_opened);
	const filesChanged = firstActualMetric(input.filesChanged, native.filesChanged, native.files_changed);
	const diffLinesAdded = firstActualMetric(input.diffLinesAdded, native.diffLinesAdded, native.diff_lines_added);
	const diffLinesRemoved = firstActualMetric(input.diffLinesRemoved, native.diffLinesRemoved, native.diff_lines_removed);
	const testRuns = firstActualMetric(input.testRuns, native.testRuns, native.test_runs);
	const retryCount = firstActualMetric(input.retryCount, native.retryCount, native.retry_count);
	const nativeUnit = typeof native.nativeUnit === 'string'
		? native.nativeUnit
		: typeof native.native_unit === 'string'
			? native.native_unit
			: nativeUsageUnit(native)
				?? (wallMinutes !== null ? 'wall_minute' : quotaMinutes !== null ? 'quota_minute' : usd !== null ? 'usd' : Math.max(0, (inputTokens ?? 0) + (outputTokens ?? 0) - (cachedInputTokens ?? 0)) > 0 ? 'token' : null);
	const observedAt = typeof native.observedAt === 'string'
		? native.observedAt
		: typeof native.observed_at === 'string'
			? native.observed_at
			: null;
	const partial = booleanActualFlag(native.partial) || booleanActualFlag(metadata.partial);
	const interrupted = booleanActualFlag(native.interrupted) || booleanActualFlag(metadata.interrupted);
	const legacyActualCredits = finiteActualMetric(input.legacyActualCredits);
	const reservedCredits = finiteActualMetric(input.reservedCredits);

	const components: Record<string, number> = {};
	if (wallMinutes !== null && wallMinutes > 0) {
		components.wallMinutes = Math.ceil(wallMinutes / 5);
	} else if (quotaMinutes !== null && quotaMinutes > 0) {
		components.quotaMinutes = Math.ceil(quotaMinutes / 5);
	}
	if (usd !== null && usd > 0) components.usd = roundUpCreditComponent(usd / 0.03);
	const billableTokens = Math.max(0, (inputTokens ?? 0) + (outputTokens ?? 0) - (cachedInputTokens ?? 0));
	if (billableTokens > 0) components.tokens = Math.ceil(billableTokens / 8000);
	if (filesChanged !== null && filesChanged > 0) components.filesChanged = Math.ceil(filesChanged) * 2;
	if (testRuns !== null && testRuns > 0) components.testRuns = Math.ceil(testRuns);
	if (retryCount !== null && retryCount > 0) components.retryCount = Math.ceil(retryCount) * 3;

	const nativeUsage: NativeUsageObservation = {
		...native,
		nativeUnit,
		wallMinutes,
		quotaMinutes,
		inputTokens,
		outputTokens,
		cachedInputTokens,
		usd,
		filesOpened,
		filesChanged,
		diffLinesAdded,
		diffLinesRemoved,
		testRuns,
		retryCount,
		partial,
		interrupted,
		source: typeof native.source === 'string' ? native.source : input.source ?? null,
		observedAt,
		metadata,
	};
	const componentTotal = Object.values(components).reduce((total, value) => total + value, 0);
	const conversionProfile = input.conversionProfile ?? null;
	const conversionProfileNativeAmount = conversionProfile
		? nativeUsageAmount(nativeUsage, conversionProfile.nativeUnit)
		: null;
	const conversionProfileCredits = conversionProfileNativeAmount !== null
		&& conversionProfileNativeAmount > 0
		&& conversionProfile.nativeUnitsPerCreditP50 !== null
		&& conversionProfile.nativeUnitsPerCreditP50 > 0
		? roundActualCredits(conversionProfileNativeAmount / conversionProfile.nativeUnitsPerCreditP50)
		: null;
	if (legacyActualCredits !== null && input.actualCreditsOverride === true) {
		return {
			actualCredits: roundActualCredits(legacyActualCredits),
			formulaVersion: ACTUAL_CREDIT_FORMULA_VERSION,
			source: 'legacy_override',
			nativeUsage,
			components,
			partial,
			interrupted,
			conversionProfileId: conversionProfile?.id ?? null,
			conversionConfidence: conversionProfile?.confidence ?? null,
		};
	}
	if (conversionProfile?.confidence === 'high' && conversionProfileCredits !== null) {
		return {
			actualCredits: conversionProfileCredits,
			formulaVersion: ACTUAL_CREDIT_FORMULA_VERSION,
			source: 'conversion_profile',
			nativeUsage,
			components: {
				...components,
				conversionProfile: conversionProfileCredits,
			},
			partial,
			interrupted,
			conversionProfileId: conversionProfile.id ?? null,
			conversionConfidence: conversionProfile.confidence,
		};
	}
	if (conversionProfile?.confidence === 'medium' && conversionProfileCredits !== null && componentTotal > 0) {
		return {
			actualCredits: roundActualCredits((conversionProfileCredits + componentTotal) / 2),
			formulaVersion: ACTUAL_CREDIT_FORMULA_VERSION,
			source: 'blended_conversion_profile',
			nativeUsage,
			components: {
				...components,
				conversionProfile: conversionProfileCredits,
				bootstrap: roundActualCredits(componentTotal),
			},
			partial,
			interrupted,
			conversionProfileId: conversionProfile.id ?? null,
			conversionConfidence: conversionProfile.confidence,
		};
	}
	if (componentTotal > 0) {
		return {
			actualCredits: roundActualCredits(componentTotal),
			formulaVersion: ACTUAL_CREDIT_FORMULA_VERSION,
			source: 'central_calculator',
			nativeUsage,
			components,
			partial,
			interrupted,
			conversionProfileId: conversionProfile?.id ?? null,
			conversionConfidence: conversionProfile?.confidence ?? null,
		};
	}
	if (legacyActualCredits !== null) {
		return {
			actualCredits: roundActualCredits(legacyActualCredits),
			formulaVersion: ACTUAL_CREDIT_FORMULA_VERSION,
			source: 'legacy_fallback',
			nativeUsage,
			components,
			partial,
			interrupted,
			conversionProfileId: conversionProfile?.id ?? null,
			conversionConfidence: conversionProfile?.confidence ?? null,
		};
	}
	if (reservedCredits !== null) {
		return {
			actualCredits: roundActualCredits(reservedCredits),
			formulaVersion: ACTUAL_CREDIT_FORMULA_VERSION,
			source: 'reserved_fallback',
			nativeUsage,
			components,
			partial,
			interrupted,
			conversionProfileId: conversionProfile?.id ?? null,
			conversionConfidence: conversionProfile?.confidence ?? null,
		};
	}
	return {
		actualCredits: 0,
		formulaVersion: ACTUAL_CREDIT_FORMULA_VERSION,
		source: 'zero_fallback',
		nativeUsage,
		components,
		partial,
		interrupted,
		conversionProfileId: conversionProfile?.id ?? null,
		conversionConfidence: conversionProfile?.confidence ?? null,
	};
}

export interface CapacityEstimateInput {
	taskSignature?: string | null;
	taskKind?: string | null;
	confidence?: CapacityEstimateConfidence | null;
	estimatedCreditsP50?: number | null;
	estimatedCreditsP90?: number | null;
	profile?: TaskEstimateProfile | null;
	profiles?: TaskEstimateProfile[] | null;
	defaultCredits?: number | null;
	executionProfile?: ExecutionProfile | null;
	executionProfileId?: string | null;
	costMultiplier?: number | null;
}

export interface CapacityLaneCandidate {
	lane: CapacityProviderLane;
	grant?: CapacityGrant | null;
	remainingCredits?: number | null;
	agentProfile?: AgentProviderProfile | null;
	taskKind?: string | null;
	requiredCapabilities?: string[];
	modelClass?: string | null;
	region?: string | null;
}

export interface CapacityLaneScore {
	laneId: string;
	capacityProviderId: string;
	score: number;
	agentFit: number;
	scarcityPenalty: number;
	fairnessScore: number;
	costPenalty: number;
	qualityFit?: number;
	latencyPenalty?: number;
	quotaPressure?: number;
	congestionPenalty?: number;
	attentionPenalty?: number;
	contextPenalty?: number;
	nativePressurePenalty?: number;
	utilityScore?: number;
	utilityPerCredit?: number;
	predictedReserveImpact?: number;
	trustScore?: number | null;
	successProbability?: number | null;
	executionProfileId?: string | null;
	reservedCredits?: number | null;
	attentionEstimate?: AttentionEstimate | null;
	utilityEstimate?: UtilityEstimate | null;
	reservePrediction?: ReservePrediction | null;
	spilloverReason?: string | null;
	trustScore?: number | null;
	successProbability?: number | null;
	reasons: string[];
}

export interface CapacityTaskEstimate {
	taskSignature: string;
	confidence: CapacityEstimateConfidence;
	estimatedCreditsP50: number;
	estimatedCreditsP90: number;
	reservedCredits: number;
	baseReservedCredits?: number;
	executionProfileId?: string | null;
	costMultiplier?: number | null;
}

export interface AdmissionEstimateInput extends CapacityEstimateInput {
	classification?: TaskClassification | null;
}

export interface WorkdayBudgetEnvelopeInput {
	dailyCreditBudget: number;
	usedCredits?: number | null;
	queuedCredits?: number | null;
	reserveBufferPercent?: number | null;
	recoveryBudgetCredits?: number | null;
}

export interface TaskAdmissionInput {
	classification: TaskClassification;
	estimate: CapacityTaskEstimate;
	budget: WorkdayBudgetEnvelopeInput;
	policy?: Partial<TaskAdmissionPolicy> | null;
	source?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CapacityInterruptionInput {
	reservedCredits?: number | null;
	consumedCredits?: number | null;
	estimatedRemainingCreditsP50?: number | null;
	estimatedRemainingCreditsP90?: number | null;
	reservationUsedPercentThreshold?: number | null;
	recoveryBudgetRemainingCredits?: number | null;
	recoveryBudgetMinimumCredits?: number | null;
	providerAvailable?: boolean | null;
}

export interface TeamCapacitySummary {
	teamId: string;
	monthlyCredits: number | null;
	monthlyUsedCredits: number;
	monthlyRemainingCredits: number | null;
	dailyCredits: number | null;
	dailyUsedCredits: number;
	dailyReservedCredits: number;
	dailyRemainingCredits: number | null;
	providerCount: number;
	activeProviderCount: number;
	degradedProviderCount: number;
	grantCount: number;
	blockedTaskCount: number;
	approvalRequiredCount: number;
}

export interface ProjectCapacitySummary extends TeamCapacitySummary {
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	readiness:
		| 'ready'
		| 'waiting_for_budget'
		| 'waiting_for_provider'
		| 'paused_by_policy'
		| 'needs_approval';
	reasons: string[];
}

export interface RouteAndReserveInput {
	plan: CapacityPlan;
	estimate: CapacityTaskEstimate;
	classification?: TaskClassification | null;
	taskId?: string | null;
	workDayId?: string | null;
	taskKind?: string | null;
	requiredCapabilities?: string[];
	modelClass?: string | null;
	priorityClass?: string | null;
	allowDegradedProviders?: boolean;
	repositoryMutation?: boolean;
	production?: boolean;
	selectedModel?: string | null;
	executionProfile?: ExecutionProfile | string | null;
	executionProfiles?: Array<ExecutionProfile | string> | null;
	estimateProfiles?: TaskEstimateProfile[] | null;
	minimumQualityWeight?: number | null;
	requiredContextTokens?: number | null;
	estimatedContextTokens?: number | null;
	attentionWeight?: number | null;
	coordinationWeight?: number | null;
	minimumAttentionAvailable?: number | null;
	attentionPolicy?: Partial<AttentionPolicy> | null;
	attentionEstimate?: AttentionEstimate | null;
	utilityPolicy?: Partial<UtilityPolicy> | null;
	utilityEstimate?: UtilityEstimate | null;
	utilityValue?: number | null;
	maintenanceValue?: number | null;
	deadlineAt?: string | null;
	successProbability?: number | null;
	trustRequirement?: number | null;
	cooperativeRouting?: boolean | null;
	predictiveReservePolicy?: Partial<PredictiveReservePolicy> | null;
	hybridExecutionPlan?: HybridExecutionPlan | Record<string, unknown> | null;
	preferredExecutionProfiles?: string[] | null;
	disallowedExecutionProfiles?: string[] | null;
	source?: string;
	metadata?: Record<string, unknown>;
}

export type RouteAndReserveBlockCode =
	| 'no_capacity_provider'
	| 'no_capacity_grant'
	| 'no_eligible_lane'
	| 'insufficient_budget'
	| 'approval_required';

export interface RouteAndReserveCandidate {
	providerId: string;
	laneId: string;
	grantId: string;
	executionProviderId?: string | null;
	executionProfileId?: string | null;
	nativeUnit?: string | null;
	remainingCredits: number | null;
	staticRemainingCredits?: number | null;
	derivedAvailableCredits?: number | null;
	reservedNativeAmount?: number | null;
	derivedCapacity?: DerivedCapacityAvailability | null;
	derivedCapacityMode?: 'static' | 'hybrid' | 'derived';
	score: CapacityLaneScore;
	eligible: boolean;
	reasons: string[];
	estimate?: CapacityTaskEstimate;
	pressure?: CapacityRoutePressure;
	nativePressure?: CapacityRouteNativePressure | null;
	qualityFit?: number;
	attentionEstimate?: AttentionEstimate;
	utilityEstimate?: UtilityEstimate;
	reservePrediction?: ReservePrediction | null;
	trustScore?: number | null;
	successProbability?: number | null;
	spilloverReason?: string | null;
}

export interface CapacityRouteNativePressure {
	executionProviderId: string;
	nativeUnit: string;
	availableNativeAmount: number;
	activeReservedNativeAmount: number;
	reserveBufferNativeAmount: number;
	reservedNativeAmount: number | null;
	pressureRatio: number | null;
	confidence: string;
	reasons: string[];
}

export interface CapacityRoutePressure {
	activeReservations: number;
	maxActiveReservations: number | null;
	congestionRatio: number;
	quotaRemainingPercent: number | null;
	sessionRemainingMinutes: number | null;
	subscriptionSaturationPercent: number | null;
	providerUnavailable: boolean;
	activeAttentionLoad: number;
	maxAttentionLoad: number | null;
	attentionSaturationPercent: number | null;
	activeContextTokens: number;
	maxContextTokens: number | null;
	contextSaturationPercent: number | null;
}

export type RouteAndReserveResult =
	| {
		ok: true;
		provider: CapacityProvider;
		lane: CapacityProviderLane;
		grant: CapacityGrant;
		estimate: CapacityTaskEstimate;
		remainingCreditsBefore: number | null;
		reservation: CreateCapacityReservationRequest;
		routingDecision: CreateCapacityRoutingDecisionRequest;
		ledgerEntry: RecordCapacityUsageRequest;
		capacityMetadata: {
			providerId: string;
			laneId: string;
			grantId: string;
			reservationId: string | null;
			routingDecisionId: string | null;
			estimatedCreditsP50: number;
			estimatedCreditsP90: number;
			reservedCredits: number;
			executionProviderId?: string | null;
			nativeUnit?: string | null;
			reservedNativeAmount?: number | null;
			derivedAvailableCredits?: number | null;
			derivedCapacityMode?: 'static' | 'hybrid' | 'derived';
			nativePressure?: CapacityRouteNativePressure | null;
			executionProfileId?: string | null;
			costMultiplier?: number | null;
			score?: number | null;
			attentionEstimate?: AttentionEstimate | null;
			utilityEstimate?: UtilityEstimate | null;
			reservePrediction?: ReservePrediction | null;
			hybridExecutionPlan?: HybridExecutionPlan | null;
			candidates?: Record<string, unknown>[];
		};
		candidates: RouteAndReserveCandidate[];
	}
	| {
		ok: false;
		code: RouteAndReserveBlockCode;
		reason: string;
		estimate: CapacityTaskEstimate;
		candidates: RouteAndReserveCandidate[];
	};

export interface CapacitySettlementInput {
	reservation: CapacityReservation;
	actualCredits: number;
	actualProviderUnits?: number | null;
	actualUsd?: number | null;
	teamId?: string | null;
	projectId?: string | null;
	workDayId?: string | null;
	taskId?: string | null;
	source?: string;
	metadata?: Record<string, unknown>;
}

export interface CapacitySettlement {
	reservationId: string;
	state: 'consumed' | 'overran_pending_approval';
	consumeEntry: RecordCapacityUsageRequest;
	releaseEntry: RecordCapacityUsageRequest | null;
	overrunEntry: RecordCapacityUsageRequest | null;
	consumedCredits: number;
	releasedCredits: number;
	overrunCredits: number;
}

export const DEFAULT_EXECUTION_PROFILE_ID = 'standard-code-model';

function finiteNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteOrParsedNumber(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function stringValue(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveNumber(value: unknown, fallback: number) {
	const parsed = finiteNumber(value);
	return parsed !== null && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number) {
	const parsed = finiteNumber(value);
	return parsed !== null && parsed >= 0 ? parsed : fallback;
}

function scarcityPenalty(level: CapacityScarcityLevel) {
	if (level === 'high') return 35;
	if (level === 'medium') return 15;
	return 0;
}

function metadataStatus(value: Record<string, unknown> | undefined) {
	const status = value?.status;
	return typeof status === 'string' ? status : null;
}

function stringArray(value: unknown) {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function booleanValue(value: unknown) {
	return typeof value === 'boolean' ? value : null;
}

function numberValue(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function profileIdFrom(input?: ExecutionProfile | string | null) {
	if (!input) return DEFAULT_EXECUTION_PROFILE_ID;
	if (typeof input === 'string') return input.trim() || DEFAULT_EXECUTION_PROFILE_ID;
	return input.id?.trim() || DEFAULT_EXECUTION_PROFILE_ID;
}

function metadataFlag(metadata: Record<string, unknown> | null | undefined, key: string) {
	return metadata?.[key] === true || metadata?.[key] === 'true';
}

function numericActuals(values: Array<number | null | undefined>) {
	return values
		.map((value) => finiteOrParsedNumber(value))
		.filter((value): value is number => value !== null && value >= 0)
		.sort((left, right) => left - right);
}

export function estimateLearningPercentile(values: Array<number | null | undefined>, percentile: number) {
	const sorted = numericActuals(values);
	if (sorted.length === 0) return null;
	const bounded = Math.min(100, Math.max(0, percentile));
	const index = Math.ceil((bounded / 100) * sorted.length) - 1;
	return sorted[Math.min(sorted.length - 1, Math.max(0, index))] ?? null;
}

export function estimateLearningVariance(values: Array<number | null | undefined>) {
	const samples = numericActuals(values);
	if (samples.length <= 1) return 0;
	const mean = samples.reduce((total, value) => total + value, 0) / samples.length;
	return samples.reduce((total, value) => total + ((value - mean) ** 2), 0) / samples.length;
}

export function isInterruptedUsageActual(actual: Pick<TaskUsageActual, 'metadata'> | { metadata?: Record<string, unknown> | null }) {
	const metadata = actual.metadata ?? {};
	return metadataFlag(metadata, 'interrupted') || metadataFlag(metadata, 'partial');
}

export function estimateProfileConfidenceScore(input: {
	sampleCount?: number | null;
	creditsVariance?: number | null;
	creditsP50?: number | null;
	lastSampleAt?: string | null;
	now?: Date | string | null;
}) {
	const sampleCount = Math.max(0, Math.floor(finiteOrParsedNumber(input.sampleCount) ?? 0));
	const sampleScore = Math.min(1, sampleCount / 20);
	const p50 = Math.max(1, finiteOrParsedNumber(input.creditsP50) ?? 1);
	const variance = Math.max(0, finiteOrParsedNumber(input.creditsVariance) ?? 0);
	const varianceScore = 1 / (1 + (Math.sqrt(variance) / p50));
	let ageScore = 1;
	if (input.lastSampleAt) {
		const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
		const last = new Date(input.lastSampleAt);
		if (Number.isFinite(last.valueOf()) && Number.isFinite(now.valueOf())) {
			const days = Math.max(0, (now.valueOf() - last.valueOf()) / 86_400_000);
			ageScore = days > 90 ? 0.35 : days > 30 ? 0.7 : 1;
		}
	}
	return Math.max(0, Math.min(1, sampleScore * varianceScore * ageScore));
}

export function estimateConfidenceFromProfile(profile: TaskEstimateProfile | null | undefined, now?: Date | string | null): CapacityEstimateConfidence {
	if (!profile) return 'medium';
	const confidenceScore = finiteOrParsedNumber(profile.confidenceScore)
		?? estimateProfileConfidenceScore({
			sampleCount: profile.completedSampleCount ?? profile.sampleCount,
			creditsVariance: profile.creditsVariance,
			creditsP50: profile.creditsP50,
			lastSampleAt: profile.lastSampleAt ?? profile.updatedAt,
			now,
		});
	if (confidenceScore >= 0.75) return 'high';
	if (confidenceScore >= 0.35) return 'medium';
	return 'low';
}

export function selectTaskEstimateProfile(input: {
	profiles?: TaskEstimateProfile[] | null;
	taskSignature?: string | null;
	executionProfile?: ExecutionProfile | string | null;
	executionProfileId?: string | null;
}) {
	const taskSignature = input.taskSignature?.trim();
	if (!taskSignature) return null;
	const executionProfileId = input.executionProfileId?.trim() || profileIdFrom(input.executionProfile);
	const profiles = input.profiles ?? [];
	return profiles.find((profile) =>
		profile.taskSignature === taskSignature
		&& (profile.executionProfileId || DEFAULT_EXECUTION_PROFILE_ID) === executionProfileId
	)
		?? profiles.find((profile) =>
			profile.taskSignature === taskSignature
			&& (profile.executionProfileId || DEFAULT_EXECUTION_PROFILE_ID) === DEFAULT_EXECUTION_PROFILE_ID
		)
		?? null;
}

export function buildTaskEstimateProfileFromActuals(input: {
	taskSignature: string;
	executionProfileId?: string | null;
	actuals: TaskUsageActual[];
	now?: Date | string | null;
}): TaskEstimateProfile {
	const taskSignature = input.taskSignature;
	const executionProfileId = input.executionProfileId?.trim() || DEFAULT_EXECUTION_PROFILE_ID;
	const matching = input.actuals.filter((actual) =>
		actual.taskSignature === taskSignature
		&& (actual.executionProfileId || DEFAULT_EXECUTION_PROFILE_ID) === executionProfileId
	);
	const completed = matching.filter((actual) => !isInterruptedUsageActual(actual));
	const interrupted = matching.filter((actual) => isInterruptedUsageActual(actual));
	const credits = completed.map((actual) => actual.actualCredits);
	const creditsP50 = estimateLearningPercentile(credits, 50);
	const creditsP90 = estimateLearningPercentile(credits, 90);
	const creditsVariance = estimateLearningVariance(credits);
	const outlierLimit = creditsP90 === null ? null : Math.max(creditsP90 * 1.5, (creditsP50 ?? creditsP90) + Math.sqrt(creditsVariance));
	const lastCreatedAt = matching
		.map((actual) => actual.createdAt)
		.filter((value): value is string => typeof value === 'string' && value.length > 0)
		.sort();
	const partialCredits = interrupted.reduce((total, actual) => total + Math.max(0, finiteOrParsedNumber(actual.actualCredits) ?? 0), 0);
	const updatedAt = input.now instanceof Date ? input.now.toISOString() : typeof input.now === 'string' ? input.now : new Date().toISOString();
	return {
		taskSignature,
		executionProfileId,
		sampleCount: matching.length,
		completedSampleCount: completed.length,
		interruptedSampleCount: interrupted.length,
		inputTokensP50: estimateLearningPercentile(completed.map((actual) => actual.inputTokens), 50),
		inputTokensP90: estimateLearningPercentile(completed.map((actual) => actual.inputTokens), 90),
		outputTokensP50: estimateLearningPercentile(completed.map((actual) => actual.outputTokens), 50),
		outputTokensP90: estimateLearningPercentile(completed.map((actual) => actual.outputTokens), 90),
		quotaMinutesP50: estimateLearningPercentile(completed.map((actual) => actual.quotaMinutes), 50),
		quotaMinutesP90: estimateLearningPercentile(completed.map((actual) => actual.quotaMinutes), 90),
		filesChangedP50: estimateLearningPercentile(completed.map((actual) => actual.filesChanged), 50),
		filesChangedP90: estimateLearningPercentile(completed.map((actual) => actual.filesChanged), 90),
		creditsP50,
		creditsP90,
		creditsVariance,
		confidenceScore: estimateProfileConfidenceScore({
			sampleCount: completed.length,
			creditsVariance,
			creditsP50,
			lastSampleAt: lastCreatedAt.at(-1) ?? null,
			now: input.now,
		}),
		outlierCount: outlierLimit === null ? 0 : credits.filter((value) => value > outlierLimit).length,
		partialCredits,
		firstSampleAt: lastCreatedAt[0] ?? null,
		lastSampleAt: lastCreatedAt.at(-1) ?? null,
		updatedAt,
	};
}

export const DEFAULT_EXECUTION_PROFILES: Record<string, ExecutionProfile> = {
	'local-runner': {
		id: 'local-runner',
		modelClass: 'local',
		qualityWeight: 1,
		costMultiplier: 1,
		latencyClass: 'low',
		concurrencyClass: 'read_only',
		quotaBehavior: 'compute_bound',
	},
	'local-fast-model': {
		id: 'local-fast-model',
		modelClass: 'local',
		qualityWeight: 0.65,
		costMultiplier: 0.35,
		latencyClass: 'low',
		concurrencyClass: 'read_only',
		quotaBehavior: 'compute_bound',
	},
	'small-code-model': {
		id: 'small-code-model',
		modelClass: 'coding',
		qualityWeight: 0.75,
		costMultiplier: 0.5,
		latencyClass: 'low',
		concurrencyClass: 'repository_claim',
		quotaBehavior: 'api_metered',
	},
	'standard-code-model': {
		id: 'standard-code-model',
		modelClass: 'coding',
		qualityWeight: 1,
		costMultiplier: 1,
		latencyClass: 'medium',
		concurrencyClass: 'repository_claim',
		quotaBehavior: 'api_metered',
	},
	'large-reasoning-model': {
		id: 'large-reasoning-model',
		modelClass: 'reasoning',
		qualityWeight: 1.5,
		costMultiplier: 3,
		latencyClass: 'high',
		concurrencyClass: 'exclusive_project',
		quotaBehavior: 'api_metered',
	},
	'long-context-architect': {
		id: 'long-context-architect',
		modelClass: 'reasoning',
		contextWindowTokens: 200_000,
		qualityWeight: 1.75,
		costMultiplier: 4,
		latencyClass: 'high',
		concurrencyClass: 'exclusive_project',
		quotaBehavior: 'api_metered',
	},
	'cheap-review-model': {
		id: 'cheap-review-model',
		modelClass: 'review',
		qualityWeight: 0.8,
		costMultiplier: 0.6,
		latencyClass: 'low',
		concurrencyClass: 'read_only',
		quotaBehavior: 'api_metered',
	},
	'human-review': {
		id: 'human-review',
		modelClass: 'human',
		qualityWeight: 2,
		costMultiplier: 10,
		latencyClass: 'high',
		concurrencyClass: 'human_attention',
		quotaBehavior: 'attention_bound',
	},
};

export const DEFAULT_TASK_ADMISSION_POLICY: TaskAdmissionPolicy = {
	planningThresholdCredits: 20,
	approvalThresholdCredits: 50,
	reserveBufferPercent: 15,
	recoveryBudgetCredits: 0,
	maxDownstreamTasks: 4,
	maxPlanningDepth: 2,
	maxAdmittedPlanTasksPerCycle: 4,
	planningTaskSignature: 'planner.dag_proposal',
	allowBackfill: true,
	maxAttentionLoad: null,
	reserveAttentionPercent: 0,
	maxContextTokens: null,
	maxContextSaturationPercent: 100,
	coordinationOverheadFactor: 1,
	predictiveReservePolicy: null,
	utilityPolicy: null,
};

export function normalizeExecutionProfile(input?: ExecutionProfile | string | null) {
	if (!input) return DEFAULT_EXECUTION_PROFILES['standard-code-model'];
	if (typeof input === 'string') {
		return DEFAULT_EXECUTION_PROFILES[input] ?? {
			id: input,
			qualityWeight: 1,
			costMultiplier: 1,
			latencyClass: 'medium',
			metadata: { source: 'ad_hoc' },
		};
	}
	return {
		...input,
		qualityWeight: positiveNumber(input.qualityWeight, 1),
		costMultiplier: positiveNumber(input.costMultiplier, 1),
		latencyClass: input.latencyClass || 'medium',
	};
}

export function normalizeTaskAdmissionPolicy(input: Partial<TaskAdmissionPolicy> | null | undefined = {}) {
	const reserveBufferPercent = nonNegativeNumber(input?.reserveBufferPercent, DEFAULT_TASK_ADMISSION_POLICY.reserveBufferPercent);
	return {
		...DEFAULT_TASK_ADMISSION_POLICY,
		...(input ?? {}),
		planningThresholdCredits: positiveNumber(input?.planningThresholdCredits, DEFAULT_TASK_ADMISSION_POLICY.planningThresholdCredits),
		approvalThresholdCredits: positiveNumber(input?.approvalThresholdCredits, DEFAULT_TASK_ADMISSION_POLICY.approvalThresholdCredits),
		reserveBufferPercent: Math.min(100, reserveBufferPercent),
		recoveryBudgetCredits: nonNegativeNumber(input?.recoveryBudgetCredits, DEFAULT_TASK_ADMISSION_POLICY.recoveryBudgetCredits),
		maxDownstreamTasks: Math.max(0, Math.floor(nonNegativeNumber(input?.maxDownstreamTasks, DEFAULT_TASK_ADMISSION_POLICY.maxDownstreamTasks))),
		maxPlanningDepth: Math.max(0, Math.floor(nonNegativeNumber(input?.maxPlanningDepth, DEFAULT_TASK_ADMISSION_POLICY.maxPlanningDepth))),
		maxAdmittedPlanTasksPerCycle: Math.max(1, Math.floor(nonNegativeNumber(input?.maxAdmittedPlanTasksPerCycle, DEFAULT_TASK_ADMISSION_POLICY.maxAdmittedPlanTasksPerCycle))),
		planningTaskSignature: typeof input?.planningTaskSignature === 'string' && input.planningTaskSignature.trim()
			? input.planningTaskSignature.trim()
			: DEFAULT_TASK_ADMISSION_POLICY.planningTaskSignature,
		allowBackfill: input?.allowBackfill ?? DEFAULT_TASK_ADMISSION_POLICY.allowBackfill,
		maxAttentionLoad: finiteOrParsedNumber(input?.maxAttentionLoad) ?? DEFAULT_TASK_ADMISSION_POLICY.maxAttentionLoad,
		reserveAttentionPercent: Math.min(100, nonNegativeNumber(input?.reserveAttentionPercent, DEFAULT_TASK_ADMISSION_POLICY.reserveAttentionPercent ?? 0)),
		maxContextTokens: finiteOrParsedNumber(input?.maxContextTokens) ?? DEFAULT_TASK_ADMISSION_POLICY.maxContextTokens,
		maxContextSaturationPercent: Math.min(100, positiveNumber(input?.maxContextSaturationPercent, DEFAULT_TASK_ADMISSION_POLICY.maxContextSaturationPercent ?? 100)),
		coordinationOverheadFactor: nonNegativeNumber(input?.coordinationOverheadFactor, DEFAULT_TASK_ADMISSION_POLICY.coordinationOverheadFactor ?? 1),
	};
}

export function normalizeAttentionPolicy(input: Partial<AttentionPolicy | TaskAdmissionPolicy> | null | undefined = {}): AttentionPolicy {
	return {
		maxAttentionLoad: finiteOrParsedNumber(input?.maxAttentionLoad) ?? null,
		reserveAttentionPercent: Math.min(100, nonNegativeNumber(input?.reserveAttentionPercent, 0)),
		maxContextTokens: finiteOrParsedNumber(input?.maxContextTokens) ?? null,
		maxContextSaturationPercent: Math.min(100, positiveNumber(input?.maxContextSaturationPercent, 100)),
		coordinationOverheadFactor: nonNegativeNumber(input?.coordinationOverheadFactor, 1),
	};
}

export function normalizeUtilityPolicy(input: Partial<UtilityPolicy> | null | undefined = {}): UtilityPolicy {
	return {
		minimumUtilityScore: finiteOrParsedNumber(input?.minimumUtilityScore) ?? null,
		minimumUtilityPerCredit: finiteOrParsedNumber(input?.minimumUtilityPerCredit) ?? null,
		riskPenaltyFactor: nonNegativeNumber(input?.riskPenaltyFactor, 1),
		deadlineWindowHours: positiveNumber(input?.deadlineWindowHours, 72),
		maintenanceWeight: nonNegativeNumber(input?.maintenanceWeight, 1),
		priorityWeight: nonNegativeNumber(input?.priorityWeight, 1),
	};
}

export function normalizePredictiveReservePolicy(input: Partial<PredictiveReservePolicy> | null | undefined = {}): PredictiveReservePolicy {
	const raw = readRecord(input);
	return {
		enabled: raw.enabled === true || raw.enabled === 'true',
		baseReservePercent: Math.min(100, nonNegativeNumber(input?.baseReservePercent, 0)),
		maxReservePercent: Math.min(100, positiveNumber(input?.maxReservePercent, 50)),
		incidentReservePercent: Math.min(100, nonNegativeNumber(input?.incidentReservePercent, 15)),
		triggerBurstReservePercent: Math.min(100, nonNegativeNumber(input?.triggerBurstReservePercent, 10)),
		deploymentWindowReservePercent: Math.min(100, nonNegativeNumber(input?.deploymentWindowReservePercent, 10)),
		providerDegradationReservePercent: Math.min(100, nonNegativeNumber(input?.providerDegradationReservePercent, 10)),
		quotaPressureReservePercent: Math.min(100, nonNegativeNumber(input?.quotaPressureReservePercent, 10)),
	};
}

function isoHoursUntil(value: unknown, now: Date) {
	if (typeof value !== 'string' || !value.trim()) return null;
	const target = new Date(value);
	if (!Number.isFinite(target.valueOf())) return null;
	return (target.valueOf() - now.valueOf()) / 3_600_000;
}

function riskPenalty(classification: TaskClassification | null | undefined, policy: UtilityPolicy) {
	if (classification?.risk === 'high') return 20 * policy.riskPenaltyFactor;
	if (classification?.risk === 'medium') return 8 * policy.riskPenaltyFactor;
	return 0;
}

function qualityScoreFromProfile(profile: ExecutionProfile, confidence?: CapacityEstimateConfidence | null) {
	const confidenceWeight = confidence === 'high' ? 1.1 : confidence === 'low' ? 0.75 : 1;
	return Math.max(0, profile.qualityWeight * confidenceWeight);
}

export function estimateUtilityForTask(input: {
	classification?: TaskClassification | null;
	executionProfile?: ExecutionProfile | string | null;
	estimate?: Pick<CapacityTaskEstimate, 'reservedCredits'> | null;
	utilityPolicy?: Partial<UtilityPolicy> | null;
	utilityValue?: number | null;
	maintenanceValue?: number | null;
	priority?: number | null;
	deadlineAt?: string | null;
	successProbability?: number | null;
	metadata?: Record<string, unknown> | null;
	source?: string | null;
	now?: Date | string | null;
}): UtilityEstimate {
	const policy = normalizeUtilityPolicy(input.utilityPolicy);
	const profile = normalizeExecutionProfile(input.executionProfile);
	const metadata = readRecord(input.metadata);
	const priority = Math.max(0, finiteOrParsedNumber(input.priority) ?? finiteOrParsedNumber(metadata.priority) ?? 0);
	const explicitUtility = finiteOrParsedNumber(input.utilityValue) ?? finiteOrParsedNumber(metadata.utilityValue);
	const maintenanceValue = Math.max(0, finiteOrParsedNumber(input.maintenanceValue) ?? finiteOrParsedNumber(metadata.maintenanceValue) ?? 0);
	const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
	const hoursUntilDeadline = isoHoursUntil(input.deadlineAt ?? metadata.deadlineAt, now);
	const deadlinePressure = hoursUntilDeadline === null
		? 0
		: Math.max(0, Math.min(30, ((policy.deadlineWindowHours - hoursUntilDeadline) / Math.max(1, policy.deadlineWindowHours)) * 30));
	const successProbability = Math.max(0, Math.min(1, finiteOrParsedNumber(input.successProbability) ?? finiteOrParsedNumber(metadata.successProbability) ?? 1));
	const qualityScore = qualityScoreFromProfile(profile, input.classification?.confidence);
	const baseUtility = explicitUtility ?? ((priority * policy.priorityWeight) + (maintenanceValue * policy.maintenanceWeight));
	const risk = riskPenalty(input.classification, policy);
	const utilityScore = Math.max(0, ((baseUtility + deadlinePressure) * successProbability * Math.max(0.1, qualityScore)) - risk);
	const reservedCredits = Math.max(1, finiteOrParsedNumber(input.estimate?.reservedCredits) ?? 1);
	return {
		utilityValue: Math.max(0, baseUtility),
		maintenanceValue,
		deadlinePressure,
		successProbability,
		qualityScore,
		riskPenalty: risk,
		utilityScore,
		utilityPerCredit: utilityScore / reservedCredits,
		source: input.source ?? 'capacity_utility_estimator',
		metadata,
	};
}

function reserveSignalFlag(metadata: Record<string, unknown>, ...keys: string[]) {
	return keys.some((key) => metadata[key] === true || metadata[key] === 'true');
}

export function predictReserveForCapacityPlan(input: {
	plan?: CapacityPlan | null;
	policy?: Partial<PredictiveReservePolicy> | null;
	dailyCreditBudget?: number | null;
	remainingCredits?: number | null;
	metadata?: Record<string, unknown> | null;
}): ReservePrediction {
	const policy = normalizePredictiveReservePolicy(input.policy);
	const metadata = readRecord(input.metadata);
	const reasons: string[] = [];
	const signals: Record<string, unknown> = {};
	let reservePercent = policy.enabled ? policy.baseReservePercent : 0;
	const providerDegraded = input.plan?.providers.some((provider) => provider.status === 'degraded' || metadataStatus(provider.metadata) === 'degraded') ?? false;
	const quotaPressure = input.plan?.providers.some((provider) => {
		const pressure = readRecord(provider.metadata?.pressure);
		const quota = finiteOrParsedNumber(pressure.quotaRemainingPercent) ?? finiteOrParsedNumber(provider.metadata?.quotaRemainingPercent);
		return quota !== null && quota < 20;
	}) ?? false;
	if (policy.enabled && reserveSignalFlag(metadata, 'incidentLikely', 'likelyIncident')) {
		reservePercent += policy.incidentReservePercent;
		reasons.push('incident_reserve');
		signals.incidentLikely = true;
	}
	if (policy.enabled && reserveSignalFlag(metadata, 'triggerBurstLikely', 'expectedTriggerBurst')) {
		reservePercent += policy.triggerBurstReservePercent;
		reasons.push('trigger_burst_reserve');
		signals.triggerBurstLikely = true;
	}
	if (policy.enabled && reserveSignalFlag(metadata, 'deploymentWindow', 'deploymentWindowActive')) {
		reservePercent += policy.deploymentWindowReservePercent;
		reasons.push('deployment_window_reserve');
		signals.deploymentWindow = true;
	}
	if (policy.enabled && providerDegraded) {
		reservePercent += policy.providerDegradationReservePercent;
		reasons.push('provider_degradation_reserve');
		signals.providerDegraded = true;
	}
	if (policy.enabled && quotaPressure) {
		reservePercent += policy.quotaPressureReservePercent;
		reasons.push('quota_pressure_reserve');
		signals.quotaPressure = true;
	}
	const boundedPercent = Math.min(policy.maxReservePercent, Math.max(0, reservePercent));
	const budget = Math.max(0, finiteOrParsedNumber(input.dailyCreditBudget) ?? finiteOrParsedNumber(input.remainingCredits) ?? input.plan?.remaining.dailyCredits ?? 0);
	const reserveCredits = Math.ceil((budget * boundedPercent) / 100);
	const remaining = Math.max(0, finiteOrParsedNumber(input.remainingCredits) ?? input.plan?.remaining.dailyCredits ?? budget);
	return {
		reservePercent: boundedPercent,
		reserveCredits,
		activelyAllocatableCredits: Math.max(0, remaining - reserveCredits),
		reasons,
		signals,
	};
}

export function normalizeHybridExecutionPlan(input: HybridExecutionPlan | Record<string, unknown> | null | undefined): HybridExecutionPlan | null {
	const record = readRecord(input);
	const rawPhases = Array.isArray(record.phases) ? record.phases : [];
	const phases = rawPhases.map((phase, index) => {
		const entry = readRecord(phase);
		const kind = typeof entry.kind === 'string' && entry.kind.trim() ? entry.kind.trim() : `phase_${index + 1}`;
		const executionProfileId = typeof entry.executionProfileId === 'string' && entry.executionProfileId.trim()
			? entry.executionProfileId.trim()
			: typeof entry.executionProfile === 'string' && entry.executionProfile.trim()
				? entry.executionProfile.trim()
				: DEFAULT_EXECUTION_PROFILE_ID;
		const mutationAllowed = entry.mutationAllowed === true || (kind === 'implementation' && entry.mutationAllowed !== false);
		return {
			id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : kind,
			kind,
			executionProfileId,
			taskSignature: typeof entry.taskSignature === 'string' && entry.taskSignature.trim() ? entry.taskSignature.trim() : null,
			required: entry.required !== false,
			admissionRequired: entry.admissionRequired !== false,
			mutationAllowed,
			metadata: readRecord(entry.metadata),
		};
	});
	if (phases.length === 0) return null;
	return {
		schemaVersion: 1,
		planId: typeof record.planId === 'string' && record.planId.trim() ? record.planId.trim() : 'hybrid-execution-plan',
		phases,
		escalationPolicy: readRecord(record.escalationPolicy),
		metadata: readRecord(record.metadata),
	};
}

export function normalizePlanningPolicy(input: Partial<PlanningPolicy | TaskAdmissionPolicy> | null | undefined = {}): PlanningPolicy {
	const admissionPolicy = normalizeTaskAdmissionPolicy(input);
	return {
		maxDownstreamTasks: admissionPolicy.maxDownstreamTasks,
		maxPlanningDepth: admissionPolicy.maxPlanningDepth,
		maxAdmittedPlanTasksPerCycle: admissionPolicy.maxAdmittedPlanTasksPerCycle,
		planningTaskSignature: admissionPolicy.planningTaskSignature,
	};
}

function stablePlanId(input: Record<string, unknown>) {
	const source = typeof input.sourceTaskId === 'string' && input.sourceTaskId.trim()
		? input.sourceTaskId.trim()
		: typeof input.parentTaskId === 'string' && input.parentTaskId.trim()
			? input.parentTaskId.trim()
			: 'plan';
	return `${source}:proposal`;
}

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readPlanString(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizePlannedTaskNode(value: unknown, index: number): PlannedTaskNode | null {
	const input = readRecord(value);
	const payload = readRecord(input.payload);
	const type = readPlanString(input.type) || readPlanString(payload.type);
	if (!type) return null;
	const id = readPlanString(input.id) || `node-${index + 1}`;
	const p50 = finiteNumber(input.estimatedCreditsP50) ?? finiteNumber(payload.estimatedCreditsP50) ?? finiteNumber(input.estimatedCredits) ?? finiteNumber(payload.estimatedCredits) ?? null;
	const p90 = finiteNumber(input.estimatedCreditsP90) ?? finiteNumber(payload.estimatedCreditsP90) ?? p50;
	return {
		id,
		type,
		agentId: readPlanString(input.agentId) || readPlanString(payload.agentId) || null,
		title: readPlanString(input.title) || null,
		priority: finiteNumber(input.priority) ?? finiteNumber(payload.priority),
		taskSignature: readPlanString(input.taskSignature) || readPlanString(payload.taskSignature) || null,
		payload,
		estimatedCreditsP50: p50,
		estimatedCreditsP90: p90,
		risk: input.risk === 'low' || input.risk === 'medium' || input.risk === 'high' ? input.risk : null,
		mutationScope: input.mutationScope === 'none' || input.mutationScope === 'repository_read' || input.mutationScope === 'repository_write' || input.mutationScope === 'production'
			? input.mutationScope
			: null,
		confidence: input.confidence === 'low' || input.confidence === 'medium' || input.confidence === 'high' ? input.confidence : null,
		expectedFanout: finiteNumber(input.expectedFanout) ?? finiteNumber(payload.expectedFanout),
		requiresApproval: typeof input.requiresApproval === 'boolean' ? input.requiresApproval : null,
		requiresPlanning: typeof input.requiresPlanning === 'boolean' ? input.requiresPlanning : null,
		dependsOn: Array.isArray(input.dependsOn) ? input.dependsOn.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
		metadata: readRecord(input.metadata),
	};
}

export function synthesizePlanEstimate(tasks: PlannedTaskNode[]) {
	const totalEstimatedCreditsP50 = tasks.reduce((total, task) => total + Math.max(0, Math.ceil(finiteNumber(task.estimatedCreditsP50) ?? finiteNumber(task.estimatedCreditsP90) ?? 1)), 0);
	const totalEstimatedCreditsP90 = tasks.reduce((total, task) => {
		const p50 = Math.max(1, Math.ceil(finiteNumber(task.estimatedCreditsP50) ?? 1));
		return total + Math.max(p50, Math.ceil(finiteNumber(task.estimatedCreditsP90) ?? p50));
	}, 0);
	return {
		totalEstimatedCreditsP50,
		totalEstimatedCreditsP90,
	};
}

export function rankPlannedTaskNodes(tasks: PlannedTaskNode[]) {
	const boundedness = (task: PlannedTaskNode) => {
		const fanout = Math.max(0, Math.floor(finiteNumber(task.expectedFanout) ?? 0));
		const riskPenalty = task.risk === 'high' ? 3 : task.risk === 'medium' ? 1 : 0;
		const mutationPenalty = task.mutationScope === 'production' ? 4 : task.mutationScope === 'repository_write' ? 2 : 0;
		return fanout + riskPenalty + mutationPenalty;
	};
	return [...tasks].sort((left, right) => {
		const priorityDelta = (finiteNumber(right.priority) ?? 0) - (finiteNumber(left.priority) ?? 0);
		if (priorityDelta !== 0) return priorityDelta;
		const boundedDelta = boundedness(left) - boundedness(right);
		if (boundedDelta !== 0) return boundedDelta;
		return String(left.id ?? left.type).localeCompare(String(right.id ?? right.type));
	});
}

export function normalizeTaskPlanProposal(input: unknown, policyInput?: Partial<PlanningPolicy | TaskAdmissionPolicy> | null): TaskPlanProposal {
	const policy = normalizePlanningPolicy(policyInput);
	const record = readRecord(input);
	const tasks = (Array.isArray(record.tasks) ? record.tasks : [])
		.map((entry, index) => normalizePlannedTaskNode(entry, index))
		.filter((entry): entry is PlannedTaskNode => Boolean(entry));
	const estimate = synthesizePlanEstimate(tasks);
	const planningDepth = Math.max(0, Math.floor(finiteNumber(record.planningDepth) ?? 0));
	return {
		schemaVersion: 1,
		planId: readPlanString(record.planId) || stablePlanId(record),
		sourceTaskId: readPlanString(record.sourceTaskId) || null,
		parentTaskId: readPlanString(record.parentTaskId) || null,
		planningDepth,
		tasks,
		totalEstimatedCreditsP50: Math.max(0, Math.ceil(finiteNumber(record.totalEstimatedCreditsP50) ?? estimate.totalEstimatedCreditsP50)),
		totalEstimatedCreditsP90: Math.max(0, Math.ceil(finiteNumber(record.totalEstimatedCreditsP90) ?? estimate.totalEstimatedCreditsP90)),
		createdAt: readPlanString(record.createdAt) || null,
		metadata: readRecord(record.metadata),
	};
}

export function validateTaskPlanProposal(input: TaskPlanProposal, policyInput?: Partial<PlanningPolicy | TaskAdmissionPolicy> | null) {
	const policy = normalizePlanningPolicy(policyInput);
	const reasons: string[] = [];
	if (input.planningDepth > policy.maxPlanningDepth) {
		reasons.push('planning_depth_exceeded');
	}
	if (input.tasks.length > policy.maxDownstreamTasks) {
		reasons.push('fanout_limit_exceeded');
	}
	const rejected = input.tasks
		.map((node) => {
			const nodeReasons: string[] = [];
			if (!node.type) nodeReasons.push('missing_type');
			if (Math.max(0, Math.floor(finiteNumber(node.expectedFanout) ?? 0)) > policy.maxDownstreamTasks) {
				nodeReasons.push('node_fanout_limit_exceeded');
			}
			return nodeReasons.length > 0 ? { node, reasons: nodeReasons } : null;
		})
		.filter((entry): entry is { node: PlannedTaskNode; reasons: string[] } => Boolean(entry));
	return {
		ok: reasons.length === 0 && rejected.length === 0,
		reasons,
		rejected,
	};
}

export function progressivelyAdmitPlanProposal(input: {
	proposal: TaskPlanProposal;
	policy?: Partial<PlanningPolicy | TaskAdmissionPolicy> | null;
	availableCredits?: number | null;
	remainingQueuedCredits?: number | null;
	remainingQueuedSlots?: number | null;
}): PlanningAdmissionResult {
	const policy = normalizePlanningPolicy(input.policy);
	const proposal = normalizeTaskPlanProposal(input.proposal, policy);
	const validation = validateTaskPlanProposal(proposal, policy);
	const reasons = [...validation.reasons];
	const admitted: PlannedTaskNode[] = [];
	const deferred: PlannedTaskNode[] = [];
	const rejected = [...validation.rejected];
	if (!validation.ok) {
		return {
			proposal,
			admitted,
			deferred: proposal.tasks.filter((node) => !rejected.some((entry) => entry.node.id === node.id)),
			rejected,
			totalEstimatedCreditsP50: proposal.totalEstimatedCreditsP50,
			totalEstimatedCreditsP90: proposal.totalEstimatedCreditsP90,
			admittedCreditsP90: 0,
			reasons,
		};
	}
	let availableCredits = Math.max(0, Math.floor(nonNegativeNumber(input.availableCredits, Number.POSITIVE_INFINITY)));
	let remainingQueuedCredits = Math.max(0, Math.floor(nonNegativeNumber(input.remainingQueuedCredits, Number.POSITIVE_INFINITY)));
	let remainingQueuedSlots = Math.max(0, Math.floor(nonNegativeNumber(input.remainingQueuedSlots, policy.maxAdmittedPlanTasksPerCycle)));
	let admittedCreditsP90 = 0;
	for (const task of rankPlannedTaskNodes(proposal.tasks)) {
		if (admitted.length >= policy.maxAdmittedPlanTasksPerCycle || remainingQueuedSlots <= 0) {
			deferred.push(task);
			reasons.push('plan_cycle_limit_reached');
			continue;
		}
		const p50 = Math.max(1, Math.ceil(finiteNumber(task.estimatedCreditsP50) ?? 1));
		const p90 = Math.max(p50, Math.ceil(finiteNumber(task.estimatedCreditsP90) ?? p50));
		if (p90 > availableCredits || p90 > remainingQueuedCredits) {
			deferred.push(task);
			reasons.push('insufficient_plan_budget');
			continue;
		}
		admitted.push(task);
		admittedCreditsP90 += p90;
		availableCredits -= p90;
		remainingQueuedCredits -= p90;
		remainingQueuedSlots -= 1;
	}
	return {
		proposal,
		admitted,
		deferred,
		rejected,
		totalEstimatedCreditsP50: proposal.totalEstimatedCreditsP50,
		totalEstimatedCreditsP90: proposal.totalEstimatedCreditsP90,
		admittedCreditsP90,
		reasons: [...new Set(reasons)],
	};
}

export function computeWorkdayBudgetEnvelope(input: WorkdayBudgetEnvelopeInput): WorkdayBudgetEnvelope {
	const dailyCreditBudget = Math.max(0, Math.floor(nonNegativeNumber(input.dailyCreditBudget, 0)));
	const usedCredits = Math.max(0, Math.ceil(nonNegativeNumber(input.usedCredits, 0)));
	const queuedCredits = Math.max(0, Math.ceil(nonNegativeNumber(input.queuedCredits, 0)));
	const reservePercent = Math.min(100, Math.max(0, nonNegativeNumber(input.reserveBufferPercent, DEFAULT_TASK_ADMISSION_POLICY.reserveBufferPercent)));
	const reserveBufferCredits = Math.ceil((dailyCreditBudget * reservePercent) / 100);
	const recoveryBudgetCredits = Math.ceil(nonNegativeNumber(input.recoveryBudgetCredits, DEFAULT_TASK_ADMISSION_POLICY.recoveryBudgetCredits));
	const remainingCredits = Math.max(0, dailyCreditBudget - usedCredits - queuedCredits);
	const activelyAllocatableCredits = Math.max(0, dailyCreditBudget - usedCredits - queuedCredits - reserveBufferCredits - recoveryBudgetCredits);
	return {
		dailyCreditBudget,
		usedCredits,
		queuedCredits,
		reserveBufferCredits,
		recoveryBudgetCredits,
		activelyAllocatableCredits,
		remainingCredits,
	};
}

export function mutationRequiresRepositoryClaim(scope: TaskMutationScope | null | undefined) {
	return scope === 'repository_write' || scope === 'production';
}

function reservationDebit(reservation: CapacityReservation) {
	if (reservation.state === 'released' || reservation.state === 'expired' || reservation.state === 'cancelled') {
		return 0;
	}
	if (reservation.state === 'consumed' || reservation.state === 'failed') {
		return Math.max(0, reservation.consumedCredits);
	}
	return Math.max(reservation.reservedCredits, reservation.consumedCredits, 0);
}

function activeReservationDebit(reservation: CapacityReservation) {
	if (reservation.state === 'reserved' || reservation.state === 'consuming') {
		return Math.max(reservation.reservedCredits, reservation.consumedCredits, 0);
	}
	if (reservation.state === 'consumed' || reservation.state === 'failed') {
		return Math.max(reservation.consumedCredits, 0);
	}
	return 0;
}

function metadataNumber(metadata: Record<string, unknown> | undefined, ...keys: string[]) {
	for (const key of keys) {
		const value = finiteOrParsedNumber(metadata?.[key]);
		if (value !== null) return value;
	}
	return null;
}

function metadataBoolean(metadata: Record<string, unknown> | undefined, ...keys: string[]) {
	for (const key of keys) {
		const value = metadata?.[key];
		if (value === true || value === 'true' || value === 1 || value === '1') return true;
		if (value === false || value === 'false' || value === 0 || value === '0') return false;
	}
	return false;
}

function grantMatchesReservation(grant: CapacityGrant, reservation: CapacityReservation) {
	if (grant.teamId !== reservation.teamId) return false;
	if (grant.capacityProviderId !== reservation.capacityProviderId) return false;
	if (grant.laneId && grant.laneId !== reservation.laneId) return false;
	if (grant.projectId && grant.projectId !== reservation.projectId) return false;
	return true;
}

function grantPortfolioAllocationPercent(grant: CapacityGrant) {
	const metadata = readRecord(grant.metadata);
	const value = finiteOrParsedNumber(grant.portfolioAllocationPercent)
		?? metadataNumber(metadata, 'portfolioAllocationPercent', 'allocationPercent', 'derivedAllocationPercent', 'percentOfDerivedCapacity');
	if (value === null) return null;
	return Math.max(0, Math.min(100, value));
}

function grantReservePoolPercent(grant: CapacityGrant) {
	const metadata = readRecord(grant.metadata);
	const value = finiteOrParsedNumber(grant.reservePoolPercent)
		?? metadataNumber(metadata, 'reservePoolPercent', 'minimumReservePercent', 'reservePercent');
	if (value === null) return 0;
	return Math.max(0, Math.min(100, value));
}

function grantMaxDailyProjectCredits(grant: CapacityGrant) {
	const metadata = readRecord(grant.metadata);
	const value = finiteOrParsedNumber(grant.maxDailyProjectCredits)
		?? metadataNumber(metadata, 'maxDailyProjectCredits', 'dailyProjectCreditCap');
	if (value === null) return null;
	return Math.max(0, value);
}

function grantEmergencyOverrideEnabled(grant: CapacityGrant) {
	return grant.emergencyOverride === true || metadataBoolean(readRecord(grant.metadata), 'emergencyOverride', 'emergencyOverrideEnabled');
}

function routeEmergencyOverrideRequested(input: RouteAndReserveInput) {
	return metadataBoolean(readRecord(input.metadata), 'emergencyOverride', 'emergencyOverrideRequested');
}

function grantPortfolioCreditLimit(grant: CapacityGrant, derivedCapacity?: DerivedCapacityAvailability | null) {
	const percent = grantPortfolioAllocationPercent(grant);
	if (percent === null || !derivedCapacity || derivedCapacity.derivedAvailableCredits === null) return null;
	return Math.max(0, (derivedCapacity.derivedAvailableCredits * percent) / 100);
}

function grantRemainingCredits(plan: CapacityPlan, grant: CapacityGrant, derivedCapacity?: DerivedCapacityAvailability | null, input?: RouteAndReserveInput) {
	const staticLimit = grant.dailyCreditLimit ?? grant.monthlyCreditLimit;
	const portfolioLimit = grantPortfolioCreditLimit(grant, derivedCapacity);
	const maxDailyProjectCredits = grantMaxDailyProjectCredits(grant);
	const limits = [staticLimit, portfolioLimit, maxDailyProjectCredits]
		.filter((value): value is number => value !== null && value !== undefined);
	const limit = limits.length > 0 ? Math.min(...limits.map((value) => Number(value))) : null;
	if (limit === null || limit === undefined) return null;
	const reservePoolPercent = portfolioLimit !== null ? grantReservePoolPercent(grant) : 0;
	const emergencyOverride = input ? routeEmergencyOverrideRequested(input) && grantEmergencyOverrideEnabled(grant) : false;
	const reservePoolCredits = emergencyOverride ? 0 : (limit * reservePoolPercent) / 100;
	const debits = plan.activeReservations
		.filter((reservation) => grantMatchesReservation(grant, reservation))
		.reduce((total, reservation) => total + reservationDebit(reservation), 0);
	return Math.max(0, Number(limit) - reservePoolCredits - debits);
}

function providerIsEligible(provider: CapacityProvider, input: RouteAndReserveInput) {
	if (provider.status === 'active') return true;
	if (provider.status === 'degraded' && input.allowDegradedProviders) return true;
	return false;
}

function grantIsEligible(grant: CapacityGrant, input: RouteAndReserveInput) {
	if (grant.state !== 'active') return false;
	if (grant.teamId !== input.plan.teamId) return false;
	if (grant.environment && grant.environment !== input.plan.environment) return false;
	if (grant.projectId && grant.projectId !== input.plan.projectId) return false;
	return true;
}

function lanePolicyReasons(lane: CapacityProviderLane, input: RouteAndReserveInput) {
	const reasons: string[] = [];
	const laneStatus = metadataStatus(lane.metadata);
	if (laneStatus && laneStatus !== 'active') reasons.push(`lane_status:${laneStatus}`);

	const policy = lane.routingPolicy ?? {};
	const taskKinds = stringArray(policy.taskKinds);
	const taskKind = input.taskKind ?? input.estimate.taskSignature;
	if (taskKinds.length > 0 && !taskKinds.includes(taskKind)) reasons.push('task_kind_mismatch');

	const requiredCapabilities = stringArray(policy.requiredCapabilities);
	const missingCapabilities = (input.requiredCapabilities ?? [])
		.filter((capability) => !requiredCapabilities.includes(capability));
	if (requiredCapabilities.length > 0 && missingCapabilities.length > 0) {
		reasons.push('capability_mismatch');
	}

	const allowedEnvironments = stringArray(policy.allowedEnvironments);
	if (allowedEnvironments.length > 0 && !allowedEnvironments.includes(input.plan.environment)) {
		reasons.push('environment_mismatch');
	}

	const maxCreditsPerTask = numberValue(policy.maxCreditsPerTask);
	if (maxCreditsPerTask !== null && input.estimate.reservedCredits > maxCreditsPerTask) {
		reasons.push('task_credit_limit_exceeded');
	}

	const approvalThreshold = numberValue(policy.requiresApprovalAboveCredits);
	if (approvalThreshold !== null && input.estimate.reservedCredits > approvalThreshold) {
		reasons.push('approval_required');
	}

	const repositoryMutationAllowed = booleanValue(policy.repositoryMutationAllowed);
	if (input.repositoryMutation && repositoryMutationAllowed === false) {
		reasons.push('repository_mutation_not_allowed');
	}

	const productionAllowed = booleanValue(policy.productionAllowed);
	if (input.production && productionAllowed === false) {
		reasons.push('production_not_allowed');
	}

	return reasons;
}

export function reserveCreditsForEstimate(input: CapacityEstimateInput) {
	const executionProfile = input.executionProfile
		? normalizeExecutionProfile(input.executionProfile)
		: input.executionProfileId
			? normalizeExecutionProfile(input.executionProfileId)
			: null;
	const selectedProfile = input.profile ?? selectTaskEstimateProfile({
		profiles: input.profiles,
		taskSignature: input.taskSignature ?? input.taskKind,
		executionProfile,
		executionProfileId: input.executionProfileId,
	});
	const profileP50 = finiteNumber(selectedProfile?.creditsP50);
	const profileP90 = finiteNumber(selectedProfile?.creditsP90);
	const costMultiplier = positiveNumber(input.costMultiplier ?? executionProfile?.costMultiplier ?? 1, 1);
	const p50 = Math.max(1, Math.ceil(
		finiteNumber(input.estimatedCreditsP50)
		?? profileP50
		?? finiteNumber(input.defaultCredits)
		?? 1,
	));
	const p90 = Math.max(p50, Math.ceil(
		finiteNumber(input.estimatedCreditsP90)
		?? profileP90
		?? (p50 * 2),
	));
	const profileConfidence = selectedProfile ? estimateConfidenceFromProfile(selectedProfile) : null;
	const confidence = input.confidence ?? profileConfidence ?? 'medium';
	const baseReserved = confidence === 'high'
		? Math.max(p50, Math.ceil((p50 + p90) * 0.75))
		: p90;
	const reserved = Math.max(1, Math.ceil(baseReserved * costMultiplier));
	return {
		taskSignature: input.taskSignature ?? input.taskKind ?? 'unknown',
		confidence,
		estimatedCreditsP50: p50,
		estimatedCreditsP90: p90,
		reservedCredits: reserved,
		baseReservedCredits: baseReserved,
		executionProfileId: executionProfile?.id ?? input.executionProfileId ?? selectedProfile?.executionProfileId ?? null,
		costMultiplier,
	};
}

export function estimateForClassification(input: AdmissionEstimateInput): CapacityTaskEstimate {
	const classification = input.classification ?? null;
	return reserveCreditsForEstimate({
		...input,
		taskSignature: input.taskSignature ?? classification?.taskSignature,
		confidence: input.confidence ?? classification?.confidence,
	});
}

export function decideTaskAdmission(input: TaskAdmissionInput): TaskAdmissionDecision {
	const policy = normalizeTaskAdmissionPolicy(input.policy);
	const budget = computeWorkdayBudgetEnvelope({
		...input.budget,
		reserveBufferPercent: policy.reserveBufferPercent,
		recoveryBudgetCredits: policy.recoveryBudgetCredits,
	});
	const reasons: string[] = [];
	const reservedCredits = Math.max(1, Math.ceil(input.estimate.reservedCredits));
	const fanout = Math.max(0, Math.floor(input.classification.expectedFanout ?? 0));
	const highRisk = input.classification.risk === 'high' || input.classification.mutationScope === 'production';
	const requiresPlanning =
		input.classification.requiresPlanning
		|| fanout > policy.maxDownstreamTasks
		|| (reservedCredits >= policy.planningThresholdCredits && (input.classification.confidence === 'low' || fanout > 1 || highRisk));
	const requiresApproval =
		input.classification.requiresApproval
		|| highRisk
		|| reservedCredits >= policy.approvalThresholdCredits;

	let outcome: TaskAdmissionDecision['outcome'] = 'admitted';
	if (!input.classification.taskSignature || input.classification.taskSignature === 'unknown') {
		outcome = 'rejected';
		reasons.push('unknown_task_signature');
	}
	if (fanout > policy.maxDownstreamTasks) {
		reasons.push('fanout_limit_exceeded');
	}
	if (requiresPlanning) {
		outcome = 'planning_required';
		reasons.push('planning_required');
	}
	if (requiresApproval) {
		outcome = 'approval_required';
		reasons.push('approval_required');
	}
	if (outcome === 'admitted' && reservedCredits > budget.activelyAllocatableCredits) {
		outcome = 'budget_blocked';
		reasons.push('insufficient_allocatable_budget');
	}

	return {
		outcome,
		taskSignature: input.classification.taskSignature,
		estimatedCreditsP50: input.estimate.estimatedCreditsP50,
		estimatedCreditsP90: input.estimate.estimatedCreditsP90,
		reservedCredits,
		baseReservedCredits: input.estimate.baseReservedCredits,
		executionProfileId: input.estimate.executionProfileId ?? null,
		costMultiplier: input.estimate.costMultiplier ?? null,
		reasons: [...new Set(reasons)],
		requiresApproval,
		requiresPlanning,
		budget,
		policySnapshot: policy,
		metadata: {
			...(input.metadata ?? {}),
			source: input.source ?? null,
			classification: input.classification,
		},
	};
}

export function shouldInterruptForCapacity(input: CapacityInterruptionInput) {
	const reservedCredits = nonNegativeNumber(input.reservedCredits, 0);
	const consumedCredits = nonNegativeNumber(input.consumedCredits, 0);
	const threshold = Math.min(100, Math.max(1, nonNegativeNumber(input.reservationUsedPercentThreshold, 80)));
	const usedPercent = reservedCredits > 0 ? (consumedCredits / reservedCredits) * 100 : 0;
	const estimatedRemainingP50 = nonNegativeNumber(input.estimatedRemainingCreditsP50, 0);
	const estimatedRemainingP90 = nonNegativeNumber(input.estimatedRemainingCreditsP90, estimatedRemainingP50);
	const recoveryBudgetRemaining = input.recoveryBudgetRemainingCredits === undefined || input.recoveryBudgetRemainingCredits === null
		? null
		: nonNegativeNumber(input.recoveryBudgetRemainingCredits, 0);
	const recoveryMinimum = nonNegativeNumber(input.recoveryBudgetMinimumCredits, 3);
	const reasons: string[] = [];
	if (input.providerAvailable === false) {
		reasons.push('provider_unavailable');
	}
	if (reservedCredits > 0 && usedPercent >= threshold && estimatedRemainingP50 > Math.max(0, reservedCredits - consumedCredits)) {
		reasons.push('reservation_exhaustion_risk');
	}
	if (recoveryBudgetRemaining !== null && recoveryBudgetRemaining < recoveryMinimum) {
		reasons.push('recovery_budget_low');
	}
	return {
		interrupt: reasons.length > 0,
		reasons,
		usedPercent,
		estimatedRemainingP50,
		estimatedRemainingP90,
		remainingReservationCredits: Math.max(0, reservedCredits - consumedCredits),
	};
}

export function summarizeCapacityPlan(plan: CapacityPlan) {
	const reservedCredits = plan.activeReservations
		.filter((reservation) => reservation.state === 'reserved' || reservation.state === 'consuming')
		.reduce((total, reservation) => total + reservation.reservedCredits, 0);
	const consumedCredits = plan.activeReservations
		.reduce((total, reservation) => total + reservation.consumedCredits, 0);
	const grantedDailyCredits = plan.grants
		.filter((grant) => grant.state === 'active')
		.reduce((total, grant) => total + (grant.dailyCreditLimit ?? 0), 0);
	return {
		grantedDailyCredits,
		reservedCredits,
		consumedCredits,
		remainingDailyCredits: grantedDailyCredits > 0
			? Math.max(0, grantedDailyCredits - reservedCredits - consumedCredits)
			: null,
		providerCount: plan.providers.length,
		laneCount: plan.lanes.length,
		grantCount: plan.grants.length,
	};
}

export function summarizeTeamCapacityPlan(plan: CapacityPlan): TeamCapacitySummary {
	const dailyCredits = plan.grants
		.filter((grant) => grant.state === 'active')
		.reduce((total, grant) => total + (grant.dailyCreditLimit ?? 0), 0);
	const monthlyCredits = plan.grants
		.filter((grant) => grant.state === 'active')
		.reduce((total, grant) => total + (grant.monthlyCreditLimit ?? 0), 0);
	const dailyReservedCredits = plan.activeReservations
		.reduce((total, reservation) => total + activeReservationDebit(reservation), 0);
	const dailyUsedCredits = plan.activeReservations
		.reduce((total, reservation) => total + Math.max(0, reservation.consumedCredits), 0);
	return {
		teamId: plan.teamId,
		monthlyCredits: monthlyCredits > 0 ? monthlyCredits : null,
		monthlyUsedCredits: dailyUsedCredits,
		monthlyRemainingCredits: monthlyCredits > 0 ? Math.max(0, monthlyCredits - dailyUsedCredits) : null,
		dailyCredits: dailyCredits > 0 ? dailyCredits : null,
		dailyUsedCredits,
		dailyReservedCredits,
		dailyRemainingCredits: dailyCredits > 0 ? Math.max(0, dailyCredits - dailyReservedCredits - dailyUsedCredits) : null,
		providerCount: plan.providers.length,
		activeProviderCount: plan.providers.filter((provider) => provider.status === 'active').length,
		degradedProviderCount: plan.providers.filter((provider) => provider.status === 'degraded').length,
		grantCount: plan.grants.length,
		blockedTaskCount: 0,
		approvalRequiredCount: 0,
	};
}

export function summarizeProjectCapacityPlan(
	plan: CapacityPlan,
	options: { workPolicyEnabled?: boolean | null; approvalRequiredCount?: number; blockedTaskCount?: number } = {},
): ProjectCapacitySummary {
	const summary = summarizeTeamCapacityPlan(plan);
	const reasons: string[] = [];
	let readiness: ProjectCapacitySummary['readiness'] = 'ready';
	if (options.workPolicyEnabled === false) {
		readiness = 'paused_by_policy';
		reasons.push('work_policy_disabled');
	} else if (summary.activeProviderCount <= 0) {
		readiness = 'waiting_for_provider';
		reasons.push('no_active_provider');
	} else if (summary.dailyRemainingCredits !== null && summary.dailyRemainingCredits <= 0) {
		readiness = 'waiting_for_budget';
		reasons.push('daily_budget_exhausted');
	} else if ((options.approvalRequiredCount ?? 0) > 0) {
		readiness = 'needs_approval';
		reasons.push('approval_required');
	}
	return {
		...summary,
		projectId: plan.projectId,
		environment: plan.environment,
		readiness,
		reasons,
		blockedTaskCount: options.blockedTaskCount ?? summary.blockedTaskCount,
		approvalRequiredCount: options.approvalRequiredCount ?? summary.approvalRequiredCount,
	};
}

export function scoreCapacityLane(input: CapacityLaneCandidate): CapacityLaneScore {
	const reasons: string[] = [];
	let agentFit = 0;
	const profile = input.agentProfile;
	if (profile) {
		const preferred = profile.preferredLanes.find((preference) =>
			preference.laneId === input.lane.id
			|| preference.providerId === input.lane.capacityProviderId
			|| (preference.modelClass && preference.modelClass === input.lane.modelClass)
			|| (preference.provider && preference.provider === input.lane.capacityProviderId)
		);
		if (preferred) {
			agentFit += Math.max(0, preferred.weight);
			reasons.push('agent_preference');
		}
		if (profile.disallowedProviders?.includes(input.lane.capacityProviderId)) {
			agentFit -= 1000;
			reasons.push('agent_disallowed_provider');
		}
		if (input.region && profile.disallowedRegions?.includes(input.region)) {
			agentFit -= 1000;
			reasons.push('agent_disallowed_region');
		}
	}

	if (input.modelClass && input.lane.modelClass === input.modelClass) {
		agentFit += 20;
		reasons.push('model_class_match');
	}

	const fairnessScore = Math.max(0, (input.grant?.priorityWeight ?? 1) * 10);
	const scarcity = scarcityPenalty(input.lane.scarcityLevel);
	const remaining = input.remainingCredits;
	const costPenalty = remaining !== null && remaining !== undefined && remaining <= 0 ? 500 : 0;
	if (scarcity > 0) reasons.push(`scarcity:${input.lane.scarcityLevel}`);
	if (costPenalty > 0) reasons.push('capacity_exhausted');
	return {
		laneId: input.lane.id,
		capacityProviderId: input.lane.capacityProviderId,
		score: agentFit + fairnessScore - scarcity - costPenalty,
		agentFit,
		scarcityPenalty: scarcity,
		fairnessScore,
		costPenalty,
		reasons,
	};
}

export function selectBestCapacityLane(candidates: CapacityLaneCandidate[]) {
	const scored = candidates
		.map(scoreCapacityLane)
		.sort((left, right) => right.score - left.score || left.laneId.localeCompare(right.laneId));
	return {
		selected: scored[0] ?? null,
		scores: scored,
	};
}

export function reservationHasCapacity(reservation: CapacityReservation) {
	return reservation.state === 'reserved'
		&& reservation.reservedCredits > reservation.consumedCredits;
}

export function createReservationReleaseEntry(input: {
	reservation: CapacityReservation;
	credits?: number | null;
	source?: string;
	metadata?: Record<string, unknown>;
}): RecordCapacityUsageRequest {
	const credits = Math.max(0, Number(input.credits ?? (input.reservation.reservedCredits - input.reservation.consumedCredits)));
	return {
		capacityProviderId: input.reservation.capacityProviderId,
		laneId: input.reservation.laneId,
		reservationId: input.reservation.id,
		teamId: input.reservation.teamId,
		projectId: input.reservation.projectId,
		workDayId: input.reservation.workDayId,
		taskId: input.reservation.taskId,
		phase: 'reservation_released',
		credits: -credits,
		source: input.source ?? 'capacity_coordinator',
		metadata: input.metadata ?? {},
	};
}

export function settleCapacityActuals(input: CapacitySettlementInput): CapacitySettlement {
	const consumedCredits = Math.max(0, Number(input.actualCredits ?? 0));
	const releasedCredits = Math.max(0, input.reservation.reservedCredits - consumedCredits);
	const overrunCredits = Math.max(0, consumedCredits - input.reservation.reservedCredits);
	const base = {
		capacityProviderId: input.reservation.capacityProviderId,
		laneId: input.reservation.laneId,
		reservationId: input.reservation.id,
		teamId: input.teamId ?? input.reservation.teamId,
		projectId: input.projectId ?? input.reservation.projectId,
		workDayId: input.workDayId ?? input.reservation.workDayId,
		taskId: input.taskId ?? input.reservation.taskId,
		source: input.source ?? 'capacity_coordinator',
		metadata: input.metadata ?? {},
	};
	const consumeEntry: RecordCapacityUsageRequest = {
		...base,
		phase: 'task_completed_actual_settlement',
		credits: consumedCredits,
		providerUnits: input.actualProviderUnits ?? null,
		usd: input.actualUsd ?? null,
	};
	const releaseEntry = releasedCredits > 0
		? {
			...base,
			phase: 'reservation_released' as const,
			credits: -releasedCredits,
		}
		: null;
	const overrunEntry = overrunCredits > 0
		? {
			...base,
			phase: 'overrun_hold' as const,
			credits: overrunCredits,
		}
		: null;
	return {
		reservationId: input.reservation.id,
		state: overrunCredits > 0 ? 'overran_pending_approval' : 'consumed',
		consumeEntry,
		releaseEntry,
		overrunEntry,
		consumedCredits,
		releasedCredits,
		overrunCredits,
	};
}

function distinctProfiles(profiles: ExecutionProfile[]) {
	const seen = new Set<string>();
	return profiles.filter((profile) => {
		if (seen.has(profile.id)) return false;
		seen.add(profile.id);
		return true;
	});
}

function executionProfilesForRoute(input: RouteAndReserveInput) {
	const explicitProfiles = Array.isArray(input.executionProfiles) && input.executionProfiles.length > 0
		? input.executionProfiles
		: null;
	const preferred = stringArray(input.preferredExecutionProfiles);
	const disallowed = new Set(stringArray(input.disallowedExecutionProfiles));
	const rawProfiles = explicitProfiles
		?? (preferred.length > 0
			? preferred
			: input.executionProfile
				? [input.executionProfile]
				: input.estimate.executionProfileId
					? [input.estimate.executionProfileId]
					: [DEFAULT_EXECUTION_PROFILE_ID]);
	const profiles = distinctProfiles(rawProfiles.map((profile) => normalizeExecutionProfile(profile)))
		.filter((profile) => !disallowed.has(profile.id));
	return profiles.length > 0 ? profiles : [normalizeExecutionProfile(DEFAULT_EXECUTION_PROFILE_ID)];
}

function estimateForRouteProfile(input: RouteAndReserveInput, profile: ExecutionProfile): CapacityTaskEstimate {
	const selectedProfile = selectTaskEstimateProfile({
		profiles: input.estimateProfiles ?? input.plan.estimateProfiles ?? null,
		taskSignature: input.estimate.taskSignature,
		executionProfile: profile,
		executionProfileId: profile.id,
	});
	return reserveCreditsForEstimate({
		taskSignature: input.estimate.taskSignature,
		taskKind: input.taskKind ?? input.estimate.taskSignature,
		confidence: input.estimate.confidence ?? input.classification?.confidence ?? 'medium',
		estimatedCreditsP50: selectedProfile ? undefined : input.estimate.estimatedCreditsP50,
		estimatedCreditsP90: selectedProfile ? undefined : input.estimate.estimatedCreditsP90,
		defaultCredits: input.estimate.estimatedCreditsP50,
		profiles: input.estimateProfiles ?? input.plan.estimateProfiles ?? null,
		profile: selectedProfile,
		executionProfile: profile,
		executionProfileId: profile.id,
	});
}

function routeMinimumQuality(input: RouteAndReserveInput) {
	const explicit = finiteOrParsedNumber(input.minimumQualityWeight);
	if (explicit !== null) return Math.max(0, explicit);
	if (input.production || input.classification?.mutationScope === 'production') return 1.5;
	if (input.classification?.risk === 'high' || input.classification?.requiresApproval) return 1.25;
	if (input.classification?.confidence === 'low') return 1.1;
	return 0;
}

function routeRequiredContext(input: RouteAndReserveInput) {
	return Math.max(0, finiteOrParsedNumber(input.requiredContextTokens) ?? 0);
}

function reservationMetadata(reservation: CapacityReservation) {
	return readRecord(reservation.metadata);
}

function attentionValueFromMetadata(metadata: Record<string, unknown>, ...keys: string[]) {
	const estimate = readRecord(metadata.attentionEstimate);
	for (const key of keys) {
		const value = finiteOrParsedNumber(metadata[key]) ?? finiteOrParsedNumber(estimate[key]);
		if (value !== null) return value;
	}
	return null;
}

function activeLaneReservations(plan: CapacityPlan, provider: CapacityProvider, lane?: CapacityProviderLane | null) {
	return plan.activeReservations.filter((reservation) =>
		reservation.capacityProviderId === provider.id
		&& (!lane || reservation.laneId === lane.id)
		&& (reservation.state === 'reserved' || reservation.state === 'consuming')
	);
}

function attentionLimitNumber(lane: CapacityProviderLane, provider: CapacityProvider, key: string) {
	return finiteOrParsedNumber(lane.hardLimits?.[key])
		?? finiteOrParsedNumber(lane.routingPolicy?.[key])
		?? finiteOrParsedNumber(lane.metadata?.[key])
		?? finiteOrParsedNumber(readRecord(lane.metadata?.pressure)[key])
		?? finiteOrParsedNumber(provider.capacityModel?.[key])
		?? finiteOrParsedNumber(provider.metadata?.[key])
		?? finiteOrParsedNumber(readRecord(provider.metadata?.pressure)[key]);
}

function deriveAttentionWeight(classification: TaskClassification | null | undefined, profile: ExecutionProfile, contextTokens: number) {
	let weight = 1;
	const mutationScope = classification?.mutationScope ?? 'repository_read';
	if (mutationScope === 'repository_read') weight = 1.5;
	if (mutationScope === 'repository_write') weight = 3;
	if (mutationScope === 'production') weight = 6;
	if (classification?.risk === 'medium') weight += 1;
	if (classification?.risk === 'high') weight += 3;
	if (classification?.confidence === 'low') weight += 1;
	weight += Math.max(0, classification?.expectedFanout ?? 0) * 0.5;
	if (profile.concurrencyClass === 'human_attention' || profile.quotaBehavior === 'attention_bound') weight += 5;
	if (profile.concurrencyClass === 'exclusive_project') weight += 3;
	if (contextTokens >= 100_000) weight += 4;
	else if (contextTokens >= 32_000) weight += 2;
	return Math.max(0, weight);
}

export function estimateAttentionForTask(input: {
	classification?: TaskClassification | null;
	executionProfile?: ExecutionProfile | string | null;
	attentionPolicy?: Partial<AttentionPolicy | TaskAdmissionPolicy> | null;
	attentionWeight?: number | null;
	coordinationWeight?: number | null;
	estimatedContextTokens?: number | null;
	requiredContextTokens?: number | null;
	source?: string | null;
	metadata?: Record<string, unknown>;
}): AttentionEstimate {
	const profile = normalizeExecutionProfile(input.executionProfile);
	const policy = normalizeAttentionPolicy(input.attentionPolicy);
	const requiredContextTokens = Math.max(0, finiteOrParsedNumber(input.requiredContextTokens) ?? 0);
	const estimatedContextTokens = Math.max(requiredContextTokens, finiteOrParsedNumber(input.estimatedContextTokens) ?? requiredContextTokens);
	const baseAttention = finiteOrParsedNumber(input.attentionWeight)
		?? deriveAttentionWeight(input.classification, profile, estimatedContextTokens);
	const coordinationWeight = finiteOrParsedNumber(input.coordinationWeight)
		?? (Math.max(0, input.classification?.expectedFanout ?? 0) * policy.coordinationOverheadFactor);
	return {
		attentionWeight: Math.max(0, Math.ceil(baseAttention * 100) / 100),
		coordinationWeight: Math.max(0, Math.ceil(coordinationWeight * 100) / 100),
		totalAttentionWeight: Math.max(0, Math.ceil((baseAttention + coordinationWeight) * 100) / 100),
		estimatedContextTokens,
		requiredContextTokens,
		source: input.source ?? 'capacity_attention_estimator',
		metadata: input.metadata ?? {},
	};
}

function attentionEstimateForRoute(input: RouteAndReserveInput, profile: ExecutionProfile) {
	if (input.attentionEstimate) return input.attentionEstimate;
	return estimateAttentionForTask({
		classification: input.classification,
		executionProfile: profile,
		attentionPolicy: input.attentionPolicy,
		attentionWeight: input.attentionWeight,
		coordinationWeight: input.coordinationWeight,
		estimatedContextTokens: input.estimatedContextTokens,
		requiredContextTokens: input.requiredContextTokens,
		source: input.source ?? 'capacity_router',
	});
}

function readPressureNumber(provider: CapacityProvider, lane: CapacityProviderLane, key: string) {
	const laneValue = finiteOrParsedNumber(lane.metadata?.[key]);
	if (laneValue !== null) return laneValue;
	const providerValue = finiteOrParsedNumber(provider.metadata?.[key]);
	if (providerValue !== null) return providerValue;
	const lanePressure = readRecord(lane.metadata?.pressure);
	const providerPressure = readRecord(provider.metadata?.pressure);
	return finiteOrParsedNumber(lanePressure[key]) ?? finiteOrParsedNumber(providerPressure[key]);
}

function readPressureBoolean(provider: CapacityProvider, lane: CapacityProviderLane, key: string) {
	const values = [
		lane.metadata?.[key],
		provider.metadata?.[key],
		readRecord(lane.metadata?.pressure)[key],
		readRecord(provider.metadata?.pressure)[key],
	];
	return values.some((value) => value === true || value === 'true');
}

function hardLimitNumber(lane: CapacityProviderLane, provider: CapacityProvider, ...keys: string[]) {
	for (const key of keys) {
		const value = finiteOrParsedNumber(lane.hardLimits?.[key])
			?? finiteOrParsedNumber(lane.routingPolicy?.[key])
			?? finiteOrParsedNumber(provider.capacityModel?.[key])
			?? finiteOrParsedNumber(provider.metadata?.[key]);
		if (value !== null && value >= 0) return value;
	}
	return null;
}

export function capacityRoutePressure(plan: CapacityPlan, provider: CapacityProvider, lane: CapacityProviderLane): CapacityRoutePressure {
	const reservations = activeLaneReservations(plan, provider, lane);
	const activeReservations = reservations.length;
	const maxActiveReservations = hardLimitNumber(
		lane,
		provider,
		'maxActiveReservations',
		'maxConcurrentTasks',
		'maxConcurrentWorkers',
	) ?? (provider.maxConcurrentWorkers > 0 ? provider.maxConcurrentWorkers : null);
	const congestionRatio = maxActiveReservations && maxActiveReservations > 0
		? activeReservations / maxActiveReservations
		: 0;
	const activeAttentionLoad = reservations.reduce((total, reservation) => {
		const metadata = reservationMetadata(reservation);
		return total + Math.max(0, attentionValueFromMetadata(metadata, 'totalAttentionWeight', 'attentionWeight') ?? 0);
	}, 0);
	const maxAttentionLoad = attentionLimitNumber(lane, provider, 'maxAttentionLoad');
	const activeContextTokens = reservations.reduce((total, reservation) => {
		const metadata = reservationMetadata(reservation);
		return total + Math.max(0, attentionValueFromMetadata(metadata, 'estimatedContextTokens', 'contextTokens', 'requiredContextTokens') ?? 0);
	}, 0);
	const maxContextTokens = attentionLimitNumber(lane, provider, 'maxContextTokens');
	return {
		activeReservations,
		maxActiveReservations,
		congestionRatio,
		quotaRemainingPercent: readPressureNumber(provider, lane, 'quotaRemainingPercent'),
		sessionRemainingMinutes: readPressureNumber(provider, lane, 'sessionRemainingMinutes'),
		subscriptionSaturationPercent: readPressureNumber(provider, lane, 'subscriptionSaturationPercent'),
		providerUnavailable: readPressureBoolean(provider, lane, 'providerUnavailable'),
		activeAttentionLoad,
		maxAttentionLoad,
		attentionSaturationPercent: maxAttentionLoad && maxAttentionLoad > 0 ? (activeAttentionLoad / maxAttentionLoad) * 100 : null,
		activeContextTokens,
		maxContextTokens,
		contextSaturationPercent: maxContextTokens && maxContextTokens > 0 ? (activeContextTokens / maxContextTokens) * 100 : null,
	};
}

function latencyPenalty(profile: ExecutionProfile) {
	if (profile.latencyClass === 'high') return 12;
	if (profile.latencyClass === 'medium') return 5;
	return 0;
}

function quotaPressurePenalty(pressure: CapacityRoutePressure) {
	let penalty = 0;
	if (pressure.quotaRemainingPercent !== null) {
		penalty += Math.max(0, 100 - pressure.quotaRemainingPercent) * 0.25;
	}
	if (pressure.subscriptionSaturationPercent !== null) {
		penalty += Math.max(0, pressure.subscriptionSaturationPercent) * 0.35;
	}
	if (pressure.sessionRemainingMinutes !== null && pressure.sessionRemainingMinutes < 20) {
		penalty += (20 - pressure.sessionRemainingMinutes) * 1.5;
	}
	return penalty;
}

function attentionPressurePenalty(pressure: CapacityRoutePressure, estimate: AttentionEstimate, policy: AttentionPolicy) {
	if (!pressure.maxAttentionLoad || pressure.maxAttentionLoad <= 0) return 0;
	const allocatableLoad = Math.max(0, pressure.maxAttentionLoad * (1 - (policy.reserveAttentionPercent / 100)));
	const projected = pressure.activeAttentionLoad + estimate.totalAttentionWeight;
	const saturation = allocatableLoad > 0 ? projected / allocatableLoad : 1;
	return Math.max(0, saturation) * 35;
}

function contextPressurePenalty(pressure: CapacityRoutePressure, estimate: AttentionEstimate, policy: AttentionPolicy) {
	const maxContextTokens = pressure.maxContextTokens ?? policy.maxContextTokens;
	if (!maxContextTokens || maxContextTokens <= 0) return 0;
	const projected = pressure.activeContextTokens + estimate.estimatedContextTokens;
	const saturationPercent = (projected / maxContextTokens) * 100;
	return Math.max(0, saturationPercent - 50) * 0.6;
}

function laneSupportsExecutionProfile(lane: CapacityProviderLane, profile: ExecutionProfile) {
	const allowedProfiles = stringArray(lane.routingPolicy?.executionProfiles);
	if (allowedProfiles.length > 0 && !allowedProfiles.includes(profile.id)) return false;
	const allowedModelClasses = stringArray(lane.routingPolicy?.modelClasses);
	if (allowedModelClasses.length > 0 && profile.modelClass && !allowedModelClasses.includes(profile.modelClass)) return false;
	return true;
}

function routeTrustScore(provider: CapacityProvider, lane: CapacityProviderLane, profile: ExecutionProfile) {
	const laneMetadata = readRecord(lane.metadata);
	const providerMetadata = readRecord(provider.metadata);
	const profileMetadata = readRecord(profile.metadata);
	const trust = finiteOrParsedNumber(laneMetadata.trustScore)
		?? finiteOrParsedNumber(providerMetadata.trustScore)
		?? finiteOrParsedNumber(profileMetadata.trustScore)
		?? 1;
	const availability = finiteOrParsedNumber(laneMetadata.availabilityScore)
		?? finiteOrParsedNumber(providerMetadata.availabilityScore)
		?? 1;
	return Math.max(0, Math.min(1, trust)) * Math.max(0, Math.min(1, availability));
}

function routeSuccessProbability(input: {
	provider: CapacityProvider;
	lane: CapacityProviderLane;
	profile: ExecutionProfile;
	explicit?: number | null;
	utilityEstimate: UtilityEstimate;
}) {
	const laneMetadata = readRecord(input.lane.metadata);
	const providerMetadata = readRecord(input.provider.metadata);
	const profileMetadata = readRecord(input.profile.metadata);
	const success = finiteOrParsedNumber(input.explicit)
		?? finiteOrParsedNumber(laneMetadata.successProbability)
		?? finiteOrParsedNumber(providerMetadata.successProbability)
		?? finiteOrParsedNumber(profileMetadata.successProbability)
		?? input.utilityEstimate.successProbability
		?? 1;
	return Math.max(0, Math.min(1, success));
}

function routePriceMultiplier(provider: CapacityProvider, lane: CapacityProviderLane, profile: ExecutionProfile) {
	const laneMetadata = readRecord(lane.metadata);
	const providerMetadata = readRecord(provider.metadata);
	const profileMetadata = readRecord(profile.metadata);
	return Math.max(0.1, finiteOrParsedNumber(laneMetadata.priceMultiplier)
		?? finiteOrParsedNumber(providerMetadata.priceMultiplier)
		?? finiteOrParsedNumber(profileMetadata.priceMultiplier)
		?? 1);
}

function capacityBudgetMode(provider: CapacityProvider): 'static' | 'hybrid' | 'derived' {
	const mode = String(provider.creditBudgetMode ?? 'derived').toLowerCase();
	if (mode === 'static' || mode === 'hybrid' || mode === 'derived') return mode;
	return 'derived';
}

function routeDerivedEntries(plan: CapacityPlan): DerivedCapacityAvailability[] {
	const seen = new Set<string>();
	const entries: DerivedCapacityAvailability[] = [];
	const add = (entry: DerivedCapacityAvailability | null | undefined) => {
		if (!entry) return;
		const key = `${entry.executionProviderId}:${entry.nativeUnit}:${entry.scope ?? ''}`;
		if (seen.has(key)) return;
		seen.add(key);
		entries.push(entry);
	};
	for (const entry of plan.derivedCapacity?.entries ?? []) add(entry);
	for (const summary of plan.derivedCapacity?.providers ?? []) {
		for (const entry of summary.entries ?? []) add(entry);
	}
	return entries;
}

function routeDerivedHints(provider: CapacityProvider, lane: CapacityProviderLane, profile: ExecutionProfile) {
	const providerMetadata = readRecord(provider.metadata);
	const laneMetadata = readRecord(lane.metadata);
	const profileMetadata = readRecord(profile.metadata);
	return {
		executionProviderId: stringValue(laneMetadata.executionProviderId)
			?? stringValue(providerMetadata.executionProviderId)
			?? stringValue(profileMetadata.executionProviderId),
		executionProviderKind: stringValue(laneMetadata.executionProviderKind)
			?? stringValue(laneMetadata.providerKind)
			?? stringValue(providerMetadata.executionProviderKind)
			?? stringValue(providerMetadata.providerKind)
			?? stringValue(profileMetadata.executionProviderKind),
		nativeUnit: stringValue(laneMetadata.nativeUnit)
			?? stringValue(providerMetadata.nativeUnit)
			?? stringValue(profileMetadata.nativeUnit),
	};
}

function selectDerivedCapacityForRoute(
	plan: CapacityPlan,
	provider: CapacityProvider,
	lane: CapacityProviderLane,
	profile: ExecutionProfile,
) {
	const hints = routeDerivedHints(provider, lane, profile);
	const entries = routeDerivedEntries(plan)
		.filter((entry) => entry.capacityProviderId === provider.id || entry.capacityProviderId === null)
		.filter((entry) => !hints.executionProviderId || entry.executionProviderId === hints.executionProviderId)
		.filter((entry) => !hints.executionProviderKind || entry.executionProviderKind === hints.executionProviderKind)
		.filter((entry) => !hints.nativeUnit || entry.nativeUnit === hints.nativeUnit);
	return entries.sort((left, right) => {
		const leftExact = (hints.executionProviderId && left.executionProviderId === hints.executionProviderId ? 20 : 0)
			+ (hints.executionProviderKind && left.executionProviderKind === hints.executionProviderKind ? 10 : 0)
			+ (hints.nativeUnit && left.nativeUnit === hints.nativeUnit ? 5 : 0);
		const rightExact = (hints.executionProviderId && right.executionProviderId === hints.executionProviderId ? 20 : 0)
			+ (hints.executionProviderKind && right.executionProviderKind === hints.executionProviderKind ? 10 : 0)
			+ (hints.nativeUnit && right.nativeUnit === hints.nativeUnit ? 5 : 0);
		return rightExact - leftExact
			|| derivedConfidenceRank(right.confidence) - derivedConfidenceRank(left.confidence)
			|| Number(left.derivedAvailableCredits ?? Number.POSITIVE_INFINITY) - Number(right.derivedAvailableCredits ?? Number.POSITIVE_INFINITY)
			|| Number(left.availableNativeAmount ?? Number.POSITIVE_INFINITY) - Number(right.availableNativeAmount ?? Number.POSITIVE_INFINITY)
			|| `${left.executionProviderId}:${left.nativeUnit}`.localeCompare(`${right.executionProviderId}:${right.nativeUnit}`);
	})[0] ?? null;
}

function roundUpNativeAmount(value: number) {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.ceil(value * 1000) / 1000;
}

function nativePressureForRoute(
	entry: DerivedCapacityAvailability | null,
	estimate: CapacityTaskEstimate,
): CapacityRouteNativePressure | null {
	if (!entry) return null;
	const reservedNativeAmount = entry.nativeUnitsPerCredit && entry.nativeUnitsPerCredit > 0
		? roundUpNativeAmount(estimate.reservedCredits * entry.nativeUnitsPerCredit)
		: null;
	const pressureRatio = reservedNativeAmount !== null && entry.availableNativeAmount > 0
		? reservedNativeAmount / entry.availableNativeAmount
		: entry.availableNativeAmount <= 0 ? 1 : null;
	return {
		executionProviderId: entry.executionProviderId,
		nativeUnit: entry.nativeUnit,
		availableNativeAmount: entry.availableNativeAmount,
		activeReservedNativeAmount: entry.activeReservedNativeAmount,
		reserveBufferNativeAmount: entry.reserveBufferNativeAmount,
		reservedNativeAmount,
		pressureRatio,
		confidence: entry.confidence,
		reasons: entry.reasons,
	};
}

function derivedRouteBudget(input: {
	mode: 'static' | 'hybrid' | 'derived';
	staticRemainingCredits: number | null;
	derivedCapacity: DerivedCapacityAvailability | null;
	estimate: CapacityTaskEstimate;
	grant: CapacityGrant;
}) {
	const reasons: string[] = [];
	const derivedCredits = input.derivedCapacity?.derivedAvailableCredits ?? null;
	const confidenceRank = derivedConfidenceRank(input.derivedCapacity?.confidence);
	const hasUsableDerived = Boolean(input.derivedCapacity && derivedCredits !== null && confidenceRank >= 2);
	const portfolioPercent = grantPortfolioAllocationPercent(input.grant);
	let remainingCredits = input.staticRemainingCredits;
	let appliesDerived = false;

	if (input.mode === 'derived') {
		appliesDerived = true;
		if (!input.derivedCapacity) {
			reasons.push('missing_derived_capacity', 'insufficient_budget');
			return { remainingCredits: null, appliesDerived, hasUsableDerived: false, reasons };
		}
		if (derivedCredits === null) {
			reasons.push('missing_conversion_profile', 'insufficient_budget');
			return { remainingCredits: null, appliesDerived, hasUsableDerived: false, reasons };
		}
		if (confidenceRank < 2) {
			reasons.push('derived_capacity_learning', 'insufficient_budget');
			return { remainingCredits: derivedCredits, appliesDerived, hasUsableDerived: false, reasons };
		}
		remainingCredits = input.staticRemainingCredits === null ? derivedCredits : Math.min(input.staticRemainingCredits, derivedCredits);
		reasons.push('derived_capacity_available');
		if (portfolioPercent !== null) reasons.push('portfolio_allocation_applied');
	} else if (input.mode === 'hybrid') {
		if (hasUsableDerived) {
			appliesDerived = true;
			remainingCredits = input.staticRemainingCredits === null
				? derivedCredits
				: Math.min(input.staticRemainingCredits, derivedCredits);
			reasons.push('hybrid_derived_capacity_applied');
			if (portfolioPercent !== null) reasons.push('portfolio_allocation_applied');
			if (input.staticRemainingCredits !== null && input.staticRemainingCredits <= derivedCredits) {
				reasons.push('hybrid_static_cap_applied');
			}
		} else if (input.derivedCapacity && derivedCredits !== null && confidenceRank < 2) {
			reasons.push('derived_capacity_learning');
		} else if (input.derivedCapacity && derivedCredits === null) {
			reasons.push('missing_conversion_profile');
		}
	}

	if (appliesDerived && hasUsableDerived && derivedCredits !== null && derivedCredits < input.estimate.reservedCredits) {
		reasons.push('derived_capacity_exhausted');
		if (input.grant.overflowPolicy === 'approval_required') {
			reasons.push('approval_required');
		} else if (input.grant.overflowPolicy === 'fallback_lane') {
			reasons.push('fallback_lane_exhausted');
		} else if (input.grant.overflowPolicy === 'deny' || input.grant.overflowPolicy === 'hard_grant' || input.mode === 'derived') {
			reasons.push('insufficient_budget');
		} else {
			reasons.push('soft_budget_pressure', 'derived_capacity_pressure');
		}
	}

	return { remainingCredits, appliesDerived, hasUsableDerived, reasons };
}

function routeScore(input: {
	provider: CapacityProvider;
	lane: CapacityProviderLane;
	grant: CapacityGrant;
	estimate: CapacityTaskEstimate;
	profile: ExecutionProfile;
	remainingCredits: number | null;
	pressure: CapacityRoutePressure;
	minimumQualityWeight: number;
	attentionEstimate: AttentionEstimate;
	attentionPolicy: AttentionPolicy;
	utilityEstimate: UtilityEstimate;
	reservePrediction: ReservePrediction | null;
	trustScore: number;
	successProbability: number;
	cooperativeRouting: boolean;
	baseScore: CapacityLaneScore;
	nativePressure?: CapacityRouteNativePressure | null;
}) {
	const reasons = [...input.baseScore.reasons];
	const qualityFit = input.minimumQualityWeight > 0
		? input.profile.qualityWeight / input.minimumQualityWeight
		: input.profile.qualityWeight;
	const qualityBonus = Math.min(50, Math.max(0, input.profile.qualityWeight * 20));
	const costPenalty = Math.max(0, input.estimate.reservedCredits);
	const latency = latencyPenalty(input.profile);
	const congestion = input.pressure.congestionRatio * 45;
	const quota = quotaPressurePenalty(input.pressure);
	const attention = attentionPressurePenalty(input.pressure, input.attentionEstimate, input.attentionPolicy);
	const context = contextPressurePenalty(input.pressure, input.attentionEstimate, input.attentionPolicy);
	const priceMultiplier = routePriceMultiplier(input.provider, input.lane, input.profile);
	const utilityBonus = input.utilityEstimate.utilityScore > 0
		? Math.min(100, input.utilityEstimate.utilityPerCredit * 18 * Math.max(0.1, input.trustScore) * Math.max(0.1, input.successProbability))
		: 0;
	const cooperativeBonus = input.cooperativeRouting
		? ((input.trustScore * 20) + (input.successProbability * 15))
		: 0;
	const predictedReserveImpact = input.reservePrediction?.reserveCredits ?? 0;
	const laneModelFit = input.profile.modelClass && input.lane.modelClass === input.profile.modelClass ? 15 : 0;
	const riskBonus = input.minimumQualityWeight >= 1.25 && input.profile.qualityWeight >= input.minimumQualityWeight ? 10 : 0;
	const nativePressurePenalty = input.nativePressure?.pressureRatio !== null && input.nativePressure?.pressureRatio !== undefined
		? Math.max(0, input.nativePressure.pressureRatio) * 35
		: 0;
	const score = input.baseScore.score
		+ qualityBonus
		+ laneModelFit
		+ riskBonus
		+ utilityBonus
		+ cooperativeBonus
		- costPenalty
		- latency
		- congestion
		- quota
		- attention
		- context
		- nativePressurePenalty
		- Math.max(0, priceMultiplier - 1) * 8
		- (input.reservePrediction && input.reservePrediction.reservePercent > 0 ? Math.min(20, predictedReserveImpact * 0.25) : 0);
	if (laneModelFit > 0) reasons.push('execution_profile_model_class_match');
	if (congestion > 0) reasons.push('lane_congestion_pressure');
	if (quota > 0) reasons.push('quota_pressure');
	if (attention > 0) reasons.push('attention_pressure');
	if (context > 0) reasons.push('context_pressure');
	if (nativePressurePenalty > 0) reasons.push('native_capacity_pressure');
	if (utilityBonus > 0) reasons.push('utility_scored');
	if (cooperativeBonus > 0) reasons.push('cooperative_route_scored');
	if (predictedReserveImpact > 0) reasons.push('predictive_reserve_applied');
	return {
		...input.baseScore,
		score,
		qualityFit,
		latencyPenalty: latency,
		quotaPressure: quota,
		congestionPenalty: congestion,
		attentionPenalty: attention,
		contextPenalty: context,
		nativePressurePenalty,
		utilityScore: input.utilityEstimate.utilityScore,
		utilityPerCredit: input.utilityEstimate.utilityPerCredit,
		predictedReserveImpact,
		trustScore: input.trustScore,
		successProbability: input.successProbability,
		costPenalty,
		executionProfileId: input.profile.id,
		reservedCredits: input.estimate.reservedCredits,
		attentionEstimate: input.attentionEstimate,
		reasons: [...new Set(reasons)],
	};
}

function routeCandidateKey(candidate: RouteAndReserveCandidate) {
	return `${candidate.providerId}:${candidate.laneId}:${candidate.grantId}:${candidate.executionProfileId ?? DEFAULT_EXECUTION_PROFILE_ID}`;
}

export function routeAndReserveCapacity(input: RouteAndReserveInput): RouteAndReserveResult {
	const providers = input.plan.providers.filter((provider) => providerIsEligible(provider, input));
	const grants = input.plan.grants.filter((grant) => grantIsEligible(grant, input));
	const candidates: RouteAndReserveCandidate[] = [];
	const executionProfiles = executionProfilesForRoute(input);
	const minimumQualityWeight = routeMinimumQuality(input);
	const requiredContextTokens = routeRequiredContext(input);
	const attentionPolicy = normalizeAttentionPolicy(input.attentionPolicy);
	const utilityPolicy = normalizeUtilityPolicy(input.utilityPolicy);
	const predictiveReservePolicy = normalizePredictiveReservePolicy(input.predictiveReservePolicy);
	const hybridExecutionPlan = normalizeHybridExecutionPlan(input.hybridExecutionPlan ?? readRecord(input.metadata).hybridExecutionPlan);
	const preferredProfiles = new Set(stringArray(input.preferredExecutionProfiles));
	const disallowedProfiles = new Set(stringArray(input.disallowedExecutionProfiles));
	const cooperativeRouting = input.cooperativeRouting === true || readRecord(input.metadata).cooperativeRouting === true;
	const trustRequirement = finiteOrParsedNumber(input.trustRequirement);

	for (const grant of grants) {
		const provider = providers.find((candidate) => candidate.id === grant.capacityProviderId);
		if (!provider) continue;
		const lanes = input.plan.lanes.filter((lane) =>
			lane.capacityProviderId === provider.id
			&& (!grant.laneId || grant.laneId === lane.id)
		);
		for (const lane of lanes) {
			const pressure = capacityRoutePressure(input.plan, provider, lane);
			for (const profile of executionProfiles) {
				const estimate = estimateForRouteProfile(input, profile);
				const derivedCapacityMode = capacityBudgetMode(provider);
				const derivedCapacity = derivedCapacityMode === 'static'
					? null
					: selectDerivedCapacityForRoute(input.plan, provider, lane, profile);
				const staticRemainingCredits = grantRemainingCredits(input.plan, grant, derivedCapacity, input);
				const routeBudget = derivedRouteBudget({
					mode: derivedCapacityMode,
					staticRemainingCredits,
					derivedCapacity,
					estimate,
					grant,
				});
				const remainingCredits = routeBudget.remainingCredits;
				const nativePressure = nativePressureForRoute(derivedCapacity, estimate);
				const attentionEstimate = attentionEstimateForRoute(input, profile);
				const utilityEstimate = input.utilityEstimate ?? estimateUtilityForTask({
					classification: input.classification,
					executionProfile: profile,
					estimate,
					utilityPolicy,
					utilityValue: input.utilityValue,
					maintenanceValue: input.maintenanceValue,
					priority: finiteOrParsedNumber(readRecord(input.metadata).priority),
					deadlineAt: input.deadlineAt ?? (typeof readRecord(input.metadata).deadlineAt === 'string' ? readRecord(input.metadata).deadlineAt as string : null),
					successProbability: input.successProbability,
					metadata: input.metadata,
					source: input.source ?? 'capacity_router',
				});
				const reservePrediction = predictReserveForCapacityPlan({
					plan: input.plan,
					policy: predictiveReservePolicy,
					remainingCredits,
					metadata: input.metadata,
				});
				const trustScore = routeTrustScore(provider, lane, profile);
				const successProbability = routeSuccessProbability({
					provider,
					lane,
					profile,
					explicit: input.successProbability,
					utilityEstimate,
				});
				const estimateInput = { ...input, estimate };
				const reasons = [...routeBudget.reasons, ...lanePolicyReasons(lane, estimateInput)];
				let spilloverReason: string | null = null;
				if (trustRequirement !== null && trustScore < trustRequirement) reasons.push('trust_below_requirement');
				if (utilityPolicy.minimumUtilityScore !== null && utilityEstimate.utilityScore < utilityPolicy.minimumUtilityScore) reasons.push('utility_below_minimum');
				if (utilityPolicy.minimumUtilityPerCredit !== null && utilityEstimate.utilityPerCredit < utilityPolicy.minimumUtilityPerCredit) reasons.push('utility_per_credit_below_minimum');
				if (
					predictiveReservePolicy.enabled
					&& reservePrediction.reserveCredits > 0
					&& reservePrediction.activelyAllocatableCredits < estimate.reservedCredits
					&& utilityEstimate.utilityScore < 50
				) {
					reasons.push('predictive_reserve_blocked');
				}
				const routeMaxAttentionLoad = attentionPolicy.maxAttentionLoad ?? pressure.maxAttentionLoad;
				if (routeMaxAttentionLoad !== null && routeMaxAttentionLoad > 0) {
					const allocatableAttention = Math.max(0, routeMaxAttentionLoad * (1 - (attentionPolicy.reserveAttentionPercent / 100)));
					const projectedAttention = pressure.activeAttentionLoad + attentionEstimate.totalAttentionWeight;
					if (projectedAttention > allocatableAttention) reasons.push('attention_load_exceeded');
					const availableAttention = Math.max(0, allocatableAttention - pressure.activeAttentionLoad);
					const minimumAttentionAvailable = finiteOrParsedNumber(input.minimumAttentionAvailable);
					if (minimumAttentionAvailable !== null && availableAttention < minimumAttentionAvailable) reasons.push('minimum_attention_unavailable');
				}
				const routeMaxContextTokens = attentionPolicy.maxContextTokens ?? pressure.maxContextTokens;
				if (routeMaxContextTokens !== null && routeMaxContextTokens > 0) {
					const projectedContextTokens = pressure.activeContextTokens + attentionEstimate.estimatedContextTokens;
					const projectedSaturation = (projectedContextTokens / routeMaxContextTokens) * 100;
					if (projectedContextTokens > routeMaxContextTokens || projectedSaturation > attentionPolicy.maxContextSaturationPercent) {
						reasons.push('context_saturation_exceeded');
					}
				}
				if (disallowedProfiles.has(profile.id)) reasons.push('execution_profile_disallowed');
				if (preferredProfiles.size > 0 && !preferredProfiles.has(profile.id)) reasons.push('execution_profile_not_preferred');
				if (!laneSupportsExecutionProfile(lane, profile)) reasons.push('execution_profile_not_supported');
				if (minimumQualityWeight > 0 && profile.qualityWeight < minimumQualityWeight) reasons.push('quality_below_minimum');
				if (
					requiredContextTokens > 0
					&& profile.contextWindowTokens !== null
					&& profile.contextWindowTokens !== undefined
					&& profile.contextWindowTokens < requiredContextTokens
				) {
					reasons.push('context_window_too_small');
				}
				if (pressure.providerUnavailable) reasons.push('provider_unavailable');
				if (pressure.maxActiveReservations !== null && pressure.congestionRatio >= 1) reasons.push('lane_congested');
				if (pressure.quotaRemainingPercent !== null && pressure.quotaRemainingPercent <= 0) reasons.push('quota_exhausted');
				if (pressure.sessionRemainingMinutes !== null && pressure.sessionRemainingMinutes <= 0) reasons.push('session_exhausted');
				if (remainingCredits !== null && remainingCredits < estimate.reservedCredits) {
					if (grantPortfolioAllocationPercent(grant) !== null) reasons.push('portfolio_allocation_exhausted');
					if (grant.overflowPolicy === 'approval_required') {
						reasons.push('approval_required');
					} else if (grant.overflowPolicy === 'fallback_lane') {
						spilloverReason = 'fallback_lane';
						reasons.push('fallback_lane_exhausted');
					} else if (grant.overflowPolicy === 'deny' || grant.overflowPolicy === 'hard_grant') {
						reasons.push('insufficient_budget');
					} else {
						reasons.push('soft_budget_pressure');
					}
				}
				const baseScore = scoreCapacityLane({
					lane,
					grant,
					remainingCredits,
					taskKind: input.taskKind ?? estimate.taskSignature,
					requiredCapabilities: input.requiredCapabilities,
					modelClass: input.modelClass ?? profile.modelClass ?? null,
				});
				const score = routeScore({
					provider,
					lane,
					grant,
					estimate,
					profile,
					remainingCredits,
					pressure,
					minimumQualityWeight,
					attentionEstimate,
					attentionPolicy,
					utilityEstimate,
					reservePrediction,
					trustScore,
					successProbability,
					cooperativeRouting,
					baseScore,
					nativePressure,
				});
				candidates.push({
					providerId: provider.id,
					laneId: lane.id,
					grantId: grant.id,
					executionProviderId: routeBudget.appliesDerived && routeBudget.hasUsableDerived ? derivedCapacity?.executionProviderId ?? null : null,
					executionProfileId: profile.id,
					nativeUnit: routeBudget.appliesDerived && routeBudget.hasUsableDerived ? derivedCapacity?.nativeUnit ?? null : null,
					remainingCredits,
					staticRemainingCredits,
					derivedAvailableCredits: derivedCapacity?.derivedAvailableCredits ?? null,
					reservedNativeAmount: routeBudget.appliesDerived && routeBudget.hasUsableDerived ? nativePressure?.reservedNativeAmount ?? null : null,
					derivedCapacity: derivedCapacity ?? null,
					derivedCapacityMode,
					score,
					eligible: reasons.filter((reason) =>
						reason !== 'soft_budget_pressure'
						&& reason !== 'execution_profile_not_preferred'
						&& reason !== 'derived_capacity_available'
						&& reason !== 'hybrid_derived_capacity_applied'
						&& reason !== 'hybrid_static_cap_applied'
						&& reason !== 'portfolio_allocation_applied'
						&& reason !== 'derived_capacity_learning'
						&& reason !== 'missing_conversion_profile'
					).length === 0,
					reasons: [...new Set([...reasons, ...score.reasons])],
					estimate,
					pressure,
					nativePressure,
					qualityFit: score.qualityFit,
					attentionEstimate,
					utilityEstimate,
					reservePrediction,
					trustScore,
					successProbability,
					spilloverReason,
				});
			}
		}
	}

	if (input.plan.providers.length === 0 || providers.length === 0) {
		return {
			ok: false,
			code: 'no_capacity_provider',
			reason: 'No active helper capacity provider is available.',
			estimate: input.estimate,
			candidates,
		};
	}
	if (grants.length === 0) {
		return {
			ok: false,
			code: 'no_capacity_grant',
			reason: 'No active capacity grant is available for this team, project, and environment.',
			estimate: input.estimate,
			candidates,
		};
	}

	const eligible = candidates
		.filter((candidate) => candidate.eligible)
		.sort((left, right) =>
			right.score.score - left.score.score
			|| (left.estimate?.reservedCredits ?? Number.MAX_SAFE_INTEGER) - (right.estimate?.reservedCredits ?? Number.MAX_SAFE_INTEGER)
			|| routeCandidateKey(left).localeCompare(routeCandidateKey(right))
		);
	const selected = eligible[0] ?? null;
	if (!selected) {
		const hasApprovalBlock = candidates.some((candidate) => candidate.reasons.includes('approval_required'));
		const hasBudgetBlock = candidates.some((candidate) => candidate.reasons.includes('insufficient_budget'));
		return {
			ok: false,
			code: hasApprovalBlock ? 'approval_required' : hasBudgetBlock ? 'insufficient_budget' : 'no_eligible_lane',
			reason: hasApprovalBlock
				? 'The requested helper task needs approval before capacity can be reserved.'
				: hasBudgetBlock
					? 'The requested helper task is above the remaining approved budget.'
					: 'No provider lane matches the task policy and capability requirements.',
			estimate: input.estimate,
			candidates,
		};
	}

	const provider = providers.find((candidate) => candidate.id === selected.providerId);
	const lane = input.plan.lanes.find((candidate) => candidate.id === selected.laneId);
	const grant = grants.find((candidate) => candidate.id === selected.grantId);
	const selectedEstimate = selected.estimate ?? input.estimate;
	if (!provider || !lane || !grant) {
		return {
			ok: false,
			code: 'no_eligible_lane',
			reason: 'The selected capacity lane could not be resolved.',
			estimate: input.estimate,
			candidates,
		};
	}

	const candidatePayload = candidates.map((candidate) => ({
		providerId: candidate.providerId,
		laneId: candidate.laneId,
		grantId: candidate.grantId,
		executionProviderId: candidate.executionProviderId ?? null,
		executionProfileId: candidate.executionProfileId ?? null,
		nativeUnit: candidate.nativeUnit ?? null,
		remainingCredits: candidate.remainingCredits,
		staticRemainingCredits: candidate.staticRemainingCredits ?? null,
		derivedAvailableCredits: candidate.derivedAvailableCredits ?? null,
		reservedNativeAmount: candidate.reservedNativeAmount ?? null,
		derivedCapacityMode: candidate.derivedCapacityMode ?? 'derived',
		eligible: candidate.eligible,
		reasons: candidate.reasons,
		score: candidate.score.score,
		reservedCredits: candidate.estimate?.reservedCredits ?? null,
		qualityFit: candidate.qualityFit ?? null,
		attentionEstimate: candidate.attentionEstimate ?? null,
		utilityEstimate: candidate.utilityEstimate ?? null,
		reservePrediction: candidate.reservePrediction ?? null,
		trustScore: candidate.trustScore ?? null,
		successProbability: candidate.successProbability ?? null,
		pressure: candidate.pressure ?? null,
		nativePressure: candidate.nativePressure ?? null,
		derivedCapacity: candidate.derivedCapacity ?? null,
		spilloverReason: candidate.spilloverReason ?? null,
	}));
	const scorePayload = Object.fromEntries(candidates.map((candidate) => [routeCandidateKey(candidate), candidate.score]));
	const reservation: CreateCapacityReservationRequest = {
		capacityProviderId: provider.id,
		laneId: lane.id,
		teamId: input.plan.teamId,
		projectId: input.plan.projectId,
		workDayId: input.workDayId ?? null,
		taskId: input.taskId ?? null,
		state: 'reserved',
		reservedCredits: selectedEstimate.reservedCredits,
		executionProviderId: selected.executionProviderId ?? null,
		nativeUnit: selected.nativeUnit ?? null,
		reservedNativeAmount: selected.reservedNativeAmount ?? null,
		metadata: {
			...(input.metadata ?? {}),
			grantId: grant.id,
			derivedCapacityMode: selected.derivedCapacityMode ?? 'derived',
			executionProviderId: selected.executionProviderId ?? null,
			nativeUnit: selected.nativeUnit ?? null,
			reservedNativeAmount: selected.reservedNativeAmount ?? null,
			derivedAvailableCredits: selected.derivedAvailableCredits ?? null,
			nativePressure: selected.nativePressure ?? null,
			executionProfileId: selected.executionProfileId ?? selectedEstimate.executionProfileId ?? null,
			taskSignature: selectedEstimate.taskSignature,
			estimatedCreditsP50: selectedEstimate.estimatedCreditsP50,
			estimatedCreditsP90: selectedEstimate.estimatedCreditsP90,
			routingScore: selected.score.score,
			attentionEstimate: selected.attentionEstimate ?? null,
			utilityEstimate: selected.utilityEstimate ?? null,
			reservePrediction: selected.reservePrediction ?? null,
			hybridExecutionPlan,
			routingCandidates: candidatePayload,
		},
	};
	const routingDecision: CreateCapacityRoutingDecisionRequest = {
		taskId: input.taskId ?? null,
		workDayId: input.workDayId ?? null,
		projectId: input.plan.projectId,
		selectedProviderId: provider.id,
		selectedLaneId: lane.id,
		selectedModel: input.selectedModel ?? selected.executionProfileId ?? null,
		decision: 'selected',
		reason: selected.score.reasons.length > 0 ? selected.score.reasons.join(',') : 'best_eligible_lane',
		candidates: candidatePayload,
		scores: scorePayload,
		metadata: {
			...(input.metadata ?? {}),
			grantId: grant.id,
			executionProfileId: selected.executionProfileId ?? selectedEstimate.executionProfileId ?? null,
			remainingCreditsBefore: selected.remainingCredits,
			staticRemainingCreditsBefore: selected.staticRemainingCredits ?? null,
			derivedCapacityMode: selected.derivedCapacityMode ?? 'derived',
			executionProviderId: selected.executionProviderId ?? null,
			nativeUnit: selected.nativeUnit ?? null,
			reservedNativeAmount: selected.reservedNativeAmount ?? null,
			derivedAvailableCreditsBefore: selected.derivedAvailableCredits ?? null,
			nativePressure: selected.nativePressure ?? null,
			reservedCredits: selectedEstimate.reservedCredits,
			attentionEstimate: selected.attentionEstimate ?? null,
			utilityEstimate: selected.utilityEstimate ?? null,
			reservePrediction: selected.reservePrediction ?? null,
			hybridExecutionPlan,
			escalationPath: candidatePayload
				.filter((candidate) => candidate.eligible)
				.sort((left, right) => Number(left.reservedCredits ?? 0) - Number(right.reservedCredits ?? 0))
				.map((candidate) => candidate.executionProfileId)
				.filter((value, index, array) => typeof value === 'string' && value && array.indexOf(value) === index),
		},
	};
	const ledgerEntry: RecordCapacityUsageRequest = {
		capacityProviderId: provider.id,
		laneId: lane.id,
		teamId: input.plan.teamId,
		projectId: input.plan.projectId,
		workDayId: input.workDayId ?? null,
		taskId: input.taskId ?? null,
		phase: 'reservation_created',
		credits: selectedEstimate.reservedCredits,
		source: input.source ?? 'capacity_coordinator',
		metadata: {
			...(input.metadata ?? {}),
			grantId: grant.id,
			executionProfileId: selected.executionProfileId ?? selectedEstimate.executionProfileId ?? null,
			derivedCapacityMode: selected.derivedCapacityMode ?? 'derived',
			executionProviderId: selected.executionProviderId ?? null,
			nativeUnit: selected.nativeUnit ?? null,
			reservedNativeAmount: selected.reservedNativeAmount ?? null,
			derivedAvailableCredits: selected.derivedAvailableCredits ?? null,
			nativePressure: selected.nativePressure ?? null,
			taskSignature: selectedEstimate.taskSignature,
			attentionEstimate: selected.attentionEstimate ?? null,
			utilityEstimate: selected.utilityEstimate ?? null,
			reservePrediction: selected.reservePrediction ?? null,
			hybridExecutionPlan,
		},
	};

	return {
		ok: true,
		provider,
		lane,
		grant,
		estimate: selectedEstimate,
		remainingCreditsBefore: selected.remainingCredits,
		reservation,
		routingDecision,
		ledgerEntry,
		capacityMetadata: {
			providerId: provider.id,
			laneId: lane.id,
			grantId: grant.id,
			reservationId: reservation.id ?? null,
			routingDecisionId: routingDecision.id ?? null,
			estimatedCreditsP50: selectedEstimate.estimatedCreditsP50,
			estimatedCreditsP90: selectedEstimate.estimatedCreditsP90,
			reservedCredits: selectedEstimate.reservedCredits,
			executionProfileId: selected.executionProfileId ?? selectedEstimate.executionProfileId ?? null,
			executionProviderId: selected.executionProviderId ?? null,
			nativeUnit: selected.nativeUnit ?? null,
			reservedNativeAmount: selected.reservedNativeAmount ?? null,
			derivedAvailableCredits: selected.derivedAvailableCredits ?? null,
			derivedCapacityMode: selected.derivedCapacityMode ?? 'derived',
			nativePressure: selected.nativePressure ?? null,
			costMultiplier: selectedEstimate.costMultiplier ?? null,
			score: selected.score.score,
			attentionEstimate: selected.attentionEstimate ?? null,
			utilityEstimate: selected.utilityEstimate ?? null,
			reservePrediction: selected.reservePrediction ?? null,
			hybridExecutionPlan,
			candidates: candidatePayload,
		},
		candidates,
	};
}
