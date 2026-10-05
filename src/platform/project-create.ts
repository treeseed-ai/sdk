import { createHash } from 'node:crypto';
import { projectCreatePlanSchema, projectCreateReceiptSchema, type ProjectCreatePlan, type ProjectCreateReceipt } from './contracts.ts';

export type ProjectCreateStep = 'project' | 'repository' | 'template' | 'library' | 'inventory';
export type ProjectCreateState = 'missing' | 'ready' | 'conflict';

export interface ProjectCreateTarget {
	slug: string;
	template: { id: string; version: string; digest: string };
	team: string;
	repository: { owner: string; name: string; visibility: 'public' | 'private' };
}

export interface ProjectCreateObservation {
	project: { state: ProjectCreateState; id?: string };
	repository: { state: ProjectCreateState; url?: string };
	template: { state: ProjectCreateState; digest?: string };
	library: { state: ProjectCreateState; bindingId?: string };
	inventory: { state: ProjectCreateState; version?: number };
}

export interface ProjectCreateAuthority {
	observe(target: ProjectCreateTarget): Promise<ProjectCreateObservation>;
	reconcileProject(target: ProjectCreateTarget): Promise<void>;
	reconcileRepository(target: ProjectCreateTarget): Promise<void>;
	applyTemplate(target: ProjectCreateTarget): Promise<void>;
	reconcileLibrary(target: ProjectCreateTarget): Promise<void>;
	publishInventory(target: ProjectCreateTarget): Promise<void>;
}

const steps: readonly ProjectCreateStep[] = ['project', 'repository', 'template', 'library', 'inventory'];
const actionFor = {
	project: 'create', repository: 'adopt', template: 'apply', library: 'bind', inventory: 'publish',
} as const;

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
	return JSON.stringify(value);
}

function digest(value: unknown) {
	return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function blockers(observation: ProjectCreateObservation) {
	return steps.filter((step) => observation[step].state === 'conflict').map((step) => `${step}_conflicts_with_requested_target`);
}

export async function planPlatformProjectCreate(target: ProjectCreateTarget, authority: Pick<ProjectCreateAuthority, 'observe'>): Promise<ProjectCreatePlan> {
	const observation = await authority.observe(target);
	const conflicts = blockers(observation);
	const base = {
		schemaVersion: 'treeseed.platform-project-create-plan/v1' as const, ...target, steps: [...steps],
		actions: steps.map((step) => ({ step, action: observation[step].state === 'ready' ? 'noop' as const : observation[step].state === 'conflict' ? 'blocked' as const : actionFor[step] })),
		observationDigest: digest(observation), ok: conflicts.length === 0, blockers: conflicts,
	};
	return projectCreatePlanSchema.parse({ ...base, planDigest: digest(base) });
}

function requireReady(observation: ProjectCreateObservation) {
	const incomplete = steps.filter((step) => observation[step].state !== 'ready');
	if (incomplete.length) throw new Error(`Project creation postconditions are incomplete: ${incomplete.join(', ')}.`);
	if (!observation.project.id || !observation.repository.url || !observation.library.bindingId || !observation.inventory.version) {
		throw new Error('Project creation authority returned incomplete receipt identities.');
	}
}

export async function applyPlatformProjectCreate(plan: ProjectCreatePlan, authority: ProjectCreateAuthority): Promise<ProjectCreateReceipt> {
	const accepted = projectCreatePlanSchema.parse(plan);
	const { planDigest: _planDigest, ...unsigned } = accepted;
	if (digest(unsigned) !== accepted.planDigest) throw new Error('Project creation plan digest does not match its frozen inputs.');
	if (!accepted.ok || accepted.blockers.length) throw new Error('Blocked project creation plans cannot be applied.');
	const target = { slug: accepted.slug, template: accepted.template, team: accepted.team, repository: accepted.repository };
	const current = await authority.observe(target);
	if (digest(current) !== accepted.observationDigest) throw new Error('Project creation authority changed after planning; create a new plan.');
	const operations = {
		project: authority.reconcileProject, repository: authority.reconcileRepository, template: authority.applyTemplate,
		library: authority.reconcileLibrary, inventory: authority.publishInventory,
	};
	for (const item of accepted.actions) if (item.action !== 'noop') await operations[item.step].call(authority, target);
	const final = await authority.observe(target);
	requireReady(final);
	return projectCreateReceiptSchema.parse({
		schemaVersion: 'treeseed.platform-project-create-receipt/v1', planDigest: accepted.planDigest, ...target,
		projectId: final.project.id, repositoryUrl: final.repository.url, libraryBindingId: final.library.bindingId,
		inventoryVersion: final.inventory.version, actions: accepted.actions,
	});
}
