import type { WorkdayBorrowingEvidence } from './workday-profile.ts';

export type WorkdayDemandMode = 'planning' | 'acting';

export interface WorkdayIntent {
	schemaVersion: 'treeseed.workday-intent/v1';
	teamId: string;
	profileId: string;
	projects: 'all' | string[];
	startsAt: string;
	endsAt?: string;
	durationSeconds?: number;
	objectiveFilters?: string[];
	operatorConstraints?: {
		providerIds?: string[];
		maxConcurrency?: number;
		reservePercent?: number;
	};
}

export interface WorkdayActingAuthorityEvidence {
	decisionId: string;
	decisionStatus: 'approved';
	executionInputId: string;
	executionInputStatus: 'accepted';
	estimateId: string;
	capacityPlanId: string;
	capacityPlanDigest: string;
}

export interface WorkdaySelectedDemand {
	id: string;
	projectId: string;
	sourceType: string;
	sourceId: string;
	mode: WorkdayDemandMode;
	classSlug: string;
	requestedSeconds: number;
	priority: number;
	actingAuthority?: WorkdayActingAuthorityEvidence;
}

export interface WorkdayClassAccounting {
	classSlug: string;
	allocatedSeconds: number;
	borrowedSeconds: number;
	lentSeconds: number;
	idleSeconds: number;
	reservedSeconds: number;
	activeSeconds: number;
	releasedSeconds: number;
	overrunSeconds: number;
}

export interface WorkdayPreflightReceipt {
	schemaVersion: 'treeseed.workday-preflight/v1';
	id: string;
	teamId: string;
	intentDigest: string;
	profileId: string;
	profileVersion: string;
	profileGeneration: number;
	profileDigest: string;
	demandSetDigest: string;
	providerCapacityDigest: string;
	authorizationDigest: string;
	reservationDigest: string;
	selectedDemands: WorkdaySelectedDemand[];
	classAccounting: WorkdayClassAccounting[];
	borrowing: WorkdayBorrowingEvidence[];
	startsAt: string;
	endsAt: string;
	maxConcurrency: number;
	reserveSeconds: number;
	preflightDigest: string;
	expiresAt: string;
}

export interface WorkdayPreflightObservation {
	profileGeneration: number;
	profileDigest: string;
	demandSetDigest: string;
	providerCapacityDigest: string;
	authorizationDigest: string;
	reservationDigest: string;
}

export interface WorkdayStartRequest {
	preflightId: string;
	preflightDigest: string;
	idempotencyKey: string;
}

export interface WorkdayStartReceipt {
	schemaVersion: 'treeseed.workday-start-receipt/v1';
	workdayId: string;
	preflightId: string;
	preflightDigest: string;
	acceptedCapacityPlanIds: string[];
	assignmentIds: string[];
	reservationIds: string[];
	startedAt: string;
	providerReceiptRefs: string[];
	transactionReceiptId: string;
}

export interface WorkdaySchedule {
	schemaVersion: 'treeseed.workday-schedule/v1';
	id: string;
	teamId: string;
	profileId: string;
	profileVersion: string;
	projectScope: 'all' | string[];
	cadence: { timezone: string; expression: string };
	durationSeconds: number;
	status: 'active' | 'paused' | 'retired';
	nextStartAt: string | null;
}

export interface WorkdaySettlement {
	schemaVersion: 'treeseed.workday-settlement/v1';
	workdayId: string;
	status: 'completed' | 'cancelled' | 'failed' | 'degraded';
	preflightDigest: string;
	classAccounting: WorkdayClassAccounting[];
	assignmentIds: string[];
	releasedReservationIds: string[];
	artifactRefs: string[];
	startedAt: string;
	completedAt: string;
	settlementDigest: string;
}

export interface RepositoryProfileGenerationReceipt {
	schemaVersion: 'treeseed.repository-profile-generation/v1';
	repository: string;
	ref: string;
	commit: string;
	path: string;
	profileId: string;
	profileVersion: string;
	profileDigest: string;
	generation: number;
	indexedAt: string;
}

export interface RepositoryProfileReconciliationReceipt {
	schemaVersion: 'treeseed.repository-profile-reconciliation/v1';
	repository: string;
	observedCommit: string;
	previousGeneration: number | null;
	acceptedGeneration: number;
	profileDigests: string[];
	status: 'created' | 'updated' | 'unchanged' | 'rejected';
	diagnostics: string[];
	receiptDigest: string;
}

export interface WorkdayLifecycleDiagnostic {
	code: string;
	path: string;
	message: string;
}

export function validateWorkdayIntent(intent: WorkdayIntent): WorkdayLifecycleDiagnostic[] {
	const diagnostics: WorkdayLifecycleDiagnostic[] = [];
	if (intent.schemaVersion !== 'treeseed.workday-intent/v1') diagnostics.push({ code: 'schema_version_invalid', path: 'schemaVersion', message: 'Unsupported workday intent schema.' });
	if (!intent.teamId.trim()) diagnostics.push({ code: 'team_required', path: 'teamId', message: 'Team identity is required.' });
	if (!intent.profileId.trim()) diagnostics.push({ code: 'profile_required', path: 'profileId', message: 'Allocation profile identity is required.' });
	if ((intent.endsAt === undefined) === (intent.durationSeconds === undefined)) diagnostics.push({ code: 'time_range_ambiguous', path: 'endsAt', message: 'Specify exactly one of endsAt or durationSeconds.' });
	const start = Date.parse(intent.startsAt);
	if (!Number.isFinite(start)) diagnostics.push({ code: 'start_invalid', path: 'startsAt', message: 'startsAt must be an ISO timestamp.' });
	if (intent.endsAt !== undefined && (!Number.isFinite(Date.parse(intent.endsAt)) || Date.parse(intent.endsAt) <= start)) diagnostics.push({ code: 'end_invalid', path: 'endsAt', message: 'endsAt must be a valid timestamp after startsAt.' });
	if (intent.durationSeconds !== undefined && (!Number.isInteger(intent.durationSeconds) || intent.durationSeconds <= 0)) diagnostics.push({ code: 'duration_invalid', path: 'durationSeconds', message: 'durationSeconds must be a positive integer.' });
	return diagnostics;
}

export function validateSelectedDemand(demand: WorkdaySelectedDemand): WorkdayLifecycleDiagnostic[] {
	const diagnostics: WorkdayLifecycleDiagnostic[] = [];
	if (demand.requestedSeconds <= 0 || !Number.isInteger(demand.requestedSeconds)) diagnostics.push({ code: 'requested_seconds_invalid', path: 'requestedSeconds', message: 'Demand duration must be a positive integer.' });
	if (demand.mode === 'acting' && !demand.actingAuthority) diagnostics.push({ code: 'acting_authority_required', path: 'actingAuthority', message: 'Acting demand requires approved decision, accepted execution input, estimate, and API-derived capacity plan evidence.' });
	if (demand.mode === 'acting' && demand.actingAuthority && (demand.actingAuthority.decisionStatus !== 'approved' || demand.actingAuthority.executionInputStatus !== 'accepted')) diagnostics.push({ code: 'acting_authority_invalid', path: 'actingAuthority', message: 'Acting authority must bind an approved decision and accepted execution input.' });
	if (demand.mode === 'acting' && demand.actingAuthority && [demand.actingAuthority.decisionId, demand.actingAuthority.executionInputId, demand.actingAuthority.estimateId, demand.actingAuthority.capacityPlanId, demand.actingAuthority.capacityPlanDigest].some((value) => !value.trim())) diagnostics.push({ code: 'acting_authority_identity_missing', path: 'actingAuthority', message: 'Acting authority must bind non-empty decision, execution, estimate, capacity-plan, and plan-digest identities.' });
	return diagnostics;
}

export function validateWorkdayPreflight(receipt: WorkdayPreflightReceipt, now = new Date()): WorkdayLifecycleDiagnostic[] {
	const diagnostics = receipt.selectedDemands.flatMap((demand, index) => validateSelectedDemand(demand).map((diagnostic) => ({ ...diagnostic, path: `selectedDemands.${index}.${diagnostic.path}` })));
	if (receipt.schemaVersion !== 'treeseed.workday-preflight/v1') diagnostics.push({ code: 'schema_version_invalid', path: 'schemaVersion', message: 'Unsupported workday preflight schema.' });
	for (const field of ['intentDigest', 'profileDigest', 'demandSetDigest', 'providerCapacityDigest', 'authorizationDigest', 'reservationDigest', 'preflightDigest'] as const) {
		if (!receipt[field].trim()) diagnostics.push({ code: 'digest_required', path: field, message: `${field} is required.` });
	}
	if (Date.parse(receipt.expiresAt) <= now.getTime()) diagnostics.push({ code: 'preflight_expired', path: 'expiresAt', message: 'Workday preflight has expired and must be regenerated.' });
	if (!Number.isFinite(Date.parse(receipt.startsAt)) || !Number.isFinite(Date.parse(receipt.endsAt)) || Date.parse(receipt.endsAt) <= Date.parse(receipt.startsAt)) diagnostics.push({ code: 'preflight_time_range_invalid', path: 'endsAt', message: 'Preflight must bind a valid time range.' });
	if (!Number.isInteger(receipt.maxConcurrency) || receipt.maxConcurrency <= 0) diagnostics.push({ code: 'preflight_concurrency_invalid', path: 'maxConcurrency', message: 'Preflight concurrency must be a positive integer.' });
	if (!Number.isFinite(receipt.reserveSeconds) || receipt.reserveSeconds < 0) diagnostics.push({ code: 'preflight_reserve_invalid', path: 'reserveSeconds', message: 'Preflight reserve seconds must be finite and non-negative.' });
	return diagnostics;
}

export function validateWorkdayPreflightFreshness(receipt: WorkdayPreflightReceipt, observed: WorkdayPreflightObservation): WorkdayLifecycleDiagnostic[] {
	const diagnostics: WorkdayLifecycleDiagnostic[] = [];
	for (const field of ['profileGeneration', 'profileDigest', 'demandSetDigest', 'providerCapacityDigest', 'authorizationDigest', 'reservationDigest'] as const) {
		if (receipt[field] !== observed[field]) diagnostics.push({ code: 'preflight_state_changed', path: field, message: `${field} changed after preflight; generate a fresh plan.` });
	}
	return diagnostics;
}

export function validateWorkdaySettlement(settlement: WorkdaySettlement): WorkdayLifecycleDiagnostic[] {
	const diagnostics: WorkdayLifecycleDiagnostic[] = [];
	for (const [index, accounting] of settlement.classAccounting.entries()) {
		for (const [field, value] of Object.entries(accounting).filter(([field]) => field !== 'classSlug')) {
			if (!Number.isFinite(value) || value < 0) diagnostics.push({ code: 'settlement_accounting_invalid', path: `classAccounting.${index}.${field}`, message: 'Settlement seconds must be finite and non-negative.' });
		}
		if (accounting.lentSeconds > accounting.allocatedSeconds + accounting.borrowedSeconds) diagnostics.push({ code: 'settlement_lending_invalid', path: `classAccounting.${index}.lentSeconds`, message: 'A class cannot lend more capacity than it held.' });
	}
	if (!settlement.preflightDigest.trim() || !settlement.settlementDigest.trim()) diagnostics.push({ code: 'settlement_digest_required', path: 'settlementDigest', message: 'Settlement must bind its preflight and final accounting digests.' });
	return diagnostics;
}
