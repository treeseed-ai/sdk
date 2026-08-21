import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeRepositoryWorkdayProfileBundle, normalizeWorkdayAllocationProfile, validateOneClassPerProjectAgent, validateRepositoryWorkdayProfileBundle, validateWorkdayAllocationProfile, validateWorkdayBorrowingEvidence, type RepositoryWorkdayProfileBundle, type WorkdayAllocationProfile } from '../../../src/operator-contracts/index.ts';

const profile: WorkdayAllocationProfile = {
	schemaVersion: 'treeseed.workday-allocation-profile/v1',
	id: 'feature-heavy',
	version: '1.0.0',
	projects: ['sdk', 'api'],
	classes: [
		{ classSlug: 'features', minimumPercent: 30, targetPercent: 60, maximumPercent: 80, mayLend: true, mayBorrow: true },
		{ classSlug: 'stability', minimumPercent: 20, targetPercent: 40, maximumPercent: 70, mayLend: true, mayBorrow: true },
	],
	demandSources: ['approved-decisions', 'planning-inputs'],
	actingDecisionRequired: true,
	defaultDurationSeconds: 14_400,
	maxConcurrency: 4,
	reservePercent: 10,
	prioritization: { strategy: 'weighted-fair', starvationLimitSeconds: 3_600 },
};

describe('workday allocation profiles', () => {
	it('accepts a portfolio profile when every selected project supplies its classes', () => {
		expect(validateWorkdayAllocationProfile(profile)).toEqual([]);
		expect(validateWorkdayAllocationProfile(profile, [
			{ projectId: 'sdk', classSlugs: ['features', 'stability'] },
			{ projectId: 'api', classSlugs: ['features', 'stability'] },
		])).toEqual([]);
	});

	it('normalizes repository profile sets deterministically', () => {
		const reversed = { ...profile, projects: ['api', 'sdk', 'api'], classes: [...profile.classes].reverse(), demandSources: [...profile.demandSources].reverse() } satisfies WorkdayAllocationProfile;
		expect(normalizeWorkdayAllocationProfile(reversed)).toMatchObject({ projects: ['api', 'sdk'], classes: [{ classSlug: 'features' }, { classSlug: 'stability' }], demandSources: ['approved-decisions', 'planning-inputs'] });
	});

	it('normalizes and validates multi-profile repository bundles',()=>{
		const second={...profile,id:'stability-heavy',version:'1.1.0'};
		const bundle={schemaVersion:'treeseed.workday-allocation-profile-bundle/v1' as const,profiles:[second,profile]};
		expect(validateRepositoryWorkdayProfileBundle(bundle)).toEqual([]);
		expect(normalizeRepositoryWorkdayProfileBundle(bundle).profiles.map((entry)=>entry.id)).toEqual(['feature-heavy','stability-heavy']);
		expect(validateRepositoryWorkdayProfileBundle({...bundle,profiles:[profile,{...profile,version:'2.0.0'}]}).map((entry)=>entry.code)).toContain('bundle_profile_id_duplicate');
		expect(validateRepositoryWorkdayProfileBundle({...bundle,profiles:[]}).map((entry)=>entry.code)).toContain('bundle_profiles_empty');
	});

	it('ships four valid SDK campaign profiles against the accepted class catalog',()=>{
		const bundle=JSON.parse(readFileSync('.treeseed/workdays/allocation-profile.json','utf8')) as RepositoryWorkdayProfileBundle;
		const catalog=[{projectId:'sdk',classSlugs:['architecture','engineering','release','reporting','research','review','technical-writing','testing']}];
		expect(validateRepositoryWorkdayProfileBundle(bundle,catalog)).toEqual([]);
		expect(new Set(bundle.profiles.map((entry)=>entry.id))).toEqual(new Set(['sdk-feature-heavy','sdk-stability-heavy','sdk-documentation-heavy','sdk-testing-heavy']));
	});

	it('enforces minimum, target, maximum and cross-project class invariants', () => {
		const invalid = structuredClone(profile);
		invalid.classes[0]!.minimumPercent = 90;
		invalid.classes[0]!.targetPercent = 80;
		invalid.classes[1]!.targetPercent = 30;
		invalid.classes[1]!.maximumPercent = 10;
		const codes = validateWorkdayAllocationProfile(invalid, [{ projectId: 'sdk', classSlugs: ['features'] }, { projectId: 'api', classSlugs: [] }]).map((item) => item.code);
		expect(codes).toEqual(expect.arrayContaining(['class_allocation_invalid', 'minimum_total_invalid', 'target_total_invalid', 'class_missing_from_project']));
	});

	it('requires exactly one active class per project agent', () => {
		const diagnostics = validateOneClassPerProjectAgent([
			{ projectId: 'sdk', agentId: 'engineer', classSlug: 'features', status: 'active' },
			{ projectId: 'sdk', agentId: 'engineer', classSlug: 'stability', status: 'active' },
			{ projectId: 'sdk', agentId: 'reviewer', classSlug: 'stability', status: 'paused' },
		], [{ projectId: 'sdk', agentId: 'engineer' }, { projectId: 'sdk', agentId: 'reviewer' }, { projectId: 'sdk', agentId: 'tester' }]);
		expect(diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(['agent_class_membership_multiple', 'agent_class_membership_inactive', 'agent_class_membership_missing']));
	});

	it('proves borrowing cannot breach lender minimum or borrower maximum', () => {
		const valid = { workdayId: 'day', borrowerClassSlug: 'features', lenderClassSlug: 'stability', borrowedSeconds: 100, lendingPermitted: true, borrowingPermitted: true, lenderAllocatedSecondsBefore: 500, lenderAllocatedSecondsAfter: 400, lenderMinimumSeconds: 300, borrowerAllocatedSecondsBefore: 500, borrowerAllocatedSecondsAfter: 600, borrowerMaximumSeconds: 700, profileId: 'feature-heavy', profileVersion: '1.0.0', profileDigest: 'sha256:profile' };
		expect(validateWorkdayBorrowingEvidence(valid)).toEqual([]);
		expect(validateWorkdayBorrowingEvidence({ ...valid, lendingPermitted: false, borrowingPermitted: false, lenderAllocatedSecondsAfter: 200, borrowerAllocatedSecondsAfter: 800 }).map((item) => item.code)).toEqual(expect.arrayContaining(['lending_not_permitted', 'borrowing_not_permitted', 'lender_minimum_violated', 'borrower_maximum_violated', 'borrowing_accounting_mismatch']));
	});
});
