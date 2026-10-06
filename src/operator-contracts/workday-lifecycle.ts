import type { WorkdayAgentSelection } from '../agent-capacity/workday.ts';
import { workdayAllocationOverridesSchema } from '../agent-capacity/contracts/capacity/workdays/workday-allocation.ts';
import { z } from 'zod';
import { leaseSchema } from '../agent-capacity/contracts/capacity/assignments/agent-execution.ts';
import { alternativeProperties, conditionalFields, exclusiveProperties, exclusiveUnion, uniqueArray } from '../content/validation/schema-constraints.ts';
export { normalizeWorkdayAgentSelection } from '../agent-capacity/workday.ts';

const identifier = leaseSchema.shape.id, timestamp = leaseSchema.shape.acquiredAt;
const selectedIdentities = uniqueArray(z.array(identifier).min(1).max(64));
const intentAgentSelectionSchema = alternativeProperties(z.object({
	agentSlugs: z.array(identifier).min(1).optional(), classIds: z.array(identifier).min(1).optional(),
	classSlugs: z.array(identifier).min(1).optional(),
	activityTypes: z.array(z.enum(['planning', 'estimating', 'reviewing', 'reporting', 'chat'])).min(1).optional(),
	mode: z.literal('intersection').optional(),
}).strict(), ['agentSlugs', 'activityTypes', 'classIds', 'classSlugs']);
/** One normalized high-level contract for manual and recurring execution. */
const workdayIntentFields = z.object({
	schemaVersion: z.literal('treeseed.workday-intent/v1'), teamId: identifier, profileId: identifier,
	projects: exclusiveUnion(z.union([z.literal('all'), uniqueArray(z.array(identifier).min(1))])),
	executionMode: z.enum(['simulation', 'production']).default('simulation').optional(),
	startsAt: timestamp, endsAt: timestamp.optional(), durationSeconds: z.number().int().positive().optional(),
	planningOnly: z.boolean().optional(), objectiveFilters: z.array(identifier).optional(),
	proposalIds: selectedIdentities.optional(), decisionIds: selectedIdentities.optional(),
	continueFromWorkdayId: z.string().min(1).max(128).regex(/\S/u).optional(),
	allocation: workdayAllocationOverridesSchema.optional(), agentSelection: intentAgentSelectionSchema.optional(),
	operatorConstraints: z.object({ providerIds: uniqueArray(z.array(identifier)).optional(), maxConcurrency: z.number().int().positive().optional() }).strict().optional(),
}).strict();
const continuationRules = [{ field: 'continueFromWorkdayId', alternatives: [['decisionIds']],
	forbidden: { fields: ['proposalIds'], conditions: [{ field: 'planningOnly', equals: true }] },
	path: ['continueFromWorkdayId'], message: 'Continuation requires exact decisions, not new proposal planning.' }] as const;
export const workdayIntentSchema = exclusiveProperties(conditionalFields(workdayIntentFields, continuationRules), ['endsAt', 'durationSeconds']);

/** Public request metadata is route-owned; every represented intent field retains its canonical rule. */
const requestIntentFields = z.preprocess(value => {
	if (!value || typeof value !== 'object' || Array.isArray(value) || !('decisionIds' in value) || !Array.isArray(value.decisionIds)) return value;
	return { ...value, decisionIds: value.decisionIds.map(entry => typeof entry === 'string' ? entry.trim() : entry) };
}, exclusiveProperties(conditionalFields(workdayIntentFields.partial({ schemaVersion: true, teamId: true }), continuationRules), ['endsAt', 'durationSeconds']))
	.superRefine((intent, context) => {
		if (!validIntentRange(intent)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'endsAt must be after startsAt.' });
	});
export const workdayIntentRequestSchema = z.custom<Record<string, unknown>>(value => Boolean(value && typeof value === 'object' && !Array.isArray(value)))
	.transform((intent, context) => {
		const parsed = requestIntentFields.safeParse(intent);
		if (!parsed.success) { for (const issue of parsed.error.issues) context.addIssue(issue); return z.NEVER; }
		return { ...intent, ...parsed.data, ...(parsed.data.decisionIds ? { decisionIds: [...parsed.data.decisionIds].sort() } : {}) };
	});

function validIntentRange(intent: { startsAt: string; endsAt?: string }) {
	return intent.endsAt === undefined || Date.parse(intent.endsAt) > Date.parse(intent.startsAt);
}

export type WorkdayDemandMode = 'planning' | 'acting';

export interface WorkdayIntent {
	schemaVersion: 'treeseed.workday-intent/v1';
	teamId: string;
	profileId: string;
	projects: 'all' | string[];
	/** Selects the existing execution custody mode; omission defaults safely to simulation. */
	executionMode?: 'simulation' | 'production';
	startsAt: string;
	endsAt?: string;
	durationSeconds?: number;
	objectiveFilters?: string[];
	/** Runs cooperative planning profiles without admitting accepted acting work. */
	planningOnly?: boolean;
	/** Selects exact governed proposals for cooperative planning and estimating. */
	proposalIds?: string[];
	/** Selects accepted decisions for API-derived acting work; it does not grant acting authority. */
	decisionIds?: string[];
	/** Continue exact accepted work from a settled workday; omission starts a fresh simulation. */
	continueFromWorkdayId?: string;
	/** Limits cooperative planning; acting still requires accepted decision/estimate authority. */
	agentSelection?: Partial<WorkdayAgentSelection>;
	/** High-level overrides of the canonical workday allocation policy. */
	allocation?: Partial<Pick<import('../agent-capacity/contracts/capacity/workdays/workday-allocation.ts').WorkdayPolicy,
		'planningPercent' | 'allocationWeight' | 'planningTurnMaximumSeconds' | 'projectPercentages' | 'agentClassPercentages'>>;
	operatorConstraints?: {
		providerIds?: string[];
		maxConcurrency?: number;
	};
}

export interface WorkdayActingAuthorityEvidence {
	decisionId: string;
	decisionRevision: number;
	executionNodeId: string;
	executionNodeRevision: number;
	graphRevision: number;
	sourceDigest: string;
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
	startsAt: string;
	endsAt: string;
	maxConcurrency: number;
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
	acceptedExecutionNodeIds: string[];
	assignmentIds: string[];
	reservationIds: string[];
	startedAt: string;
	providerReceiptRefs: string[];
	transactionReceiptId: string;
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

function portableIntentInput(intent: WorkdayIntent) {
	return { ...intent, ...(Array.isArray(intent.decisionIds) ? { decisionIds: intent.decisionIds.map(value => typeof value === 'string' ? value.trim() : value) } : {}) };
}

export function validateWorkdayIntent(intent: WorkdayIntent): WorkdayLifecycleDiagnostic[] {
	const result = workdayIntentSchema.safeParse(portableIntentInput(intent));
	const codes: Record<string, string> = { schemaVersion: 'schema_version_invalid', teamId: 'team_required', profileId: 'profile_required',
		projects: 'project_selection_invalid', operatorConstraints: 'operator_constraints_invalid', executionMode: 'execution_mode_invalid',
		startsAt: 'start_invalid', endsAt: 'end_invalid', durationSeconds: 'duration_invalid', planningOnly: 'planning_only_invalid',
		objectiveFilters: 'objective_selection_invalid', proposalIds: 'proposal_selection_invalid', decisionIds: 'decision_selection_invalid',
		continueFromWorkdayId: 'continuation_invalid', agentSelection: 'agent_selection_invalid', allocation: 'allocation_invalid' };
	const diagnostics: WorkdayLifecycleDiagnostic[] = result.success ? [] : result.error.issues.flatMap(issue => {
		if (issue.code === z.ZodIssueCode.unrecognized_keys && !issue.path.length)
			return issue.keys.map(key => ({ code: 'field_forbidden', path: key, message: 'Derived execution state is not portable workday intent.' }));
		const root = String(issue.path[0] ?? '');
		return [{ code: root === 'endsAt' && intent.durationSeconds !== undefined && intent.endsAt !== undefined
			? 'time_range_ambiguous' : codes[root] ?? 'intent_invalid',
			path: root === 'allocation' || root === 'agentSelection' ? issue.path.join('.') : root, message: issue.message }];
	});
	// Temporal admission is separate from the portable stored shape.
	if (!validIntentRange(intent))
		diagnostics.push({ code: 'end_invalid', path: 'endsAt', message: 'endsAt must be after startsAt.' });
	return diagnostics;
}

/** Preserve raw caller evidence; normalize only legitimate selector input. */
export function normalizeWorkdayIntent(intent: WorkdayIntent): WorkdayIntent {
	const diagnostics = validateWorkdayIntent(intent);
	if (diagnostics.length) throw new Error(`Invalid workday intent: ${diagnostics.map(value => `${value.path}: ${value.message}`).join('; ')}`);
	const normalized = workdayIntentSchema.parse(portableIntentInput(intent));
	return { ...intent, ...normalized, ...(normalized.decisionIds ? { decisionIds: [...normalized.decisionIds].sort() } : {}) };
}

export function validateWorkdayIntentSelection(value: unknown): WorkdayLifecycleDiagnostic[] {
	const input = value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(
		Object.entries(value).map(([key, entries]) => [key, Array.isArray(entries) ? entries.map(entry => typeof entry === 'string' ? entry.trim() : entry) : entries])) : value;
	const result = intentAgentSelectionSchema.safeParse(input);
	return result.success ? [] : result.error.issues.map(issue => ({ code: 'agent_selection_invalid',
		path: ['agentSelection', ...issue.path].join('.'), message: issue.message }));
}

export function validateSelectedDemand(demand: WorkdaySelectedDemand): WorkdayLifecycleDiagnostic[] {
	const diagnostics: WorkdayLifecycleDiagnostic[] = [];
	if (demand.requestedSeconds <= 0 || !Number.isInteger(demand.requestedSeconds)) diagnostics.push({ code: 'requested_seconds_invalid', path: 'requestedSeconds', message: 'Demand duration must be a positive integer.' });
	if (demand.mode === 'acting' && !demand.actingAuthority) diagnostics.push({ code: 'acting_authority_required', path: 'actingAuthority', message: 'Acting demand requires an exact accepted decision and living execution-node revision.' });
	if (demand.mode === 'acting' && demand.actingAuthority && [demand.actingAuthority.decisionId, demand.actingAuthority.executionNodeId, demand.actingAuthority.sourceDigest].some((value) => typeof value !== 'string' || !value.trim())) diagnostics.push({ code: 'acting_authority_identity_missing', path: 'actingAuthority', message: 'Acting authority must bind non-empty decision, execution-node, and source identities.' });
	if (demand.mode === 'acting' && demand.actingAuthority && [demand.actingAuthority.decisionRevision, demand.actingAuthority.executionNodeRevision, demand.actingAuthority.graphRevision].some((value) => !Number.isInteger(value) || value <= 0)) diagnostics.push({ code: 'acting_authority_revision_invalid', path: 'actingAuthority', message: 'Acting authority must bind positive decision, node, and graph revisions.' });
	return diagnostics;
}

export function validateWorkdayPreflight(receipt: WorkdayPreflightReceipt, now = new Date()): WorkdayLifecycleDiagnostic[] {
	const diagnostics = receipt.selectedDemands.flatMap((demand, index) => validateSelectedDemand(demand).map((diagnostic) => ({ ...diagnostic, path: `selectedDemands.${index}.${diagnostic.path}` })));
	if (receipt.schemaVersion !== 'treeseed.workday-preflight/v1') diagnostics.push({ code: 'schema_version_invalid', path: 'schemaVersion', message: 'Unsupported workday preflight schema.' });
	if (!Number.isInteger(receipt.profileGeneration) || receipt.profileGeneration <= 0) diagnostics.push({ code: 'profile_generation_invalid', path: 'profileGeneration', message: 'Profile generation must be a positive integer.' });
	for (const field of ['intentDigest', 'profileDigest', 'demandSetDigest', 'providerCapacityDigest', 'authorizationDigest', 'reservationDigest', 'preflightDigest'] as const) {
		if (!receipt[field].trim()) diagnostics.push({ code: 'digest_required', path: field, message: `${field} is required.` });
	}
	const expiry = Date.parse(receipt.expiresAt);
	if (!Number.isFinite(expiry)) diagnostics.push({ code: 'preflight_expiry_invalid', path: 'expiresAt', message: 'Preflight expiry must be a valid timestamp.' });
	else if (expiry <= now.getTime()) diagnostics.push({ code: 'preflight_expired', path: 'expiresAt', message: 'Workday preflight has expired and must be regenerated.' });
	if (!Number.isFinite(Date.parse(receipt.startsAt)) || !Number.isFinite(Date.parse(receipt.endsAt)) || Date.parse(receipt.endsAt) <= Date.parse(receipt.startsAt)) diagnostics.push({ code: 'preflight_time_range_invalid', path: 'endsAt', message: 'Preflight must bind a valid time range.' });
	if (!Number.isInteger(receipt.maxConcurrency) || receipt.maxConcurrency <= 0) diagnostics.push({ code: 'preflight_concurrency_invalid', path: 'maxConcurrency', message: 'Preflight concurrency must be a positive integer.' });
	if (new Set(receipt.selectedDemands.map((demand) => demand.id)).size !== receipt.selectedDemands.length) diagnostics.push({ code: 'preflight_demand_duplicate', path: 'selectedDemands', message: 'Preflight demand identities must be unique.' });
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
	if (settlement.schemaVersion !== 'treeseed.workday-settlement/v1') diagnostics.push({ code: 'schema_version_invalid', path: 'schemaVersion', message: 'Unsupported workday settlement schema.' });
	for (const [index, accounting] of settlement.classAccounting.entries()) {
		for (const [field, value] of Object.entries(accounting).filter(([field]) => field !== 'classSlug')) {
			if (!Number.isFinite(value) || value < 0) diagnostics.push({ code: 'settlement_accounting_invalid', path: `classAccounting.${index}.${field}`, message: 'Settlement seconds must be finite and non-negative.' });
		}
	}
	if (!settlement.preflightDigest.trim() || !settlement.settlementDigest.trim()) diagnostics.push({ code: 'settlement_digest_required', path: 'settlementDigest', message: 'Settlement must bind its preflight and final accounting digests.' });
	if (!Number.isFinite(Date.parse(settlement.startedAt)) || !Number.isFinite(Date.parse(settlement.completedAt)) || Date.parse(settlement.completedAt) < Date.parse(settlement.startedAt)) diagnostics.push({ code: 'settlement_time_range_invalid', path: 'completedAt', message: 'Settlement must bind a valid completion time at or after workday start.' });
	return diagnostics;
}
