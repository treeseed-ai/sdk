import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sdkGoldenSource, sdkGoldenLibraryFiles, verifySdkGoldenProposalReferences, verifySdkGoldenProduct as verifyProduct } from '../../acceptance/golden-product.ts';
import { stringify } from 'yaml';
import { createHash } from 'node:crypto';
import { sdkGoldenExecutionEvents } from '../../acceptance/product/release-output.ts';
import { commit, release, review, proposal, proposalReadback, graphPairFailures, mutateGraphPair, graphOrderFailures, mutateGraphOrder, permissionCases, mutatePermissionRequest } from './acceptance/golden-product-fixture.ts';
const verifySdkGoldenProduct = (items: Parameters<typeof verifyProduct>[0], source: string) =>
	Reflect.apply(verifyProduct, undefined, [items, source, proposalReadback().governance, proposalReadback().original]);
describe('SDK golden product gate (fixtures are not acceptance)', () => {
	it('rejects release receipts without the original paired native command outputs and matching packed archive digest', () => {
		for (const mode of ['missing-events', 'empty-events', 'malformed-event', 'duplicate-event', 'foreign-workday', 'foreign-team',
			'foreign-assignment', 'failed-event', 'foreign-candidate', 'missing-payload', 'missing-records', 'missing-outputs',
			'malformed-output', 'duplicate-output', 'altered-stdout', 'altered-stderr', 'wrong-command-duration', 'duplicate-command',
			'different-archive', 'different-pack-name', 'multiple-pack-names', 'malformed-inspection', 'failed-inspection', 'empty-declarations', 'bad-archive-digest']) {
			const observed = proposalReadback(), participants = structuredClone([release, review]);
			const events = observed.original.executionEvents, event = events[1]!, payload = event.protectedPayload;
			const output = payload.verificationObservations.at(-1)!;
			if (mode === 'missing-events') Reflect.deleteProperty(observed.original, 'executionEvents');
			if (mode === 'empty-events') events.splice(0);
			if (mode === 'malformed-event') Reflect.set(events, 0, null);
			if (mode === 'duplicate-event') events.push(structuredClone(event));
			if (mode === 'foreign-workday') event.runId = 'foreign';
			if (mode === 'foreign-team') event.teamId = 'foreign';
			if (mode === 'foreign-assignment') event.assignmentId = 'foreign';
			if (mode === 'failed-event') event.status = 'failed';
			if (mode === 'foreign-candidate') payload.sourceCommit = 'f'.repeat(40);
			if (mode === 'missing-payload') Reflect.deleteProperty(event, 'protectedPayload');
			if (mode === 'missing-records') payload.verificationRecords.splice(0);
			if (mode === 'missing-outputs') payload.verificationObservations.splice(0);
			if (mode === 'malformed-output') Reflect.set(payload.verificationObservations, 0, null);
			if (mode === 'duplicate-output') payload.verificationObservations.push(structuredClone(output));
			if (mode === 'altered-stdout') output.stdout += 'altered';
			if (mode === 'altered-stderr') output.stderr += 'altered';
			if (mode === 'wrong-command-duration') output.durationSeconds++;
			if (mode === 'duplicate-command') participants[1]!.assignmentResult.verification.push(structuredClone(participants[1]!.assignmentResult.verification[2]!));
			if (['different-archive', 'different-pack-name', 'multiple-pack-names', 'malformed-inspection', 'failed-inspection', 'empty-declarations', 'bad-archive-digest'].includes(mode)) {
				const index = ['different-pack-name', 'multiple-pack-names'].includes(mode) ? 3 : 5, native = payload.verificationObservations[index]!;
				const inspection = JSON.parse(output.stdout) as Record<string, unknown>;
				if (mode === 'different-archive') inspection.archiveDigest = `sha256:${'e'.repeat(64)}`;
				if (mode === 'failed-inspection') inspection.ok = false;
				if (mode === 'empty-declarations') inspection.declarations = 0;
				if (mode === 'bad-archive-digest') inspection.archiveDigest = 'sha256:unmeasured';
				native.stdout = mode === 'different-pack-name' ? 'another.tgz\n' : mode === 'multiple-pack-names' ? 'another.tgz\ntreeseed-sdk-1.0.0.tgz\n'
					: mode === 'malformed-inspection' ? '{truncated' : JSON.stringify(inspection) + '\n';
				native.outputDigest = `sha256:${createHash('sha256').update(JSON.stringify({ stderr: native.stderr, stdout: native.stdout })).digest('hex')}`;
				payload.verificationRecords[index]!.outputDigest = native.outputDigest;
				participants[1]!.assignmentResult.verification[index]!.outputDigest = native.outputDigest;
			}
			const held = structuredClone({ observed, participants });
			expect.soft(() => Reflect.apply(verifyProduct, undefined, [participants, commit, observed.governance, observed.original]), mode)
				.toThrow('ACCEPTANCE_SDK_RELEASE_OUTPUT');
			expect({ observed, participants }).toEqual(held);
		}
	});
	it('reads complete authorized diagnostic pages and rejects malformed duplicate foreign interrupted or cyclic inventories', () => {
		const original = proposalReadback().original.executionEvents, held = structuredClone(original);
		const pages = [{ items: [original[0]], page: { hasMore: true, nextCursor: 'second' } },
			{ items: [original[1]], page: { hasMore: false, nextCursor: null } }];
		const calls: string[][] = [];
		expect(sdkGoldenExecutionEvents(args => { calls.push(args); return pages[calls.length - 1]!; }, 'workday-fixture', 'sdk-team')).toEqual(original);
		expect(calls).toEqual([['workdays', 'events', 'list', 'workday-fixture', '--diagnostics', 'full', '--limit', '50'],
			['workdays', 'events', 'list', 'workday-fixture', '--diagnostics', 'full', '--limit', '50', '--cursor', 'second']]);
		for (const mode of ['missing-page', 'missing-items', 'duplicate', 'foreign-workday', 'foreign-team', 'missing-id', 'missing-cursor', 'cycle', 'interrupted', 'unbounded']) {
			const changed = structuredClone(pages); let index = 0;
			if (mode === 'missing-page') Reflect.deleteProperty(changed[1]!, 'page');
			if (mode === 'missing-items') Reflect.deleteProperty(changed[1]!, 'items');
			if (mode === 'duplicate') changed[1]!.items = [changed[0]!.items[0]];
			if (mode === 'foreign-workday') changed[1]!.items[0]!.runId = 'foreign';
			if (mode === 'foreign-team') changed[1]!.items[0]!.teamId = 'foreign';
			if (mode === 'missing-id') Reflect.deleteProperty(changed[1]!.items[0]!, 'id');
			if (mode === 'missing-cursor') changed[0]!.page.nextCursor = null;
			if (mode === 'cycle') { changed[1]!.page.hasMore = true; changed[1]!.page.nextCursor = 'second'; }
			const before = structuredClone(changed);
			expect.soft(() => sdkGoldenExecutionEvents(() => {
				if (mode === 'interrupted' && index === 1) throw new Error('native transport interrupted');
				if (mode === 'unbounded') return { items: [], page: { hasMore: true, nextCursor: `page-${index++}` } };
				return changed[index++]!;
			}, 'workday-fixture', 'sdk-team'), mode).toThrow();
			expect(changed).toEqual(before);
		}
		expect(original).toEqual(held);
	});
	it('rejects missing extra duplicate and alternate permission requests for every fixed authored SDK role without repairing original bytes', () => {
		const exact = proposalReadback(), inspect = (value: typeof exact) => Reflect.apply(verifyProduct, undefined, [[release, review], commit, value.governance, value.original]);
		expect(() => inspect(exact)).not.toThrow();
		const substituted = structuredClone(exact); substituted.original.graph.nodes[0]!.requestedPermissions.tools = [];
		const heldGraph = structuredClone(substituted);
		expect.soft(() => inspect(substituted)).toThrow('ACCEPTANCE_SDK_GRAPH_PAIRS'); expect(substituted).toEqual(heldGraph);
		const permuted = structuredClone(proposal);
		for (const item of permuted.executionPlan.workItems) { item.requestedPermissions.content.read.reverse(); item.requestedPermissions.content.write.reverse(); item.requestedPermissions.tools.reverse(); }
		const reordered = proposalReadback(permuted), actor = structuredClone(release), reviewer = structuredClone(review);
		for (const item of permuted.executionPlan.workItems) {
			reordered.original.initialProposal.executionPlan.workItems.find(value => value.id === item.id)!.requestedPermissions = structuredClone(item.requestedPermissions);
			reordered.original.graph.nodes.find(value => value.workItemId === item.id && value.pairRole === 'actor')!.requestedPermissions = structuredClone(item.requestedPermissions);
		}
		for (const item of [actor, reviewer]) item.assignmentAttempt.sourceRef.digest = `sha256:${reordered.governance.activeContentHash}`;
		const heldPermutation = structuredClone({ reordered, actor, reviewer });
		expect(() => Reflect.apply(verifyProduct, undefined, [[actor, reviewer], commit, reordered.governance, reordered.original])).not.toThrow();
		expect({ reordered, actor, reviewer }).toEqual(heldPermutation);
		for (const mode of permissionCases) {
			const changed = structuredClone(proposal); mutatePermissionRequest(changed, mode);
			const observed = proposalReadback(changed), held = structuredClone(observed);
			expect.soft(() => inspect(observed), mode).toThrow('ACCEPTANCE_SDK_PERMISSIONS'); expect(observed).toEqual(held);
		}
		expect(() => inspect(exact)).not.toThrow();
	});
	it('rejects counted graph pairs without independent research and exact immediate governed profile ordering', () => {
		const observed = proposalReadback();
		const inspect = (value: typeof observed) => Reflect.apply(verifyProduct, undefined, [[release, review], commit, value.governance, value.original]);
		expect(() => inspect(observed)).not.toThrow();
		const independent = structuredClone(observed), edge = independent.original.graph.edges[0]!;
		independent.original.graph.edges.push({ ...edge, id: 'unrelated-edge', fromNodeId: 'other-actor', toNodeId: 'other-reviewer' },
			{ ...edge, id: 'governance-edge', fromNodeId: 'accepted-condition', toNodeId: 'actor-research-context', provenance: 'governance' },
			{ ...edge, id: 'event-edge', fromNodeId: 'question-condition', toNodeId: 'actor-research-context', provenance: 'profile-event' });
		const heldIndependent = structuredClone(independent);
		expect(() => inspect(independent)).not.toThrow(); expect(independent).toEqual(heldIndependent);
		for (const mode of graphOrderFailures) {
			const changed = structuredClone(observed); mutateGraphOrder(changed.original.graph, mode);
			const held = structuredClone(changed);
			expect.soft(() => inspect(changed), mode).toThrow('ACCEPTANCE_SDK_GRAPH_ORDER'); expect(changed).toEqual(held);
		}
		expect(() => inspect(observed)).not.toThrow();
	});
	it('rejects six counted Actor Reviewer pairs that do not represent their exact authored proposal work', () => {
		const observed = proposalReadback();
		const inspect = (value: typeof observed) => Reflect.apply(verifyProduct, undefined, [[release, review], commit, value.governance, value.original]);
		expect(() => inspect(observed)).not.toThrow();
		const unrelated = structuredClone(observed);
		unrelated.original.graph.nodes.push({ ...structuredClone(unrelated.original.graph.nodes[0]!), id: 'unrelated-retained-actor', workdayId: 'another-workday' });
		const retainedUnrelated = structuredClone(unrelated);
		expect(() => inspect(unrelated)).not.toThrow(); expect(unrelated).toEqual(retainedUnrelated);
		for (const mode of graphPairFailures) {
			const changed = structuredClone(observed); mutateGraphPair(changed.original.graph, mode);
			const retained = structuredClone(changed);
			expect.soft(() => inspect(changed), mode).toThrow('ACCEPTANCE_SDK_GRAPH_PAIRS');
			expect(changed).toEqual(retained);
		}
		const changed = structuredClone(observed);
		changed.original.graph.nodes[1]!.workItemId = 'unrelated-authored-work';
		const retained = structuredClone(changed);
		expect(() => inspect(changed)).toThrow('ACCEPTANCE_SDK_GRAPH_PAIRS');
		expect(changed).toEqual(retained);
		expect(() => inspect(observed)).not.toThrow();
	});
	it('rejects a coherently rehashed closed discussion that names another proposal repository or path', () => {
		for (const [field, value] of [['repository', 'repo_foreign'], ['path', 'proposals/foreign.mdx']]) {
			const input = structuredClone(proposal), original = proposalReadback().original, file = original.referenceFiles[2]!.files[0]!;
			Reflect.set(file.frontmatter.subjectRef, field!, value); file.content = `---\n${stringify(file.frontmatter)}---\n`;
			input.discussionRef.digest = `sha256:${createHash('sha256').update(file.content).digest('hex')}`;
			const retained = structuredClone({ input, original });
			expect.soft(() => verifySdkGoldenProposalReferences(input, original, release.assignmentAttempt)).toThrow('ACCEPTANCE_SDK_POPULATED_PROPOSAL');
			expect({ input, original }).toEqual(retained);
		}
	});
	it('consumes the supported CLI library read result envelope and rejects raw SDK reply fallback', () => {
		const result = { ok: true, repoId: 'repo_sdk_fixture', resolvedRef: commit, files: [] };
		const observed = { result, receipt: { operation: 'read' } }, held = structuredClone(observed);
		expect(sdkGoldenLibraryFiles(observed)).toEqual(result); expect(observed).toEqual(held);
		for (const invalid of [null, undefined, [], {}, { data: result }, result, { result: null }, { result: { ...result, ok: false } }])
			expect.soft(() => sdkGoldenLibraryFiles(invalid as Record<string, unknown>)).toThrow('ACCEPTANCE_SDK_LIBRARY_READ');
	});
	it('rejects coherently issued proposals lacking the populated golden proposal contract without repairing observations', () => {
		for (const patch of [{ status: 'draft' }, { status: 'discussing' }, { objectiveRefs: undefined }, { discussionRef: undefined }]) {
			const observed = proposalReadback({ ...proposal, ...patch }), actors = structuredClone([release, review]);
			for (const actor of actors) actor.assignmentAttempt.sourceRef.digest = `sha256:${observed.governance.activeContentHash}`;
			const retained = structuredClone({ observed, actors });
			expect.soft(() => Reflect.apply(verifyProduct, undefined, [actors, commit, observed.governance, observed.original]))
				.toThrow('ACCEPTANCE_SDK_POPULATED_PROPOSAL');
			expect({ observed, actors }).toEqual(retained);
		}
	});
	it('requires independently read frozen project and team objectives and the exact closed proposal discussion', () => {
		const observed = proposalReadback(), held = structuredClone(observed);
		const inspect = (value: typeof observed) => Reflect.apply(verifyProduct, undefined, [[release, review], commit, value.governance, value.original]);
		expect(() => inspect(observed)).not.toThrow();
		for (const mutate of [
			(value: typeof observed) => { value.original.referenceFiles = []; },
			(value: typeof observed) => { value.original.referenceFiles.push(value.original.referenceFiles[0]!); },
			(value: typeof observed) => { value.original.referenceFiles[1] = value.original.referenceFiles[0]!; },
			(value: typeof observed) => { value.original.teamLibrary.project.teamId = 'foreign'; },
			(value: typeof observed) => { value.original.teamLibrary.project.slug = 'foreign'; },
			(value: typeof observed) => { value.original.teamLibrary.library.repositoryId = 'repo_foreign'; },
			(value: typeof observed) => { value.original.teamLibrary.library.projectId = 'foreign'; },
			(value: typeof observed) => { value.original.initialProposal.objectiveRefs = []; },
			...(Array.from({ length: 3 }, (_, index) => [
				(value: typeof observed) => { value.original.referenceFiles[index]!.resolvedRef = 'd'.repeat(40); },
				(value: typeof observed) => { value.original.referenceFiles[index]!.repoId = 'repo_foreign'; },
				(value: typeof observed) => { value.original.referenceFiles[index]!.files[0]!.content += 'changed'; },
				(value: typeof observed) => { value.original.referenceFiles[index]!.files[0]!.path = 'foreign.mdx'; },
				(value: typeof observed) => { value.original.referenceFiles[index]!.files[0]!.frontmatter = {}; },
			]).flat()),
		]) {
			const changed = structuredClone(observed); mutate(changed); const retained = structuredClone(changed);
			expect.soft(() => inspect(changed)).toThrow('ACCEPTANCE_SDK_POPULATED_PROPOSAL'); expect(changed).toEqual(retained);
		}
		expect(() => inspect(observed)).not.toThrow(); expect(observed).toEqual(held);
	});
	it('requires exact stored SDK proposal title summary and frozen identity without changing missing malformed or foreign observations', () => {
		const check = (value: unknown) => { const observed = proposalReadback(value);
			return Reflect.apply(verifyProduct, undefined, [[release, review], commit, observed.governance, observed.original]); };
		expect(() => check(proposal)).not.toThrow();
		for (const field of ['title', 'summary', 'evidenceRefs', 'objective', 'contextRefs', 'acceptanceCriteria']) {
			const changed = proposalReadback();
			if (field === 'evidenceRefs') changed.original.initialProposal.evidenceRefs[0]!.id = 'another-original-evidence';
			else if (field === 'contextRefs') changed.original.initialProposal.executionPlan.workItems[0]!.contextRefs[0]!.commit = 'd'.repeat(40);
			else if (field === 'acceptanceCriteria') changed.original.initialProposal.executionPlan.workItems[0]!.acceptanceCriteria = ['Different fixed criterion.'];
			else if (field === 'objective') changed.original.initialProposal.executionPlan.workItems[0]!.objective = 'Different fixed objective.';
			else Reflect.set(changed.original.initialProposal, field, 'Different fixed objective.');
			const retained = structuredClone(changed);
			expect(() => Reflect.apply(verifyProduct, undefined, [[release, review], commit, changed.governance, changed.original]))
				.toThrow('ACCEPTANCE_SDK_FROZEN_REQUEST');
			expect(changed).toEqual(retained);
		}
		const changedRequest = proposalReadback({ ...proposal, request: 'Publish the legacy capacity plan and deploy it upstream.' });
		Reflect.set(changedRequest.original, 'initialProposal', structuredClone(proposal));
		const changedActors = structuredClone([release, review]);
		for (const item of changedActors) item.assignmentAttempt.sourceRef.digest = `sha256:${changedRequest.governance.activeContentHash}`;
		const retainedRequest = structuredClone(changedRequest);
		expect(() => Reflect.apply(verifyProduct, undefined, [changedActors, commit, changedRequest.governance, changedRequest.original]))
			.toThrow('ACCEPTANCE_SDK_FROZEN_REQUEST');
		expect(changedRequest).toEqual(retainedRequest);
		// A coherent issued digest must not make an unexpanded WorkItem valid.
		const shorthand = structuredClone(proposal); Reflect.deleteProperty(shorthand.executionPlan.workItems[0]!, 'objective');
		const incomplete = proposalReadback(shorthand), issued = structuredClone(release);
		issued.assignmentAttempt.sourceRef.digest = `sha256:${incomplete.governance.activeContentHash}`;
		expect(() => Reflect.apply(verifyProduct, undefined, [[issued, review], commit, incomplete.governance, incomplete.original]))
			.toThrow('ACCEPTANCE_SDK_GRAPH');
		const observed = proposalReadback();
		const anchored = proposalReadback(proposal, 0, true), anchorActor = structuredClone(release), anchorReview = structuredClone(review);
		for (const item of [anchorActor, anchorReview]) item.assignmentAttempt.sourceRef.digest = `sha256:${anchored.governance.activeContentHash}`;
		const retainedAnchor = structuredClone(anchored);
		expect(() => Reflect.apply(verifyProduct, undefined, [[anchorActor, anchorReview], commit, anchored.governance, anchored.original]))
			.toThrow('ACCEPTANCE_SDK_PROPOSAL'); expect(anchored).toEqual(retainedAnchor);
		const aliased = proposalReadback(proposal, 0, 'alias'), aliasActor = structuredClone(release), aliasReview = structuredClone(review);
		for (const item of [aliasActor, aliasReview]) item.assignmentAttempt.sourceRef.digest = `sha256:${aliased.governance.activeContentHash}`;
		const retainedAlias = structuredClone(aliased);
		expect(() => Reflect.apply(verifyProduct, undefined, [[aliasActor, aliasReview], commit, aliased.governance, aliased.original]))
			.toThrow(); expect(aliased).toEqual(retainedAlias);
		for (const bytes of [1_048_576, 1_048_577]) {
			const bounded = proposalReadback(proposal, bytes), actor = structuredClone(release), reviewer = structuredClone(review);
			for (const item of [actor, reviewer]) item.assignmentAttempt.sourceRef.digest = `sha256:${bounded.governance.activeContentHash}`;
			expect(Buffer.byteLength(bounded.original.files.files[0]!.content)).toBe(bytes);
			const checkBoundary = () => Reflect.apply(verifyProduct, undefined, [[actor, reviewer], commit, bounded.governance, bounded.original]);
			if (bytes === 1_048_576) expect(checkBoundary).not.toThrow(); else expect(checkBoundary).toThrow('ACCEPTANCE_SDK_PROPOSAL');
		}
		for (const field of ['revision', 'digest', 'repository', 'commit', 'path']) for (const value of [undefined, null, '', 'foreign', 2]) {
			const changed = structuredClone(release); Reflect.set(changed.assignmentAttempt.sourceRef, field, value);
			expect.soft(() => Reflect.apply(verifyProduct, undefined, [[changed, review], commit, observed.governance, observed.original]))
				.toThrow('ACCEPTANCE_SDK_PROPOSAL');
		}
		const originalCheck = (value: typeof observed) => Reflect.apply(verifyProduct, undefined,
			[[release, review], commit, value.governance, value.original]);
		for (const field of ['repositoryId', 'commitSha', 'contentPath', 'digest']) for (const value of [undefined, null, '', ' ', 'staging', [], {}, false, 1,
			'proposals/../secret', 'proposals/a\0.mdx', 'proposals\\a.mdx', 'proposals/a\n']) {
			const changed = structuredClone(observed); Reflect.set(changed.governance.metadata.contentProvenance, field, value);
			expect.soft(() => originalCheck(changed)).toThrow('ACCEPTANCE_SDK_PROPOSAL');
		}
		for (const mutate of [
			(value: typeof observed) => { value.original.binding.repositoryId = 'repo_foreign'; },
			(value: typeof observed) => { value.original.files.repoId = 'repo_foreign'; },
			(value: typeof observed) => { value.original.files.resolvedRef = 'd'.repeat(40); },
			(value: typeof observed) => { value.original.files.files[0]!.path = 'proposals/foreign.mdx'; },
			(value: typeof observed) => { value.original.files.files[0]!.content += 'changed'; },
			(value: typeof observed) => { value.original.files.files[0]!.frontmatter = {}; },
			(value: typeof observed) => { value.original.files.files = []; },
			(value: typeof observed) => { value.original.files.files.push(value.original.files.files[0]!); },
			(value: typeof observed) => { value.governance.activeContentHash = 'd'.repeat(64); },
			(value: typeof observed) => { value.governance.activeVersion = 0; },
			(value: typeof observed) => { value.governance.body = 'changed'; },
		]) {
			const changed = structuredClone(observed); mutate(changed); const held = structuredClone(changed);
			expect.soft(() => originalCheck(changed)).toThrow('ACCEPTANCE_SDK_PROPOSAL'); expect(changed).toEqual(held);
		}
		const invalid: unknown[] = [undefined, null, [], '', {}, { ...proposal, id: 'foreign' }, { ...proposal, projectId: 'foreign' }];
		for (const field of ['title', 'summary']) {
			for (const value of [undefined, null, false, 1, [], {}, '', ' ', ` ${proposal[field as 'title' | 'summary']}`, `${proposal[field as 'title' | 'summary']} `, 'Changed objective'])
				invalid.push({ ...proposal, [field]: value });
		}
		const source = proposal.evidenceRefs[0]!;
		for (const evidenceRefs of [undefined, null, false, 1, '', {}, [], [null], [[]], [{}],
			[{ ...source, url: 'https://github.com/treeseed-ai/sdk/issues/300' }],
			[{ ...source, url: `${source.url}#issuecomment-1` }], [{ ...source, url: ` ${source.url}` }],
			[{ ...source, store: 'git' }], [{ ...source, model: 'note' }], [{ ...source, id: '' }],
			[{ ...source, id: ' ' }], [{ ...source, callerAuthority: true }],
			[source, structuredClone(source)], [source, { ...source, id: 'another-source' }]])
			invalid.push({ ...proposal, evidenceRefs });
		for (const value of invalid) {
			const held = structuredClone(value);
			expect.soft(() => check(value)).toThrow('ACCEPTANCE_SDK_PROPOSAL'); expect(value).toEqual(held);
		}
		for (const executionPlan of [undefined, null, false, '', [], {}, { workItems: null }, { workItems: [] },
			{ workItems: [...proposal.executionPlan.workItems, proposal.executionPlan.workItems[0]] },
			{ workItems: proposal.executionPlan.workItems.slice(1) }])
			expect.soft(() => check({ ...proposal, executionPlan })).toThrow('ACCEPTANCE_SDK_GRAPH');
		for (const [index, row] of proposal.executionPlan.workItems.entries()) {
			for (const field of ['objective', 'estimate', 'reviewEstimate', 'contextRefs', 'requestedPermissions', 'requiredCapabilities', 'acceptanceCriteria']) {
				for (const value of [undefined, null, false, 1, field === 'objective' ? '' : 'See docs/agent-acceptance.md for configuration']) {
					const changed = structuredClone(proposal); Reflect.set(changed.executionPlan.workItems[index]!, field, value);
					const observed = proposalReadback(changed), actor = structuredClone(release), reviewer = structuredClone(review);
					for (const issued of [actor, reviewer]) issued.assignmentAttempt.sourceRef.digest = `sha256:${observed.governance.activeContentHash}`;
					const held = structuredClone(observed);
					expect.soft(() => Reflect.apply(verifyProduct, undefined, [[actor, reviewer], commit, observed.governance, observed.original]))
						.toThrow('ACCEPTANCE_SDK_GRAPH'); expect(observed).toEqual(held);
				}
			}
			const patches = [{ id: undefined }, { id: '' }, { id: `review-${row.id}` }, { id: proposal.executionPlan.workItems[(index + 1) % 6]!.id },
				{ agentClass: undefined }, { agentClass: '' }, { agentClass: 'reviewer' }, { agentClass: ` ${row.agentClass}` },
				{ workspace: undefined }, { workspace: {} }, { workspace: row.workspace === 'git' ? 'treedx' : 'git' },
				{ dependsOn: undefined }, { dependsOn: null }, { dependsOn: {} }, { dependsOn: ['tests-first'] },
				{ maximumReviewCycles: undefined }, { maximumReviewCycles: '2' }, { maximumReviewCycles: 1 }, { maximumReviewCycles: 3 },
				{ activity: 'reviewing' }, { activity: undefined }, { review: 'optional' }, { review: undefined }];
			for (const patch of patches) {
				const changed = structuredClone(proposal); Object.assign(changed.executionPlan.workItems[index]!, patch);
				const held = structuredClone(changed);
				expect.soft(() => check(changed)).toThrow('ACCEPTANCE_SDK_GRAPH'); expect(changed).toEqual(held);
			}
			for (const value of [null, false, '', [], {}]) {
				const changed = structuredClone(proposal); Reflect.set(changed.executionPlan.workItems, index, value);
				expect.soft(() => check(changed)).toThrow('ACCEPTANCE_SDK_GRAPH');
			}
		}
		const permuted = structuredClone(proposal); permuted.executionPlan.workItems.reverse();
		const reordered = proposalReadback(permuted), reorderedActor = structuredClone(release);
		reorderedActor.assignmentAttempt.sourceRef.digest = `sha256:${reordered.governance.activeContentHash}`;
		expect(() => Reflect.apply(verifyProduct, undefined, [[reorderedActor, review], commit, reordered.governance, reordered.original])).not.toThrow();
		expect(() => check(proposal)).not.toThrow();
	});

	it('requires independent measured replay of all three public release commands and rejects every invalid reviewer receipt', () => {
		const before = structuredClone([release, review]);
		expect(() => verifySdkGoldenProduct([release, review], commit)).not.toThrow();
		for (const command of ['npm run release:verify', 'npm pack', 'npm run standards:acceptance -- --archive treeseed-sdk-1.0.0.tgz']) {
			const missing = structuredClone(review);
			missing.assignmentResult.verification = missing.assignmentResult.verification.filter(item => item.command !== command);
			expect(() => verifySdkGoldenProduct([release, missing], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
			for (const patch of [{ command: `echo ${command}` }, { command: `${command} && true` }, { status: 'failed' }, { status: 'skipped' },
				{ exitCode: 1 }, { exitCode: '0' }, { outputDigest: '' }, { outputDigest: `sha256:${'G'.repeat(64)}` },
				{ durationSeconds: undefined }, { durationSeconds: null }, { durationSeconds: '1' }, { durationSeconds: -1 }, { durationSeconds: 1.5 },
				{ durationSeconds: Number.NaN }, { durationSeconds: Number.POSITIVE_INFINITY }, { durationSeconds: Number.NEGATIVE_INFINITY }]) {
				const invalid = structuredClone(review);
				Object.assign(invalid.assignmentResult.verification.find(item => item.command === command)!, patch);
				const invalidBefore = structuredClone(invalid);
				expect(() => verifySdkGoldenProduct([release, invalid], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
				expect(invalid).toEqual(invalidBefore);
			}
		}
		expect([release, review]).toEqual(before);
	});
	it('binds independent release review to the exact actor result candidate repository and predecessor without rewriting history', () => {
		const before = structuredClone([release, review]);
		expect(() => verifySdkGoldenProduct([release, review], commit)).not.toThrow();
		for (const patch of [{ contextRefs: [] }, { contextRefs: [{ ...review.assignmentAttempt.contextRefs[0]!, commit: 'c'.repeat(40) }] },
			{ contextRefs: [{ ...review.assignmentAttempt.contextRefs[0]!, repository: 'other/sdk' }] },
			{ predecessorResultIds: [] }, { predecessorResultIds: ['foreign-result'] }, { predecessorResultIds: ['release-result', 'release-result'] },
			{ id: release.assignmentAttempt.id }, { workdayId: 'workday-foreign' }, { projectId: 'foreign-project' }, { agentClass: release.assignmentAttempt.agentClass }]) {
			const invalid = structuredClone(review); Object.assign(invalid.assignmentAttempt, patch);
			const invalidBefore = structuredClone(invalid);
			expect(() => verifySdkGoldenProduct([release, invalid], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
			expect(invalid).toEqual(invalidBefore);
		}
		for (const repository of ['other/sdk', '', undefined]) {
			const invalid = structuredClone(release); Object.assign(invalid.assignmentResult.references[0]!, { repository });
			const invalidBefore = structuredClone(invalid);
			expect(() => verifySdkGoldenProduct([invalid, review], commit)).toThrow('ACCEPTANCE_SDK_CANDIDATE');
			expect(invalid).toEqual(invalidBefore);
		}
		expect([release, review]).toEqual(before);
	});
	it('keeps standards generation and the full contract suite owned by release verification', () => {
		const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
		const verifier = readFileSync(new URL('../../../scripts/packages/release-verify.ts', import.meta.url), 'utf8');
		expect(manifest.scripts['release:verify']).toContain('./scripts/packages/release-verify.ts');
		expect(manifest.scripts.lint).toBe('npm run build:dist');
		expect(manifest.scripts.build).toBe('npm run build:dist');
		expect(manifest.scripts['test:release']).toBe('npm run test:contracts');
		expect(manifest.scripts['test:contracts']).toBe('vitest run --config ./vitest.contracts.config.ts');
		const build = verifier.indexOf("run('npm', ['run', 'lint']);");
		const generation = verifier.indexOf("run('npm', ['run', 'standards:build']);");
		const acceptance = verifier.indexOf("run('npm', ['run', 'standards:acceptance']);");
		const suite = verifier.indexOf("run('npm', ['run', 'test:release']);");
		expect(build).toBeGreaterThan(-1); expect(generation).toBeGreaterThan(build); expect(acceptance).toBeGreaterThan(generation); expect(suite).toBeGreaterThan(acceptance);
		expect(verifier).toContain('if (result.status !== 0)');
		expect(verifier).toContain('process.exit(result.status ?? 1)');
	});
	it('uses the exact current campaign source and rejects missing moving or unrelated freeze authority', () => {
		expect(sdkGoldenSource({ sourceHeads: { sdk: commit }, proposal: { id: 'proposal' } }, ['proposal'])).toBe(commit);
		for (const source of ['', 'staging', undefined]) expect(() => sdkGoldenSource({ sourceHeads: { sdk: source }, proposal: { id: 'proposal' } }, ['proposal']))
			.toThrow('ACCEPTANCE_SDK_FREEZE');
		expect(() => sdkGoldenSource({ sourceHeads: { sdk: commit }, proposal: { id: 'other' } }, ['proposal'])).toThrow('ACCEPTANCE_SDK_FREEZE');
	});
	it('rejects narrative archive inspection without a measured standalone archive command', () => {
		const missing = structuredClone(release); missing.assignmentResult.verification.pop();
		expect(() => verifySdkGoldenProduct([missing, review], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
		const missingReview = structuredClone(review); missingReview.assignmentResult.verification.pop();
		expect(() => verifySdkGoldenProduct([release, missingReview], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
	});
	it('accepts measured passing command evidence and rejects a missing full release gate', () => {
		const pipeline = structuredClone(release);
		pipeline.assignmentResult.verification = pipeline.assignmentResult.verification.filter(item => !['npm run build', 'npm run standards:build', 'npm run test:contracts'].includes(item.command));
		expect(() => verifySdkGoldenProduct([pipeline, review], commit)).not.toThrow();
		const missing = structuredClone(release); missing.assignmentResult.verification.splice(2, 1);
		expect(() => verifySdkGoldenProduct([missing], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
		for (const command of ['echo npm run release:verify', 'npm run release:verify && true']) {
			const disguised = structuredClone(release); disguised.assignmentResult.verification[2]!.command = command;
			expect(() => verifySdkGoldenProduct([disguised, review], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
		}
	});
	it('accepts measured current-directory archives and rejects unsafe paths and invalid evidence', () => {
		for (const prefix of ['', './']) {
			const actor = structuredClone(release), reviewer = structuredClone(review);
			for (const item of [actor, reviewer]) item.assignmentResult.verification.at(-1)!.command = `npm run standards:acceptance -- --archive ${prefix}treeseed-sdk-1.0.0.tgz`;
			const observed = proposalReadback();
			for (const event of observed.original.executionEvents) {
				event.protectedPayload.verificationRecords.at(-1)!.command = actor.assignmentResult.verification.at(-1)!.command;
				event.protectedPayload.verificationObservations.at(-1)!.command = actor.assignmentResult.verification.at(-1)!.command;
			}
			expect(() => Reflect.apply(verifyProduct, undefined, [[actor, reviewer], commit, observed.governance, observed.original])).not.toThrow();
		}
		for (const path of ['../package.tgz', '/tmp/package.tgz', 'scratch/package.tgz', './scratch/package.tgz', './package.tgz && true']) {
			const actor = structuredClone(release); actor.assignmentResult.verification.at(-1)!.command = `npm run standards:acceptance -- --archive ${path}`;
			expect(() => verifySdkGoldenProduct([actor, review], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
			const reviewer = structuredClone(review); reviewer.assignmentResult.verification.at(-1)!.command = actor.assignmentResult.verification.at(-1)!.command;
			expect(() => verifySdkGoldenProduct([release, reviewer], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
		}
		for (const patch of [{ exitCode: 1 }, { status: 'failed' }, { outputDigest: '' }, { durationSeconds: -1 }]) {
			const actor = structuredClone(release); Object.assign(actor.assignmentResult.verification.at(-1)!, patch);
			expect(() => verifySdkGoldenProduct([actor, review], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
			const reviewer = structuredClone(review); Object.assign(reviewer.assignmentResult.verification.at(-1)!, patch);
			expect(() => verifySdkGoldenProduct([release, reviewer], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
		}
		const unapproved = structuredClone(review); unapproved.lifecycleOutput.activityCompletion.reviewDisposition = 'request_changes';
		expect(() => verifySdkGoldenProduct([release, unapproved], commit)).toThrow('ACCEPTANCE_SDK_ARCHIVE_REVIEW');
	});
	it('rejects failed commands fabricated candidate and moving source', () => {
		const failed = structuredClone(release); failed.assignmentResult.verification[2]!.exitCode = 1;
		expect(() => verifySdkGoldenProduct([failed], commit)).toThrow('ACCEPTANCE_SDK_RELEASE_GATE');
		const candidate = structuredClone(release); candidate.assignmentResult.references[0]!.commit = 'staging';
		expect(() => verifySdkGoldenProduct([candidate, review], commit)).toThrow('ACCEPTANCE_SDK_CANDIDATE');
		expect(() => verifySdkGoldenProduct([release, review, { status: 'completed', assignmentAttempt: { workItemId: 'tests-first', effectiveProfile: { activity: 'acting' }, contextRefs: [] } }], commit)).toThrow('ACCEPTANCE_SDK_SOURCE');
	});
});

it('ships golden acceptance using only the public assignment contract and declared package identity',()=>{
 const candidate=new URL('../../../',import.meta.url);
 const manifest=JSON.parse(readFileSync(new URL('package.json',candidate),'utf8'));
 const asset=readFileSync(new URL('tests/acceptance/golden-product.test.ts',candidate),'utf8');
 expect(manifest.files).toContain('treeseed.package.yaml');
 expect(manifest.files).toContain('!dist/.treeseed-build-complete.json');
 expect(manifest.files).toContain('!dist/.treeseed-build-complete.json.new');
 expect(asset).toContain("from '@treeseed/sdk/agent-capacity'");
 expect(asset).not.toMatch(/from ['"].*src\//u);
});
