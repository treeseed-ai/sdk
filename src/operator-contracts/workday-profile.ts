export type WorkdayDemandSourcePolicy =
	| 'approved-decisions'
	| 'planning-inputs'
	| 'questions'
	| 'proposals'
	| 'knowledge-gaps'
	| 'reliability-campaigns';

export interface WorkdayClassAllocation {
	classSlug: string;
	minimumPercent: number;
	targetPercent: number;
	maximumPercent: number;
	mayLend: boolean;
	mayBorrow: boolean;
}

export interface WorkdayAllocationProfile {
	schemaVersion: 'treeseed.workday-allocation-profile/v1';
	id: string;
	version: string;
	projects: 'all' | string[];
	excludedClassSlugs?: Record<string, string[]>;
	classes: WorkdayClassAllocation[];
	demandSources: WorkdayDemandSourcePolicy[];
	actingDecisionRequired: true;
	defaultDurationSeconds: number;
	maxConcurrency: number;
	reservePercent: number;
	prioritization: {
		strategy: 'priority-then-age' | 'age-then-priority' | 'weighted-fair';
		starvationLimitSeconds: number;
	};
}

export interface RepositoryWorkdayProfileBundle {
	schemaVersion: 'treeseed.workday-allocation-profile-bundle/v1';
	profiles: WorkdayAllocationProfile[];
}

export interface ProjectAgentClassMembership {
	projectId: string;
	agentId: string;
	classSlug: string;
	status: 'active' | 'paused' | 'archived';
}

export interface ProjectAgentIdentity {
	projectId: string;
	agentId: string;
}

export interface ProjectClassCatalog {
	projectId: string;
	classSlugs: string[];
}

export interface WorkdayProfileDiagnostic {
	code: string;
	path: string;
	message: string;
}

export interface WorkdayBorrowingEvidence {
	workdayId: string;
	borrowerClassSlug: string;
	lenderClassSlug: string;
	borrowedSeconds: number;
	lendingPermitted: boolean;
	borrowingPermitted: boolean;
	lenderAllocatedSecondsBefore: number;
	lenderAllocatedSecondsAfter: number;
	lenderMinimumSeconds: number;
	borrowerAllocatedSecondsBefore: number;
	borrowerAllocatedSecondsAfter: number;
	borrowerMaximumSeconds: number;
	profileId: string;
	profileVersion: string;
	profileDigest: string;
}

const PERCENT_TOLERANCE = 0.000001;
const PROFILE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function validateOneClassPerProjectAgent(memberships: ProjectAgentClassMembership[], expectedAgents: ProjectAgentIdentity[] = []): WorkdayProfileDiagnostic[] {
	const diagnostics: WorkdayProfileDiagnostic[] = [];
	const byAgent = new Map<string, ProjectAgentClassMembership[]>();
	for (const membership of memberships) {
		const key = `${membership.projectId}:${membership.agentId}`;
		byAgent.set(key, [...(byAgent.get(key) ?? []), membership]);
	}
	for (const [key, values] of byAgent) {
		if (values.length !== 1) diagnostics.push({ code: 'agent_class_membership_multiple', path: `memberships.${key}`, message: 'Each project agent must have exactly one allocation-class membership.' });
		if (values.some((value) => value.status !== 'active')) diagnostics.push({ code: 'agent_class_membership_inactive', path: `memberships.${key}`, message: 'The single allocation-class membership must be active.' });
	}
	for (const agent of expectedAgents) {
		const key = `${agent.projectId}:${agent.agentId}`;
		if (!byAgent.has(key)) diagnostics.push({ code: 'agent_class_membership_missing', path: `memberships.${key}`, message: 'Each project agent must have exactly one allocation-class membership.' });
	}
	return diagnostics;
}

export function validateWorkdayAllocationProfile(
	profile: WorkdayAllocationProfile,
	classCatalogs?: ProjectClassCatalog[],
): WorkdayProfileDiagnostic[] {
	const diagnostics: WorkdayProfileDiagnostic[] = [];
	if (profile.schemaVersion !== 'treeseed.workday-allocation-profile/v1') diagnostics.push({ code: 'schema_version_invalid', path: 'schemaVersion', message: 'Unsupported workday allocation profile schema.' });
	if (!profile.id.trim()) diagnostics.push({ code: 'profile_id_required', path: 'id', message: 'Profile id is required.' });
	if (!PROFILE_VERSION.test(profile.version)) diagnostics.push({ code: 'profile_version_invalid', path: 'version', message: 'Profile version must be a semantic version.' });
	if (profile.actingDecisionRequired !== true) diagnostics.push({ code: 'acting_decision_requirement_invalid', path: 'actingDecisionRequired', message: 'Acting work must require an approved decision.' });
	if (profile.projects !== 'all' && profile.projects.length === 0) diagnostics.push({ code: 'project_scope_empty', path: 'projects', message: 'Profile project scope must select at least one project or all.' });
	if (profile.demandSources.length === 0) diagnostics.push({ code: 'demand_sources_empty', path: 'demandSources', message: 'At least one governed demand source is required.' });
	if (new Set(profile.demandSources).size !== profile.demandSources.length) diagnostics.push({ code: 'demand_source_duplicate', path: 'demandSources', message: 'Demand sources must be unique.' });
	if (!Number.isInteger(profile.defaultDurationSeconds) || profile.defaultDurationSeconds <= 0) diagnostics.push({ code: 'duration_invalid', path: 'defaultDurationSeconds', message: 'Default duration must be a positive integer number of seconds.' });
	if (!Number.isInteger(profile.maxConcurrency) || profile.maxConcurrency <= 0) diagnostics.push({ code: 'concurrency_invalid', path: 'maxConcurrency', message: 'Maximum concurrency must be a positive integer.' });
	if (!Number.isFinite(profile.reservePercent) || profile.reservePercent < 0 || profile.reservePercent > 100) diagnostics.push({ code: 'reserve_invalid', path: 'reservePercent', message: 'Reserve percent must be between 0 and 100.' });
	if (!Number.isFinite(profile.prioritization.starvationLimitSeconds) || profile.prioritization.starvationLimitSeconds <= 0) diagnostics.push({ code: 'starvation_limit_invalid', path: 'prioritization.starvationLimitSeconds', message: 'Starvation limit must be positive.' });

	const classSlugs = new Set<string>();
	let minimumTotal = 0;
	let targetTotal = 0;
	let maximumTotal = 0;
	for (const [index, allocation] of profile.classes.entries()) {
		const path = `classes.${index}`;
		if (!allocation.classSlug.trim()) diagnostics.push({ code: 'class_slug_required', path: `${path}.classSlug`, message: 'Class slug is required.' });
		if (classSlugs.has(allocation.classSlug)) diagnostics.push({ code: 'class_slug_duplicate', path: `${path}.classSlug`, message: `Class ${allocation.classSlug} is declared more than once.` });
		classSlugs.add(allocation.classSlug);
		const values = [allocation.minimumPercent, allocation.targetPercent, allocation.maximumPercent];
		if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100) || allocation.minimumPercent > allocation.targetPercent || allocation.targetPercent > allocation.maximumPercent) diagnostics.push({ code: 'class_allocation_invalid', path, message: 'Class allocation must satisfy 0 <= minimum <= target <= maximum <= 100.' });
		minimumTotal += allocation.minimumPercent;
		targetTotal += allocation.targetPercent;
		maximumTotal += allocation.maximumPercent;
	}
	if (minimumTotal > 100 + PERCENT_TOLERANCE) diagnostics.push({ code: 'minimum_total_invalid', path: 'classes', message: 'Class minimum percentages cannot total more than 100.' });
	if (Math.abs(targetTotal - 100) > PERCENT_TOLERANCE) diagnostics.push({ code: 'target_total_invalid', path: 'classes', message: 'Class target percentages must total exactly 100.' });
	if (maximumTotal < 100 - PERCENT_TOLERANCE) diagnostics.push({ code: 'maximum_total_invalid', path: 'classes', message: 'Class maximum percentages must total at least 100.' });

	const selectedProjects = classCatalogs === undefined ? [] : profile.projects === 'all' ? classCatalogs.map((catalog) => catalog.projectId) : profile.projects;
	for (const projectId of selectedProjects) {
		const catalog = classCatalogs?.find((candidate) => candidate.projectId === projectId);
		if (!catalog) {
			diagnostics.push({ code: 'project_class_catalog_missing', path: `projects.${projectId}`, message: `No class catalog exists for selected project ${projectId}.` });
			continue;
		}
		const exclusions = new Set(profile.excludedClassSlugs?.[projectId] ?? []);
		for (const classSlug of classSlugs) {
			if (!catalog.classSlugs.includes(classSlug) && !exclusions.has(classSlug)) diagnostics.push({ code: 'class_missing_from_project', path: `projects.${projectId}.${classSlug}`, message: `Class ${classSlug} is missing from project ${projectId} and is not explicitly excluded.` });
		}
	}
	return diagnostics;
}

export function normalizeWorkdayAllocationProfile(profile: WorkdayAllocationProfile): WorkdayAllocationProfile {
	return {
		...profile,
		projects: profile.projects === 'all' ? 'all' : [...new Set(profile.projects)].sort(),
		excludedClassSlugs: profile.excludedClassSlugs
			? Object.fromEntries(Object.entries(profile.excludedClassSlugs).sort(([left], [right]) => left.localeCompare(right)).map(([projectId, slugs]) => [projectId, [...new Set(slugs)].sort()]))
			: undefined,
		classes: [...profile.classes].sort((left, right) => left.classSlug.localeCompare(right.classSlug)),
		demandSources: [...new Set(profile.demandSources)].sort(),
	};
}

export function validateRepositoryWorkdayProfileBundle(bundle: RepositoryWorkdayProfileBundle,classCatalogs?: ProjectClassCatalog[]): WorkdayProfileDiagnostic[] {
	const diagnostics: WorkdayProfileDiagnostic[] = [];
	if (bundle.schemaVersion !== 'treeseed.workday-allocation-profile-bundle/v1') diagnostics.push({ code: 'bundle_schema_version_invalid', path: 'schemaVersion', message: 'Unsupported repository workday profile bundle schema.' });
	if (!Array.isArray(bundle.profiles) || bundle.profiles.length === 0) diagnostics.push({ code: 'bundle_profiles_empty', path: 'profiles', message: 'A repository workday profile bundle must contain at least one profile.' });
	const profileIds = new Set<string>();
	for (const [index, profile] of (Array.isArray(bundle.profiles) ? bundle.profiles : []).entries()) {
		if (profileIds.has(profile.id)) diagnostics.push({ code: 'bundle_profile_id_duplicate', path: `profiles.${index}.id`, message: `Stable profile id ${profile.id} is declared more than once; a repository bundle contains exactly one current generation per profile.` });
		profileIds.add(profile.id);
		diagnostics.push(...validateWorkdayAllocationProfile(profile,classCatalogs).map((diagnostic) => ({ ...diagnostic, path: `profiles.${index}.${diagnostic.path}` })));
	}
	return diagnostics;
}

export function normalizeRepositoryWorkdayProfileBundle(bundle: RepositoryWorkdayProfileBundle): RepositoryWorkdayProfileBundle {
	return { schemaVersion:'treeseed.workday-allocation-profile-bundle/v1',profiles:[...bundle.profiles].map(normalizeWorkdayAllocationProfile).sort((left,right)=>left.id.localeCompare(right.id)||left.version.localeCompare(right.version)) };
}

export function validateWorkdayBorrowingEvidence(evidence: WorkdayBorrowingEvidence): WorkdayProfileDiagnostic[] {
	const diagnostics: WorkdayProfileDiagnostic[] = [];
	if (!evidence.lendingPermitted) diagnostics.push({ code: 'lending_not_permitted', path: 'lendingPermitted', message: 'The profile does not permit the lender to lend capacity.' });
	if (!evidence.borrowingPermitted) diagnostics.push({ code: 'borrowing_not_permitted', path: 'borrowingPermitted', message: 'The profile does not permit the borrower to borrow capacity.' });
	if (evidence.borrowedSeconds <= 0) diagnostics.push({ code: 'borrowed_seconds_invalid', path: 'borrowedSeconds', message: 'Borrowed seconds must be positive.' });
	if (evidence.lenderAllocatedSecondsAfter < evidence.lenderMinimumSeconds) diagnostics.push({ code: 'lender_minimum_violated', path: 'lenderAllocatedSecondsAfter', message: 'Borrowing cannot reduce the lender below its minimum.' });
	if (evidence.borrowerAllocatedSecondsAfter > evidence.borrowerMaximumSeconds) diagnostics.push({ code: 'borrower_maximum_violated', path: 'borrowerAllocatedSecondsAfter', message: 'Borrowing cannot raise the borrower above its maximum.' });
	if (evidence.lenderAllocatedSecondsBefore - evidence.lenderAllocatedSecondsAfter !== evidence.borrowedSeconds || evidence.borrowerAllocatedSecondsAfter - evidence.borrowerAllocatedSecondsBefore !== evidence.borrowedSeconds) diagnostics.push({ code: 'borrowing_accounting_mismatch', path: 'borrowedSeconds', message: 'Lender and borrower deltas must exactly equal the borrowed seconds.' });
	return diagnostics;
}
