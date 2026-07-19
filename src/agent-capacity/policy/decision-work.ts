import type {
	AgentCapacityContractDiagnostic,
	AgentCapacityContractValidationResult,
	ContentRef,
	DecisionAssignmentGraph,
	DecisionAssignmentGraphCompileResult,
	DecisionAssignmentGraphEdge,
	DecisionAssignmentGraphNode,
	DecisionDependencySpec,
	DeliverableContract,
	DeliverableManifest,
	EngineeringAssignmentGraphInput,
	EngineeringRevisionCycleResult,
	StructuredAgentEstimate,
} from '../contracts/decision-work.ts';

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function diagnostic(
	diagnostics: AgentCapacityContractDiagnostic[],
	code: string,
	message: string,
	path?: string,
	severity: AgentCapacityContractDiagnostic['severity'] = 'error',
) {
	diagnostics.push({ severity, code, message, path });
}

function validateNonEmptyString(diagnostics: AgentCapacityContractDiagnostic[], value: unknown, field: string, path = field) {
	if (typeof value !== 'string' || !value.trim()) diagnostic(diagnostics, 'required_string_missing', `${field} is required.`, path);
}

function validateNonNegativeNumber(diagnostics: AgentCapacityContractDiagnostic[], value: unknown, field: string, path = field) {
	if (!Number.isFinite(Number(value)) || Number(value) < 0) {
		diagnostic(diagnostics, 'non_negative_number_required', `${field} must be a non-negative number.`, path);
	}
}

function validationResult(diagnostics: AgentCapacityContractDiagnostic[]): AgentCapacityContractValidationResult {
	return { ok: diagnostics.every((entry) => entry.severity !== 'error'), diagnostics };
}

function dependencyToContractId(projectId: string, decisionId: string, dependency: DecisionDependencySpec): string {
	const deliverable = dependency.deliverableType || dependency.capability || dependency.id;
	return `${projectId}:${decisionId}:deliverable:${deliverable}`.replace(/[^a-zA-Z0-9:_-]+/gu, '-');
}

function edgeTypeForDependency(dependency: DecisionDependencySpec): DecisionAssignmentGraphEdge['edgeType'] {
	if (dependency.requiredBefore === 'complete' || dependency.requiredBefore === 'review') return 'blocks-completion';
	if (dependency.requiredBefore === 'release') return 'blocks-release';
	return 'blocks-start';
}

export function validateDecisionDependencySpec(dependency: DecisionDependencySpec, path = 'dependency'): AgentCapacityContractValidationResult {
	const diagnostics: AgentCapacityContractDiagnostic[] = [];
	validateNonEmptyString(diagnostics, dependency.id, 'id', `${path}.id`);
	if (!['artifact', 'capability', 'decision', 'external-resource', 'human-input'].includes(dependency.type)) {
		diagnostic(diagnostics, 'invalid_dependency_type', `Dependency ${dependency.id || '<unknown>'} has an invalid type.`, `${path}.type`);
	}
	if (!['start', 'complete', 'review', 'release'].includes(dependency.requiredBefore)) {
		diagnostic(diagnostics, 'invalid_dependency_required_before', `Dependency ${dependency.id || '<unknown>'} has an invalid requiredBefore value.`, `${path}.requiredBefore`);
	}
	if (dependency.type === 'artifact' && !dependency.deliverableType) diagnostic(diagnostics, 'artifact_dependency_missing_deliverable_type', 'Artifact dependencies must declare deliverableType.', `${path}.deliverableType`);
	if (dependency.type === 'capability' && !dependency.capability && !dependency.agentClass) diagnostic(diagnostics, 'capability_dependency_missing_capability', 'Capability dependencies must declare capability or agentClass.', `${path}.capability`);
	if (dependency.type === 'human-input') {
		const policy = dependency.humanInputPolicy;
		if (!policy || !['team-human', 'any-human', 'any-human-or-agent'].includes(policy.requiredFrom)) {
			diagnostic(diagnostics, 'human_input_policy_missing', 'Human-input dependencies must declare a valid humanInputPolicy.requiredFrom.', `${path}.humanInputPolicy.requiredFrom`);
		}
	}
	return validationResult(diagnostics);
}

export function validateStructuredAgentEstimate(estimate: StructuredAgentEstimate): AgentCapacityContractValidationResult {
	const diagnostics: AgentCapacityContractDiagnostic[] = [];
	validateNonEmptyString(diagnostics, estimate.id, 'id');
	validateNonEmptyString(diagnostics, estimate.teamId, 'teamId');
	validateNonEmptyString(diagnostics, estimate.projectId, 'projectId');
	validateNonEmptyString(diagnostics, estimate.agentClass, 'agentClass');
	if (!estimate.decisionId && !estimate.proposalId) diagnostic(diagnostics, 'estimate_missing_subject', 'Structured estimates must reference a decisionId or proposalId.', 'decisionId');
	validateNonNegativeNumber(diagnostics, estimate.minCredits, 'minCredits');
	validateNonNegativeNumber(diagnostics, estimate.expectedCredits, 'expectedCredits');
	validateNonNegativeNumber(diagnostics, estimate.maxCredits, 'maxCredits');
	if (Number(estimate.minCredits) > Number(estimate.expectedCredits) || Number(estimate.expectedCredits) > Number(estimate.maxCredits)) {
		diagnostic(diagnostics, 'estimate_credit_bounds_invalid', 'Estimate credit bounds must satisfy min <= expected <= max.', 'expectedCredits');
	}
	if (!['low', 'medium', 'high'].includes(estimate.confidence)) diagnostic(diagnostics, 'estimate_confidence_invalid', 'Estimate confidence must be low, medium, or high.', 'confidence');
	if (!['low', 'medium', 'high'].includes(estimate.riskLevel)) diagnostic(diagnostics, 'estimate_risk_level_invalid', 'Estimate riskLevel must be low, medium, or high.', 'riskLevel');
	for (const [index, dependency] of (estimate.dependencies ?? []).entries()) {
		diagnostics.push(...validateDecisionDependencySpec(dependency, `dependencies.${index}`).diagnostics);
	}
	return validationResult(diagnostics);
}

export function validateDeliverableContract(contract: DeliverableContract): AgentCapacityContractValidationResult {
	const diagnostics: AgentCapacityContractDiagnostic[] = [];
	validateNonEmptyString(diagnostics, contract.id, 'id');
	validateNonEmptyString(diagnostics, contract.teamId, 'teamId');
	validateNonEmptyString(diagnostics, contract.projectId, 'projectId');
	validateNonEmptyString(diagnostics, contract.decisionId, 'decisionId');
	validateNonEmptyString(diagnostics, contract.deliverableType, 'deliverableType');
	if (!Array.isArray(contract.producerAgentClasses) || contract.producerAgentClasses.length === 0) diagnostic(diagnostics, 'deliverable_contract_missing_producer', 'Deliverable contracts must declare at least one producerAgentClass.', 'producerAgentClasses');
	if (!['required', 'draft', 'submitted', 'approved', 'rejected'].includes(contract.status)) diagnostic(diagnostics, 'deliverable_contract_status_invalid', 'Deliverable contract has an invalid status.', 'status');
	return validationResult(diagnostics);
}

export function validateDeliverableManifest(manifest: DeliverableManifest): AgentCapacityContractValidationResult {
	const diagnostics: AgentCapacityContractDiagnostic[] = [];
	validateNonEmptyString(diagnostics, manifest.id, 'id');
	validateNonEmptyString(diagnostics, manifest.deliverableContractId, 'deliverableContractId');
	validateNonEmptyString(diagnostics, manifest.projectId, 'projectId');
	validateNonEmptyString(diagnostics, manifest.decisionId, 'decisionId');
	if (!Array.isArray(manifest.producedRefs) || manifest.producedRefs.length === 0) diagnostic(diagnostics, 'deliverable_manifest_missing_refs', 'Deliverable manifests must map the contract to at least one produced content ref.', 'producedRefs');
	validateNonEmptyString(diagnostics, manifest.summary, 'summary');
	if (manifest.sourceAuthority) {
		validateNonEmptyString(diagnostics, manifest.sourceAuthority.assignmentId, 'sourceAuthority.assignmentId');
		validateNonEmptyString(diagnostics, manifest.sourceAuthority.modeRunId, 'sourceAuthority.modeRunId');
		for (const field of ['baseRef', 'effectiveRef'] as const) {
			const value = manifest.sourceAuthority[field];
			if (!/^[0-9a-f]{7,64}$/iu.test(value)) diagnostic(diagnostics, 'deliverable_source_ref_invalid', `${field} must be an immutable hexadecimal commit id.`, `sourceAuthority.${field}`);
		}
		const checkpoint = manifest.sourceAuthority.checkpointCommit;
		if (checkpoint != null && (!/^[0-9a-f]{7,64}$/iu.test(checkpoint) || checkpoint !== manifest.sourceAuthority.effectiveRef)) {
			diagnostic(diagnostics, 'deliverable_checkpoint_ref_invalid', 'checkpointCommit must be an immutable commit id equal to effectiveRef.', 'sourceAuthority.checkpointCommit');
		}
	}
	return validationResult(diagnostics);
}

export function validateDecisionAssignmentGraph(graph: DecisionAssignmentGraph): AgentCapacityContractValidationResult {
	const diagnostics: AgentCapacityContractDiagnostic[] = [];
	validateNonEmptyString(diagnostics, graph.id, 'id');
	validateNonEmptyString(diagnostics, graph.teamId, 'teamId');
	validateNonEmptyString(diagnostics, graph.projectId, 'projectId');
	validateNonEmptyString(diagnostics, graph.decisionId, 'decisionId');
	if (!Number.isInteger(graph.version) || graph.version < 1) diagnostic(diagnostics, 'graph_version_invalid', 'Decision assignment graph version must be a positive integer.', 'version');
	if (graph.compiledBy !== 'api-control-plane') diagnostic(diagnostics, 'graph_compiler_invalid', 'Decision assignment graphs must be compiled by api-control-plane.', 'compiledBy');
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	for (const [index, node] of graph.nodes.entries()) {
		validateNonEmptyString(diagnostics, node.id, 'node.id', `nodes.${index}.id`);
		validateNonEmptyString(diagnostics, node.targetAgentClass, 'node.targetAgentClass', `nodes.${index}.targetAgentClass`);
		validateNonNegativeNumber(diagnostics, node.capacity.expectedCredits, 'node.capacity.expectedCredits', `nodes.${index}.capacity.expectedCredits`);
		validateNonNegativeNumber(diagnostics, node.capacity.maxCredits, 'node.capacity.maxCredits', `nodes.${index}.capacity.maxCredits`);
	}
	for (const [index, edge] of graph.edges.entries()) {
		if (!nodeIds.has(edge.fromNodeId)) diagnostic(diagnostics, 'graph_edge_from_missing', `Edge ${index} references missing fromNodeId.`, `edges.${index}.fromNodeId`);
		if (!nodeIds.has(edge.toNodeId)) diagnostic(diagnostics, 'graph_edge_to_missing', `Edge ${index} references missing toNodeId.`, `edges.${index}.toNodeId`);
	}
	for (const [index, contract] of graph.deliverableContracts.entries()) {
		diagnostics.push(...validateDeliverableContract(contract).diagnostics.map((entry) => ({ ...entry, path: `deliverableContracts.${index}${entry.path ? `.${entry.path}` : ''}` })));
	}
	return validationResult(diagnostics);
}

export function compileDecisionAssignmentGraphFromEstimates(input: {
	id?: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	version?: number;
	estimates: StructuredAgentEstimate[];
	compiledAt?: string | null;
}): DecisionAssignmentGraphCompileResult {
	const diagnostics: AgentCapacityContractDiagnostic[] = [];
	const estimates = [...(input.estimates ?? [])].sort((left, right) => (
		left.agentClass.localeCompare(right.agentClass)
		|| String(left.agentId ?? '').localeCompare(String(right.agentId ?? ''))
		|| left.id.localeCompare(right.id)
	));
	for (const [index, estimate] of estimates.entries()) {
		diagnostics.push(...validateStructuredAgentEstimate(estimate).diagnostics.map((entry) => ({ ...entry, path: `estimates.${index}${entry.path ? `.${entry.path}` : ''}` })));
	}
	const contractMap = new Map<string, DeliverableContract>();
	const deliverableProducerNodes = new Map<string, string>();
	const nodes: DecisionAssignmentGraphNode[] = [];
	const edges: DecisionAssignmentGraphEdge[] = [];
	for (const estimate of estimates) {
		for (const dependency of estimate.dependencies.filter((entry) => entry.type === 'artifact' && entry.deliverableType)) {
			const contractId = dependencyToContractId(input.projectId, input.decisionId, dependency);
			if (!contractMap.has(contractId)) {
				const producerClass = dependency.agentClass || dependency.capability || dependency.deliverableType || 'producer';
				contractMap.set(contractId, {
					id: contractId,
					teamId: input.teamId,
					projectId: input.projectId,
					decisionId: input.decisionId,
					deliverableType: dependency.deliverableType ?? dependency.id,
					producerAgentClasses: [producerClass],
					acceptanceCriteria: dependency.summary ? [dependency.summary] : [],
					status: 'required',
					metadata: { sourceDependencyId: dependency.id },
				});
				const producerNodeId = `${contractId}:produce`;
				deliverableProducerNodes.set(contractId, producerNodeId);
				nodes.push({
					id: producerNodeId,
					decisionId: input.decisionId,
					projectId: input.projectId,
					targetAgentClass: producerClass,
					activityType: 'acting',
					handler: null,
					requiredCapabilities: uniqueStrings([dependency.capability ?? ''].filter(Boolean)),
					requiredDeliverableContractIds: [],
					inputRefs: [],
					outputRequirements: [{ id: `${contractId}:output`, outputType: dependency.deliverableType ?? dependency.id, description: dependency.summary, required: true }],
					capacity: { expectedCredits: 1, maxCredits: 1 },
					status: 'pending',
					metadata: { producesDeliverableContractId: contractId, generatedFromDependency: dependency.id },
				});
			}
		}
	}
	for (const estimate of estimates) {
		const nodeId = estimate.workUnitId || `estimate:${estimate.id}:work`;
		const artifactDependencies = estimate.dependencies.filter((dependency) => dependency.type === 'artifact' && dependency.deliverableType);
		const requiredDeliverableContractIds = artifactDependencies.map((dependency) => dependencyToContractId(input.projectId, input.decisionId, dependency));
		const inputRefs = estimate.dependencies.flatMap((dependency) => (dependency.contentRefs ?? []).map((ref): ContentRef => ({ model: 'note', collection: 'notes', slug: ref, id: ref })));
		nodes.push({
			id: nodeId,
			decisionId: input.decisionId,
			projectId: input.projectId,
			targetAgentClass: estimate.agentClass,
			activityType: 'acting',
			handler: null,
			requiredCapabilities: uniqueStrings(estimate.dependencies.map((dependency) => dependency.capability ?? dependency.agentClass ?? '').filter(Boolean)),
			requiredDeliverableContractIds,
			inputRefs,
			outputRequirements: estimate.expectedOutputs,
			capacity: { expectedCredits: estimate.expectedCredits, maxCredits: estimate.maxCredits },
			status: 'pending',
			metadata: {
				estimateId: estimate.id,
				confidence: estimate.confidence,
				riskLevel: estimate.riskLevel,
				humanInputDependencies: estimate.dependencies.filter((dependency) => dependency.type === 'human-input'),
			},
		});
		for (const dependency of artifactDependencies) {
			const contractId = dependencyToContractId(input.projectId, input.decisionId, dependency);
			const producerNodeId = deliverableProducerNodes.get(contractId);
			if (producerNodeId) edges.push({ fromNodeId: producerNodeId, toNodeId: nodeId, edgeType: edgeTypeForDependency(dependency), reason: dependency.summary ?? dependency.deliverableType });
		}
	}
	const graph: DecisionAssignmentGraph = {
		id: input.id ?? `${input.projectId}:${input.decisionId}:graph:v${input.version ?? 1}`,
		teamId: input.teamId,
		projectId: input.projectId,
		decisionId: input.decisionId,
		version: input.version ?? 1,
		status: diagnostics.some((entry) => entry.severity === 'error') ? 'blocked' : 'compiled',
		estimateIds: estimates.map((estimate) => estimate.id),
		deliverableContracts: [...contractMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
		nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
		edges: edges.sort((left, right) => left.fromNodeId.localeCompare(right.fromNodeId) || left.toNodeId.localeCompare(right.toNodeId) || left.edgeType.localeCompare(right.edgeType)),
		compiledAt: input.compiledAt ?? null,
		compiledBy: 'api-control-plane',
		metadata: { compiler: 'compileDecisionAssignmentGraphFromEstimates' },
	};
	diagnostics.push(...validateDecisionAssignmentGraph(graph).diagnostics);
	return { graph, diagnostics };
}

export function compileEngineeringAssignmentGraph(input: EngineeringAssignmentGraphInput): DecisionAssignmentGraphCompileResult {
	const version = input.version ?? 1;
	const graphId = input.id ?? `${input.projectId}:${input.decisionId}:engineering:v${version}`;
	const stages = [
		...(input.includeResearch && input.roles.researcher ? [{ key: 'research', role: input.roles.researcher, output: 'research_evidence' }] : []),
		...(input.includeArchitecture && input.roles.architect ? [{ key: 'architecture', role: input.roles.architect, output: 'architecture_plan' }] : []),
		{ key: 'test', role: input.roles.tester, output: 'failing_test_proof' },
		{ key: 'implementation', role: input.roles.engineer, output: 'implementation_change' },
		{ key: 'verification', role: input.roles.tester, output: 'passing_verification' },
		{ key: 'review', role: input.roles.reviewer, output: 'review_decision' },
		{ key: 'documentation', role: input.roles.technicalWriter, output: 'documentation_update' },
		{ key: 'release', role: input.roles.releaser, output: 'release_readiness' },
		...(input.roles.operations ? [{ key: 'operations', role: input.roles.operations, output: 'integration_handoff' }] : []),
	] as const;
	const contracts = stages.map((stage): DeliverableContract => ({
		id: `${graphId}:deliverable:${stage.output}`,
		teamId: input.teamId,
		projectId: input.projectId,
		decisionId: input.decisionId,
		deliverableType: stage.output,
		producerAgentClasses: [stage.role],
		reviewerAgentClasses: stage.key === 'review' ? [input.roles.reviewer] : undefined,
		acceptanceCriteria: [`${stage.output} must preserve exact decision and source-ref provenance.`],
		status: 'required',
		metadata: { workflowKind: 'engineering-test-first', stage: stage.key },
	}));
	const nodes = stages.map((stage, index): DecisionAssignmentGraphNode => {
		const previous = contracts[index - 1];
		return {
			id: `${graphId}:node:${stage.key}`,
			decisionId: input.decisionId,
			projectId: input.projectId,
			targetAgentClass: stage.role,
			activityType: 'acting',
			handler: null,
			requiredCapabilities: [`engineering:${stage.key}`],
			requiredDeliverableContractIds: previous ? [previous.id] : [],
			inputRefs: [],
			outputRequirements: [{ id: contracts[index]!.id, outputType: stage.output, required: true }],
			capacity: { expectedCredits: Math.max(1, input.credits?.[stage.key] ?? 1), maxCredits: Math.max(1, input.credits?.[stage.key] ?? 1) },
			status: index === 0 ? 'ready' : 'pending',
			metadata: {
				workflowKind: 'engineering-test-first',
				stage: stage.key,
				exactBaseRef: input.exactBaseRef,
				producesDeliverableContractId: contracts[index]!.id,
				...(stage.key === 'implementation' ? { requiresFailingTestIntegrationRef: true, testMutationForbidden: true } : {}),
				...(stage.key === 'test' ? { implementationMutationForbidden: true } : {}),
				...(stage.key === 'review' ? { rejectionCreatesRevision: true } : {}),
				...(stage.key === 'release' ? { hostedReleaseFailClosed: true } : {}),
			},
		};
	});
	const edges = nodes.slice(1).map((node, index): DecisionAssignmentGraphEdge => ({
		fromNodeId: nodes[index]!.id,
		toNodeId: node.id,
		edgeType: node.metadata?.stage === 'release' || node.metadata?.stage === 'operations' ? 'blocks-release' : 'blocks-start',
		reason: `Engineering stage ${String(nodes[index]!.metadata?.stage)} must be approved before ${String(node.metadata?.stage)}.`,
	}));
	const graph: DecisionAssignmentGraph = {
		id: graphId,
		teamId: input.teamId,
		projectId: input.projectId,
		decisionId: input.decisionId,
		version,
		status: 'compiled',
		estimateIds: [],
		deliverableContracts: contracts,
		nodes,
		edges,
		compiledAt: input.compiledAt ?? null,
		compiledBy: 'api-control-plane',
		metadata: { compiler: 'compileEngineeringAssignmentGraph', workflowKind: 'engineering-test-first', exactBaseRef: input.exactBaseRef },
	};
	const diagnostics = validateDecisionAssignmentGraph(graph).diagnostics;
	if (!input.exactBaseRef.trim()) diagnostic(diagnostics, 'engineering_exact_base_ref_required', 'Engineering graphs require an exact base ref.', 'exactBaseRef');
	return { graph: { ...graph, status: diagnostics.some((entry) => entry.severity === 'error') ? 'blocked' : 'compiled' }, diagnostics };
}

export function advanceDecisionAssignmentGraph(
	graph: DecisionAssignmentGraph,
	completedContractId: string,
	approvedContractIds: ReadonlySet<string>,
): DecisionAssignmentGraph {
	const producingNode = graph.nodes.find((node) => node.metadata?.producesDeliverableContractId === completedContractId);
	if (!producingNode) return graph;
	const completedNodes = new Set(graph.nodes.filter((node) => node.status === 'completed').map((node) => node.id));
	completedNodes.add(producingNode.id);
	const nodes = graph.nodes.map((node): DecisionAssignmentGraphNode => {
		if (node.id === producingNode.id) return { ...node, status: 'completed' };
		if (node.status !== 'pending') return node;
		const predecessors = graph.edges.filter((edge) => edge.toNodeId === node.id).map((edge) => edge.fromNodeId);
		const dependenciesComplete = predecessors.every((id) => completedNodes.has(id));
		const contractsApproved = node.requiredDeliverableContractIds.every((id) => approvedContractIds.has(id));
		return dependenciesComplete && contractsApproved ? { ...node, status: 'ready' } : node;
	});
	const complete = nodes.length > 0 && nodes.every((node) => node.status === 'completed');
	return {
		...graph,
		status: complete ? 'completed' : graph.status,
		nodes,
		deliverableContracts: graph.deliverableContracts.map((contract) => contract.id === completedContractId ? { ...contract, status: 'approved' } : contract),
	};
}

export function activateDecisionAssignmentGraph(graph: DecisionAssignmentGraph): DecisionAssignmentGraph {
	const incoming = new Set(graph.edges.map((edge) => edge.toNodeId));
	return {
		...graph,
		status: 'ready',
		nodes: graph.nodes.map((node) => (
			node.status === 'pending' && !incoming.has(node.id) && node.requiredDeliverableContractIds.length === 0
				? { ...node, status: 'ready' }
				: node
		)),
	};
}

export function compileEngineeringRevisionCycle(
	graph: DecisionAssignmentGraph,
	rejectedReviewContractId: string,
	reason: string,
): EngineeringRevisionCycleResult | null {
	if (graph.metadata?.workflowKind !== 'engineering-test-first') return null;
	const reviewNode = graph.nodes.find((node) => node.metadata?.producesDeliverableContractId === rejectedReviewContractId && node.metadata?.stage === 'review');
	const documentationNode = graph.nodes.find((node) => node.metadata?.stage === 'documentation');
	const engineerNode = graph.nodes.find((node) => node.metadata?.stage === 'implementation');
	const testerNode = graph.nodes.find((node) => node.metadata?.stage === 'verification');
	if (!reviewNode || !documentationNode || !engineerNode || !testerNode) return null;
	const revisionCycle = Math.max(0, ...graph.nodes.map((node) => Number(node.metadata?.revisionCycle ?? 0)).filter(Number.isFinite)) + 1;
	const prefix = `${graph.id}:revision:${revisionCycle}`;
	const stages = [
		{ key: 'implementation', role: engineerNode.targetAgentClass, output: 'implementation_revision' },
		{ key: 'verification', role: testerNode.targetAgentClass, output: 'revision_verification' },
		{ key: 'review', role: reviewNode.targetAgentClass, output: 'revision_review_decision' },
	] as const;
	const newContracts = stages.map((stage): DeliverableContract => ({
		id: `${prefix}:deliverable:${stage.output}`,
		teamId: graph.teamId, projectId: graph.projectId, decisionId: graph.decisionId,
		deliverableType: stage.output, producerAgentClasses: [stage.role],
		reviewerAgentClasses: stage.key === 'review' ? [stage.role] : undefined,
		acceptanceCriteria: [`Revision cycle ${revisionCycle} must resolve the rejected review with exact source-ref provenance.`],
		status: 'required', metadata: { workflowKind: 'engineering-test-first', stage: stage.key, revisionCycle, rejectedReviewContractId },
	}));
	const revisionNodes = stages.map((stage, index): DecisionAssignmentGraphNode => ({
		id: `${prefix}:node:${stage.key}`,
		decisionId: graph.decisionId, projectId: graph.projectId, targetAgentClass: stage.role, activityType: 'acting', handler: null,
		requiredCapabilities: [`engineering:${stage.key}`],
		requiredDeliverableContractIds: index === 0 ? [] : [newContracts[index - 1]!.id],
		inputRefs: [], outputRequirements: [{ id: newContracts[index]!.id, outputType: stage.output, required: true }],
		capacity: { expectedCredits: 1, maxCredits: 1 }, status: index === 0 ? 'ready' : 'pending',
		metadata: {
			workflowKind: 'engineering-test-first', stage: stage.key, revisionCycle,
			exactBaseRef: graph.metadata?.exactBaseRef, producesDeliverableContractId: newContracts[index]!.id,
			revisionReason: reason, revisionOfNodeId: reviewNode.id,
			...(stage.key === 'implementation' ? { requiresFailingTestIntegrationRef: true, testMutationForbidden: true } : {}),
			...(stage.key === 'review' ? { rejectionCreatesRevision: true } : {}),
		},
	}));
	const edges = graph.edges.filter((edge) => !(edge.fromNodeId === reviewNode.id && edge.toNodeId === documentationNode.id));
	edges.push(
		{ fromNodeId: reviewNode.id, toNodeId: revisionNodes[0]!.id, edgeType: 'blocks-start', reason: `Review rejected: ${reason}` },
		{ fromNodeId: revisionNodes[0]!.id, toNodeId: revisionNodes[1]!.id, edgeType: 'blocks-start', reason: 'Revision implementation requires verification.' },
		{ fromNodeId: revisionNodes[1]!.id, toNodeId: revisionNodes[2]!.id, edgeType: 'blocks-start', reason: 'Revision verification requires review.' },
		{ fromNodeId: revisionNodes[2]!.id, toNodeId: documentationNode.id, edgeType: 'blocks-start', reason: 'Documentation requires an approved revision review.' },
	);
	return {
		revisionCycle,
		newContracts,
		graph: {
			...graph,
			deliverableContracts: [
				...graph.deliverableContracts.map((contract) => contract.id === rejectedReviewContractId ? { ...contract, status: 'rejected' as const } : contract),
				...newContracts,
			],
			nodes: [
				...graph.nodes.map((node) => node.id === reviewNode.id ? { ...node, status: 'completed' as const } : node.id === documentationNode.id ? { ...node, requiredDeliverableContractIds: [newContracts[2]!.id], status: 'pending' as const } : node),
				...revisionNodes,
			],
			edges,
			metadata: { ...(graph.metadata ?? {}), revisionCycles: revisionCycle, latestRevisionReason: reason },
		},
	};
}
