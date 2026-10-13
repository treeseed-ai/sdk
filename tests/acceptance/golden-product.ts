import assert from 'node:assert/strict';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { exactEntityReferenceSchema, executionEdgeSchema, activityProfileSchema } from '@treeseed/sdk/agent-capacity';
import { validatePortableContentData } from '@treeseed/sdk/content-validation';
import { createHash } from 'node:crypto';
import { parse, parseDocument, visit } from 'yaml';
import { TREESEED_COMMAND_TREE_V1, type CommandLeafDescriptor } from '@treeseed/sdk/operator-contracts';
import { isSdkArchiveCommand, sdkReleaseCommands, verifySdkReleaseOutputs } from './product/release-output.ts';

type Row = Record<string, any>;
export function sdkGoldenReadArguments(args: readonly string[], team: string): string[] {
	let nodes = TREESEED_COMMAND_TREE_V1.commands, selected: CommandLeafDescriptor | undefined;
	for (const segment of args) {
		const node = nodes.find(value => value.segment === segment);
		assert.ok(node, 'ACCEPTANCE_SDK_READ: Supported public read command required');
		if (node.nodeType === 'leaf') { selected = node; break; }
		nodes = node.children;
	}
	assert.ok(selected?.kind === 'read', 'ACCEPTANCE_SDK_READ: Supported public read command required');
	const operation = selected.execution.kind === 'operation' ? selected.execution : undefined;
	const scopedTeam = operation?.input.some(input => input.source === 'context' && input.name === 'team');
	assert.ok(!scopedTeam || (typeof team === 'string' && team.trim()), 'ACCEPTANCE_SDK_READ: Exact team required');
	assert.ok(!args.some(value => ['--server', '--team', '--json'].includes(value)),
		'ACCEPTANCE_SDK_READ: Scope selectors must be supplied once by the owning reader');
	return [...args, ...(operation ? ['--server', 'local'] : []), ...(scopedTeam ? ['--team', team] : []), '--json'];
}
export type SdkGoldenOriginal = { binding: Row; files: Row; initialProposal: Row; teamLibrary?: Row; referenceFiles?: Row[]; graph?: Row; executionEvents?: Row[] };
/** The selected scene consumes the existing CLI library-read result. */
export function sdkGoldenLibraryFiles(readback: Row): Row {
	const result = readback && typeof readback === 'object' && !Array.isArray(readback) ? readback.result : undefined;
	assert.ok(result && typeof result === 'object' && !Array.isArray(result) && result.ok === true
		&& typeof result.repoId === 'string' && result.repoId && typeof result.resolvedRef === 'string'
		&& /^[a-f0-9]{40}$/u.test(result.resolvedRef) && Array.isArray(result.files),
		'ACCEPTANCE_SDK_LIBRARY_READ: Complete supported CLI library-read result required');
	return result;
}
function measured(record: Row | undefined): boolean {
	return Boolean(record && record.status === 'passed' && record.exitCode === 0
		&& typeof record.outputDigest === 'string' && /^sha256:[a-f0-9]{64}$/u.test(record.outputDigest)
		&& Number.isSafeInteger(record.durationSeconds) && record.durationSeconds >= 0);
}
export function sdkGoldenSource(freeze: Row, proposalIds: unknown): string {
	const source = freeze.sourceHeads?.sdk;
	assert.ok(typeof source === 'string' && /^[a-f0-9]{40}$/u.test(source)
		&& typeof freeze.proposal?.id === 'string' && Array.isArray(proposalIds) && proposalIds.includes(freeze.proposal.id),
		'ACCEPTANCE_SDK_FREEZE: Exact current source and matching frozen proposal required');
	return source;
}
export function sdkGoldenProposalProvenance(storedProposal: unknown): Row {
	assert.ok(storedProposal && typeof storedProposal === 'object' && !Array.isArray(storedProposal),
		'ACCEPTANCE_SDK_PROPOSAL: Original public proposal record required');
	const governance = storedProposal as Row, provenance = governance.metadata?.contentProvenance;
	assert.ok(provenance && typeof provenance.repositoryId === 'string' && /^repo_[A-Za-z0-9_-]+$/u.test(provenance.repositoryId)
		&& typeof provenance.commitSha === 'string' && /^[a-f0-9]{40}$/u.test(provenance.commitSha)
		&& typeof provenance.digest === 'string' && /^[a-f0-9]{64}$/u.test(provenance.digest)
		&& typeof provenance.contentPath === 'string' && provenance.contentPath.startsWith('proposals/')
		&& !/[\s\\\0]/u.test(provenance.contentPath)
		&& !provenance.contentPath.split('/').some((part: string) => !part || part === '.' || part === '..')
		&& Number.isSafeInteger(governance.activeVersion) && governance.activeVersion > 0
		&& governance.activeContentHash === provenance.digest,
		'ACCEPTANCE_SDK_PROPOSAL: Original exact governed content provenance required');
	return provenance;
}
export function sdkGoldenProposalDocument(storedProposal: unknown, original: SdkGoldenOriginal | undefined): Row {
	const provenance = sdkGoldenProposalProvenance(storedProposal), governance = storedProposal as Row;
	assert.ok(original && original.binding?.repositoryId === provenance.repositoryId
		&& original.files?.repoId === provenance.repositoryId && original.files.resolvedRef === provenance.commitSha
		&& Array.isArray(original.files.files) && original.files.files.length === 1,
		'ACCEPTANCE_SDK_PROPOSAL: Independently resolved original library and exact content required');
	const file = original.files.files[0];
	assert.ok(file && file.path === provenance.contentPath && typeof file.content === 'string'
		&& Buffer.byteLength(file.content) <= 1_048_576
		&& createHash('sha256').update(file.content).digest('hex') === provenance.digest,
		'ACCEPTANCE_SDK_PROPOSAL: Original recorded path and raw proposal bytes required');
	const document = file.content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
	assert.ok(document, 'ACCEPTANCE_SDK_PROPOSAL: Original frontmatter required');
	const proposal = parse(document[1], { maxAliasCount: 0 }) as Row;
	const syntax = parseDocument(document[1]);
	assert.equal(syntax.errors.length, 0, 'ACCEPTANCE_SDK_PROPOSAL: Unambiguous original YAML required');
	visit(syntax, (_key, node) => {
		if (node && typeof node === 'object' && 'anchor' in node) assert.ok(!node.anchor,
			'ACCEPTANCE_SDK_PROPOSAL: Stored configuration cannot contain YAML anchors');
	});
	assert.deepEqual(proposal, file.frontmatter, 'ACCEPTANCE_SDK_PROPOSAL: Readback contradicts original bytes');
	assert.ok(proposal && typeof proposal === 'object' && !Array.isArray(proposal)
		&& proposal.id === governance.id && proposal.projectId === governance.projectId
		&& proposal.title === governance.title && proposal.summary === governance.summary && proposal.request === governance.body,
		'ACCEPTANCE_SDK_PROPOSAL: Governance index differs from its original content');
	return proposal;
}
function verifySdkGoldenAuthoredWork(proposal: Row, draft = false): void {
	const sourceCode = draft ? 'ACCEPTANCE_SDK_FROZEN_REQUEST' : 'ACCEPTANCE_SDK_PROPOSAL';
	const graphCode = draft ? sourceCode : 'ACCEPTANCE_SDK_GRAPH';
	assert.ok(Array.isArray(proposal.evidenceRefs), `${sourceCode}: Original source issue evidence required`);
	const sourceEvidence = proposal.evidenceRefs.filter((ref: unknown) => ref && typeof ref === 'object'
		&& !Array.isArray(ref) && (ref as Row).url === 'https://github.com/treeseed-ai/sdk/issues/299');
	assert.equal(sourceEvidence.length, 1, `${sourceCode}: One unambiguous original SDK source issue required`);
	const issue = exactEntityReferenceSchema.safeParse(sourceEvidence[0]);
	assert.ok(issue.success && issue.data.store === 'url' && issue.data.model === 'issue',
		`${sourceCode}: Canonical original SDK source issue reference required`);
	const authored = proposal.executionPlan?.workItems;
	const fixedRows = [
		['research-context', 'researcher', 'treedx'], ['architecture-contract', 'architect', 'treedx'],
		['tests-first', 'tester', 'git'], ['implement-change', 'engineer', 'git'],
		['document-change', 'technical-writer', 'git'], ['simulate-release', 'releaser', 'git'],
	] as const;
	assert.ok(Array.isArray(authored) && authored.length === fixedRows.length
		&& authored.every(item => item && typeof item === 'object' && !Array.isArray(item))
		&& new Set(authored.map(item => item.id)).size === fixedRows.length,
		`${graphCode}: Six unique original authored work items required`);
	for (const [id, agentClass, workspace] of fixedRows) {
		const item: Row | undefined = authored.find(row => row.id === id);
		assert.ok(item && item.agentClass === agentClass && item.workspace === workspace
			&& item.activity === 'acting' && item.review === 'required' && item.maximumReviewCycles === 2
			&& Array.isArray(item.dependsOn) && item.dependsOn.length === 0
			&& ['objective', 'contextRefs', 'requestedPermissions', 'requiredCapabilities', 'acceptanceCriteria',
				...(draft ? [] : ['estimate', 'reviewEstimate'])].every(field => Object.hasOwn(item, field)),
			`${graphCode}: Original ${id} class workspace dependencies and review policy required`);
		const permissionCode = `ACCEPTANCE_SDK_PERMISSIONS: ${graphCode}`;
		const permissions = activityProfileSchema.shape.permissions.safeParse(item.requestedPermissions);
		assert.ok(permissions.success, `${permissionCode}: Complete canonical original permission request required`);
		const reads: string[] = ['book', 'knowledge', 'objective', 'proposal', 'decision', 'note', 'question'];
		const writes: string[] = agentClass === 'researcher' ? ['knowledge', 'note', 'question']
			: agentClass === 'architect' ? ['book', 'knowledge', 'note', 'question'] : [];
		const tools: string[] = workspace === 'treedx' ? ['discussion', 'source.read']
			: ['source.read', 'source.write', 'verification', ...(agentClass === 'releaser' ? ['release'] : [])];
		const lists: [readonly string[], readonly string[]][] = [[permissions.data.content.read, reads], [permissions.data.content.write, writes], [permissions.data.tools, tools]];
		for (const [actual, expected] of lists)
			assert.deepEqual([...actual].sort(), [...expected].sort(), `${permissionCode}: Exact ${id} requested content and tools required`);
		if (draft) assert.ok(['estimate', 'reviewEstimate', 'ownerEstimate', 'reviewerEstimate'].every(field => !Object.hasOwn(item, field))
			&& typeof item.objective === 'string' && item.objective.trim()
			&& Array.isArray(item.contextRefs) && item.contextRefs.length > 0
			&& item.contextRefs.every((ref: unknown) => exactEntityReferenceSchema.safeParse(ref).success)
			&& item.requestedPermissions && typeof item.requestedPermissions === 'object' && !Array.isArray(item.requestedPermissions)
			&& Array.isArray(item.requiredCapabilities) && item.requiredCapabilities.every((value: unknown) => typeof value === 'string' && value.trim())
			&& Array.isArray(item.acceptanceCriteria) && item.acceptanceCriteria.length > 0
			&& item.acceptanceCriteria.every((value: unknown) => typeof value === 'string' && value.trim()),
			`${graphCode}: Explicit estimate-free original work required`);
	}
}

function verifySdkGoldenGraph(proposal: Row, attempt: Row, graph: Row | undefined): void {
	const code = 'ACCEPTANCE_SDK_GRAPH_PAIRS';
	assert.ok(graph && graph.teamId === attempt.teamId && Array.isArray(graph.nodes), `${code}: Independent public graph required`);
	assert.ok(graph.nodes.every((node: unknown) => node && typeof node === 'object' && !Array.isArray(node)), `${code}: Malformed graph node`);
	const nodes: Row[] = graph.nodes.filter((node: Row) => node.workdayId === attempt.workdayId && node.pairRole !== null);
	const items: Row[] = proposal.executionPlan.workItems;
	assert.equal(nodes.length, items.length * 2, `${code}: Exactly six authored Actors and six generated Reviewers required`);
	assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length, `${code}: Duplicate node identity`);
	for (const item of items) for (const role of ['actor', 'reviewer']) {
		const pair = nodes.filter(node => node.workItemId === item.id && node.pairRole === role);
		assert.equal(pair.length, 1, `${code}: Each authored work item requires one exact ${role}`);
		const node = pair[0]!;
		assert.ok(typeof node.id === 'string' && node.id && node.teamId === attempt.teamId && node.projectId === proposal.projectId
			&& node.kind === (role === 'actor' ? item.activity : 'reviewing')
			&& node.agentClass === (role === 'actor' ? item.agentClass : 'reviewer')
			&& node.workspace === (role === 'actor' ? item.workspace : 'treedx')
			&& node.maximumReviewCycles === item.maximumReviewCycles && item.review === 'required',
			`${code}: Authored Actor or generated Reviewer authority drifted`);
		assert.deepEqual(node.sourceRef, attempt.sourceRef, `${code}: Pair must represent the exact original authored proposal`);
		if (role === 'actor') assert.deepEqual(node.requestedPermissions, item.requestedPermissions, `${code}: Actor must retain its original authored permission request`);
	}
	const orderCode = 'ACCEPTANCE_SDK_GRAPH_ORDER';
	assert.ok(Array.isArray(graph.edges), `${orderCode}: Independent complete public edges required`);
	const edges = graph.edges.map((edge: unknown) => {
		const checked = executionEdgeSchema.safeParse(edge);
		assert.ok(checked.success, `${orderCode}: Canonical original edge required`); return checked.data;
	});
	assert.equal(new Set(edges.map(edge => edge.id)).size, edges.length, `${orderCode}: Duplicate edge identity`);
	const ids = new Set(nodes.map(node => node.id));
	const scoped = edges.filter(edge => ids.has(edge.fromNodeId) || ids.has(edge.toNodeId));
	const nodeId = (item: string, role: string) => nodes.find(node => node.workItemId === item && node.pairRole === role)!.id;
	const expectedPairs = items.map(item => [nodeId(item.id, 'actor'), nodeId(item.id, 'reviewer')]);
	const engineering = ['architecture-contract', 'tests-first', 'implement-change', 'document-change', 'simulate-release'];
	const expectedProfiles = engineering.slice(1).map((item, index) => [nodeId(engineering[index]!, 'reviewer'), nodeId(item, 'actor')]);
	for (const edge of scoped.filter(edge => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId))) {
		const matches = (pairs: string[][]) => pairs.some(([from, to]) => edge.fromNodeId === from && edge.toNodeId === to);
		assert.ok((edge.provenance === 'review-pair' && matches(expectedPairs))
			|| (edge.provenance === 'profile-agent' && matches(expectedProfiles)),
			`${orderCode}: Fixed work items allow only their generated review pairs and immediate reviewed profile predecessors`);
	}
	for (const [provenance, expected] of [['review-pair', expectedPairs], ['profile-agent', expectedProfiles]] as const) {
		const actual = scoped.filter(edge => edge.provenance === provenance || (provenance === 'profile-agent' && edge.provenance === 'work-item'));
		assert.equal(actual.length, expected.length, `${orderCode}: Exact pairs and immediate standing profile dependencies required`);
		for (const [from, to] of expected) {
			const matching = actual.filter(edge => edge.provenance === provenance && edge.fromNodeId === from && edge.toNodeId === to);
			assert.equal(matching.length, 1, `${orderCode}: Independent research and immediate reviewed predecessor required`);
			assert.equal(matching[0]!.teamId, attempt.teamId, `${orderCode}: Foreign edge owner`);
			assert.equal(matching[0]!.graphRevisionRemoved, undefined, `${orderCode}: Removed edge cannot establish current order`);
			assert.deepEqual(matching[0]!.sourceRef, attempt.sourceRef, `${orderCode}: Edge must retain exact authored source authority`);
		}
	}
}

export function verifySdkGoldenProduct(assignments: Row[], sourceBase: string, storedProposal: unknown,
	original?: SdkGoldenOriginal): void {
	const actors = assignments.filter(item => item.status === 'completed'
		&& item.assignmentAttempt?.effectiveProfile?.activity === 'acting');
	const final = (id: string) => actors.filter(item => item.assignmentAttempt.workItemId === id)
		.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
	const release = final('simulate-release');
	assert.ok(release, 'ACCEPTANCE_SDK_RELEASE: Completed release actor required');
	const proposal = sdkGoldenProposalDocument(storedProposal, original), governance = storedProposal as Row;
	assert.ok(original, 'ACCEPTANCE_SDK_PROPOSAL: Original public evidence required');
	const provenance = sdkGoldenProposalProvenance(governance);
	const sourceRef = release.assignmentAttempt.sourceRef;
	assert.ok(sourceRef?.store === 'treedx' && sourceRef.model === 'proposal' && typeof sourceRef.id === 'string' && sourceRef.id,
		'ACCEPTANCE_SDK_PROPOSAL: Release must retain its original proposal authority');
	assert.equal(proposal.id, sourceRef.id, 'ACCEPTANCE_SDK_PROPOSAL: Public proposal differs from the executed authority');
	assert.equal(proposal.projectId, release.assignmentAttempt.projectId, 'ACCEPTANCE_SDK_PROPOSAL: Public proposal belongs to another project');
	assert.equal(proposal.title, 'Select accepted decisions in portable workday intent',
		'ACCEPTANCE_SDK_PROPOSAL: Stored title differs from the fixed SDK proposal');
	assert.equal(proposal.summary, 'Prove the SDK can express high-level decision-governed execution while keeping all derived execution state API-owned.',
		'ACCEPTANCE_SDK_PROPOSAL: Stored summary differs from the fixed SDK proposal');
	assert.ok(original.initialProposal && original.initialProposal.id === proposal.id
		&& original.initialProposal.projectId === proposal.projectId
		&& typeof original.initialProposal.request === 'string' && original.initialProposal.request.trim()
		&& proposal.request === original.initialProposal.request,
		'ACCEPTANCE_SDK_FROZEN_REQUEST: Ready proposal must retain its original frozen request; source issue is evidence only');
	// Check the original public proposal, not the derived graph node counts.
	// Genuine estimate provenance and generated review readiness have separate gates.
	verifySdkGoldenAuthoredWork(proposal);
	const expanded = validatePortableContentData('proposal', proposal);
	assert.ok(expanded.ok, 'ACCEPTANCE_SDK_GRAPH: Complete original canonical Proposal and WorkItems required');
	assert.deepEqual(expanded.data, proposal, 'ACCEPTANCE_SDK_GRAPH: Original configuration cannot inherit defaults or discard shorthand');
	verifySdkGoldenAuthoredWork(original.initialProposal, true);
	for (const field of ['title', 'summary', 'evidenceRefs']) assert.deepEqual(proposal[field], original.initialProposal[field],
		'ACCEPTANCE_SDK_FROZEN_REQUEST: Fixed original objective and evidence changed');
	for (const item of proposal.executionPlan.workItems) {
		const { estimate, reviewEstimate, ...fixed } = item;
		assert.deepEqual(fixed, original.initialProposal.executionPlan.workItems.find((row: Row) => row.id === item.id),
			'ACCEPTANCE_SDK_FROZEN_REQUEST: Fixed original work changed while becoming ready');
	}
	verifySdkGoldenProposalReferences(proposal, original!, release.assignmentAttempt);
	assert.ok(sourceRef.revision === governance.activeVersion && sourceRef.digest === `sha256:${provenance.digest}`
		&& sourceRef.repository === provenance.repositoryId && sourceRef.commit === provenance.commitSha
		&& sourceRef.path === provenance.contentPath,
		'ACCEPTANCE_SDK_PROPOSAL: Read content differs from original issued proposal authority');
	verifySdkGoldenGraph(proposal, release.assignmentAttempt, original.graph);
	for (const item of actors.filter(item => ['research-context', 'architecture-contract', 'tests-first'].includes(item.assignmentAttempt.workItemId)))
		assert.ok(item.assignmentAttempt.contextRefs?.some((ref: Row) => ref.store === 'git' && ref.commit === sourceBase),
			'ACCEPTANCE_SDK_SOURCE: Early roles must receive exact frozen SDK source');
	const records = release.assignmentResult?.verification as Row[] | undefined;
	assert.ok(Array.isArray(records), 'ACCEPTANCE_SDK_VERIFICATION: Canonical measured verification required');
	// release:verify owns strict build, standards generation/acceptance and the full
	// test:release suite. Separate build/generator/suite receipts duplicate that gate.
	for (const command of sdkReleaseCommands) {
		const record = records.find(item => item.command === command);
		assert.ok(measured(record),
			'ACCEPTANCE_SDK_RELEASE_GATE: Every required release command must have passed with measured exact evidence');
	}
	assert.ok(!records.some(record => record.status === 'failed' || record.exitCode !== 0),
		'ACCEPTANCE_SDK_RELEASE_GATE: A failed candidate cannot pass');
	const archivePassed = (verification: unknown) => Array.isArray(verification) && verification.some(record =>
		isSdkArchiveCommand(record.command)
		&& measured(record));
	assert.ok(archivePassed(records), 'ACCEPTANCE_SDK_RELEASE_GATE: Packed export/type inspection must be independently replayable');
	const review = assignments.filter(item => item.status === 'completed' && item.assignmentAttempt?.workItemId === 'simulate-release'
		&& item.assignmentAttempt.effectiveProfile?.activity === 'reviewing')
		.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
	assert.ok(review?.lifecycleOutput?.activityCompletion?.reviewDisposition === 'approved'
		&& archivePassed(review.assignmentResult?.verification)
		&& sdkReleaseCommands.every(command => measured(review.assignmentResult?.verification?.find((record: Row) => record.command === command)))
		&& !review.assignmentResult?.verification?.some((record: Row) => record.status === 'failed' || record.exitCode !== 0),
		'ACCEPTANCE_SDK_ARCHIVE_REVIEW: Independent approved replay of every release command required');
	const source = release.lifecycleOutput?.sourceReference;
	assert.ok(source?.kind === 'git' && source.repository === 'treeseed-ai/sdk' && /^[a-f0-9]{40}$/u.test(source.commit),
		'ACCEPTANCE_SDK_CANDIDATE: Exact local SDK candidate required');
	assert.ok(release.assignmentResult.references.some((ref: Row) => ref.kind === 'git' && ref.repository === source.repository && ref.commit === source.commit),
		'ACCEPTANCE_SDK_CANDIDATE: Canonical result must retain the verified candidate');
	const actorAttempt = release.assignmentAttempt, reviewerAttempt = review.assignmentAttempt;
	assert.ok(reviewerAttempt.id !== actorAttempt.id && reviewerAttempt.agentClass !== actorAttempt.agentClass
		&& reviewerAttempt.workdayId === actorAttempt.workdayId && reviewerAttempt.projectId === actorAttempt.projectId
		&& review.assignmentResult?.assignmentId === reviewerAttempt.id && release.assignmentResult.assignmentId === actorAttempt.id
		&& review.assignmentResult.id !== release.assignmentResult.id
		&& Array.isArray(reviewerAttempt.predecessorResultIds)
		&& new Set(reviewerAttempt.predecessorResultIds).size === reviewerAttempt.predecessorResultIds.length
		&& reviewerAttempt.predecessorResultIds.includes(release.assignmentResult.id)
		&& reviewerAttempt.contextRefs?.some((ref: Row) => ref.store === 'git' && ref.repository === source.repository && ref.commit === source.commit),
		'ACCEPTANCE_SDK_ARCHIVE_REVIEW: Independent review must consume this exact Actor result and candidate');
	verifySdkReleaseOutputs(release, review, original.executionEvents, source.commit);
}

/** Resolve the proposal's own exact references against independent native public reads. */
export function verifySdkGoldenProposalReferences(proposal: Row, original: SdkGoldenOriginal, attempt: Row): void {
	const code = 'ACCEPTANCE_SDK_POPULATED_PROPOSAL';
	assert.equal(proposal.status, 'ready', `${code}: Actual ready proposal required`);
	assert.ok(Array.isArray(proposal.objectiveRefs) && proposal.objectiveRefs.length >= 2
		&& proposal.discussionRef && typeof proposal.discussionRef === 'object', `${code}: Project/team objectives and closed discussion required`);
	assert.deepEqual(proposal.objectiveRefs, original.initialProposal.objectiveRefs, `${code}: Frozen objective authority changed`);
	const team = original.teamLibrary?.project, library = original.teamLibrary?.library;
	assert.ok(team && team.slug === 'team' && team.teamId === attempt.teamId && typeof team.id === 'string' && team.id
		&& team.id !== proposal.projectId && library?.projectId === team.id && library.teamId === attempt.teamId
		&& typeof library.repositoryId === 'string' && library.repositoryId, `${code}: Original owning Team Library lookup required`);
	const refs = [...proposal.objectiveRefs, proposal.discussionRef];
	assert.ok(Array.isArray(original.referenceFiles) && original.referenceFiles.length === refs.length,
		`${code}: Complete independent reference read inventory required`);
	const scopes = new Set<string>(), consumed = new Set<Row>();
	for (const [index, value] of refs.entries()) {
		const ref = exactEntityReferenceSchema.parse(value), model = index < proposal.objectiveRefs.length ? 'objective' : 'discussion';
		assert.ok(ref.store === 'treedx' && ref.model === model && ref.repository && ref.path && ref.commit && ref.digest,
			`${code}: Complete exact governed reference required`);
		const matches: Row[] = original.referenceFiles.filter(read => read.repoId === ref.repository && read.resolvedRef === ref.commit
			&& Array.isArray(read.files) && read.files.length === 1 && read.files[0]?.path === ref.path);
		assert.equal(matches.length, 1, `${code}: One unambiguous native read required`);
		const read = matches[0]!; assert.ok(!consumed.has(read), `${code}: Reused reference read`); consumed.add(read);
		const file = read.files[0], bytes = file.content;
		assert.ok(typeof bytes === 'string' && Buffer.byteLength(bytes) <= 1_048_576
			&& `sha256:${createHash('sha256').update(bytes).digest('hex')}` === ref.digest, `${code}: Original reference bytes and digest required`);
		const document = bytes.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u); assert.ok(document, `${code}: Native reference frontmatter required`);
		const content = parse(document[1], { maxAliasCount: 0 }) as Row;
		assert.deepEqual(content, file.frontmatter, `${code}: Native parsed view contradicts bytes`);
		assert.ok(validatePortableContentData(model, content).ok && content.id === ref.id, `${code}: Exact canonical referenced entity required`);
		if (model === 'objective') {
			const project = content.projectId;
			assert.ok(project === proposal.projectId ? ref.repository === original.binding.repositoryId
				: project === team.id && ref.repository === library.repositoryId, `${code}: Foreign objective owner`);
			scopes.add(project);
		} else {
			assert.ok(content.status === 'closed' && content.projectId === proposal.projectId && content.teamId === attempt.teamId
				&& content.subjectRef?.store === 'treedx' && content.subjectRef.model === 'proposal' && content.subjectRef.id === proposal.id
				&& content.subjectRef.repository === original.binding.repositoryId && content.subjectRef.path === original.files.files[0]?.path
				&& ref.repository === original.binding.repositoryId, `${code}: Exact closed proposal discussion required`);
		}
	}
	assert.deepEqual([...scopes].sort(), [proposal.projectId, team.id].sort(), `${code}: Both original project and team objectives required`);
}

function retainedBytes(path: string): Buffer {
	assert.ok(isAbsolute(path) && realpathSync(path) === resolve(path) && lstatSync(path).isFile(),
		'ACCEPTANCE_SDK_WORKDAY: Independent regular retained file required');
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		assert.ok(fstatSync(fd).isFile() && (fstatSync(fd).mode & 0o444) !== 0, 'ACCEPTANCE_SDK_WORKDAY: Readable regular file required');
		return readFileSync(fd);
	} finally { closeSync(fd); }
}

/** Consume the original captured proposal input, not a second proposal authority. */
export function sdkGoldenFrozenProposal(freeze: Row): Row {
	assert.ok(freeze.receipts && typeof freeze.receipts === 'object' && !Array.isArray(freeze.receipts),
		'ACCEPTANCE_SDK_FROZEN_REQUEST: Original proposal input receipt required');
	const inputs = Object.entries(freeze.receipts).filter(([path]) => basename(path) === 'proposal-input.json');
	assert.equal(inputs.length, 1, 'ACCEPTANCE_SDK_FROZEN_REQUEST: One unambiguous original proposal input required');
	const [path, digest] = inputs[0]!, bytes = retainedBytes(path);
	assert.ok(bytes.length <= 1_048_576 && typeof digest === 'string' && /^sha256:[a-f0-9]{64}$/u.test(digest)
		&& digest === `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
		'ACCEPTANCE_SDK_FROZEN_REQUEST: Original proposal input bytes changed');
	const input: unknown = JSON.parse(bytes.toString('utf8'));
	assert.ok(input && typeof input === 'object' && !Array.isArray(input), 'ACCEPTANCE_SDK_FROZEN_REQUEST: Original proposal object required');
	const proposal = input as Row;
	assert.ok(proposal.status === 'draft' && typeof proposal.id === 'string' && proposal.id.trim() === proposal.id && proposal.id
		&& proposal.id === freeze.proposal?.id
		&& Array.isArray(freeze.request?.body?.projects) && freeze.request.body.projects.length === 1
		&& typeof proposal.projectId === 'string' && proposal.projectId.trim() === proposal.projectId && proposal.projectId
		&& proposal.projectId === freeze.request.body.projects[0]
		&& typeof proposal.request === 'string' && proposal.request.trim(),
		'ACCEPTANCE_SDK_FROZEN_REQUEST: Exact initial draft identity project and request required');
	assert.ok(typeof proposal.title === 'string' && proposal.title.trim() && typeof proposal.summary === 'string' && proposal.summary.trim()
		&& Array.isArray(proposal.objectiveRefs) && proposal.objectiveRefs.length >= 2
		&& proposal.objectiveRefs.every((ref: unknown) => exactEntityReferenceSchema.safeParse(ref).success),
		'ACCEPTANCE_SDK_FROZEN_REQUEST: Complete original objective authority required');
	verifySdkGoldenAuthoredWork(proposal, true);
	assert.deepEqual(retainedBytes(path), bytes, 'ACCEPTANCE_SDK_FROZEN_REQUEST: Original proposal changed during read');
	return proposal;
}
/** Product acceptance consumes the original API receipt; proposal discovery is not invocation authority. */
export function sdkGoldenWorkdayId(read: (args: string[]) => Row, freeze: Row, explicit?: string, freezePath?: string): string {
	assert.ok(freezePath, 'ACCEPTANCE_SDK_WORKDAY: Explicit immutable freeze path required');
	const bytes = retainedBytes(freezePath), receiptPath = `${freezePath}.workday-start.json`, receiptBytes = retainedBytes(receiptPath);
	assert.deepEqual(JSON.parse(bytes.toString('utf8')), freeze, 'ACCEPTANCE_SDK_WORKDAY: Frozen input changed');
	const receipt = JSON.parse(receiptBytes.toString('utf8')) as unknown;
	assert.ok(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'ACCEPTANCE_SDK_WORKDAY: Original API receipt required');
	const original = receipt as Row, preflight = freeze.preflight, body = freeze.request?.body, id = original.workdayId;
	assert.deepEqual(Object.keys(original).sort(), ['schemaVersion', 'workdayId', 'preflightId', 'preflightDigest', 'startedAt',
		'acceptedExecutionNodeIds', 'assignmentIds', 'reservationIds', 'providerReceiptRefs', 'transactionReceiptId'].sort());
	assert.equal(original.schemaVersion, 'treeseed.workday-start-receipt/v1');
	assert.ok(typeof id === 'string' && /^workday-[a-f0-9-]+$/u.test(id));
	assert.ok(typeof preflight?.id === 'string' && preflight.id.trim() && typeof preflight.teamId === 'string' && preflight.teamId.trim()
		&& typeof preflight.preflightDigest === 'string' && /^sha256:[A-Za-z0-9_-]{43}$/u.test(preflight.preflightDigest));
	assert.equal(original.preflightId, preflight.id); assert.equal(original.preflightDigest, preflight.preflightDigest);
	assert.ok(typeof original.startedAt === 'string' && Number.isFinite(Date.parse(original.startedAt))
		&& typeof original.transactionReceiptId === 'string' && /^workday-start:[A-Za-z0-9_-]{43}$/u.test(original.transactionReceiptId));
	for (const field of ['acceptedExecutionNodeIds', 'assignmentIds', 'reservationIds', 'providerReceiptRefs']) {
		const values: unknown = original[field];
		assert.ok(Array.isArray(values) && values.every(value => typeof value === 'string' && value.trim() === value && value.length > 0)
			&& new Set(values).size === values.length);
	}
	if (explicit) assert.equal(explicit, id, 'ACCEPTANCE_SDK_WORKDAY: Conflicting explicit workday');
	assert.ok(typeof freeze.proposal?.id === 'string' && freeze.proposal.id.trim());
	assert.equal(body?.executionMode, 'simulation'); assert.deepEqual(body.proposalIds, [freeze.proposal.id]);
	assert.ok(Array.isArray(body.projects) && body.projects.length === 1 && typeof body.projects[0] === 'string' && body.projects[0].trim());
	const run = read(['workdays', 'show', id]).run;
	assert.equal(run?.id, id); assert.equal(run.teamId, preflight.teamId); assert.equal(run.executionMode, 'simulation');
	assert.equal(run.status, 'completed'); assert.equal(run.startedAt, original.startedAt);
	assert.deepEqual(run.parameters?.proposalIds, body.proposalIds); assert.deepEqual(run.parameters.scheduledProjectIds, body.projects);
	assert.deepEqual(retainedBytes(freezePath), bytes); assert.deepEqual(retainedBytes(receiptPath), receiptBytes);
	return id;
}
