import { MarketClient } from '../market-client.ts';
import { capacityAcceptanceConfig } from './live-acceptance-capacity-context.ts';

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function hasAuthenticatedCommittedContentReferences(contentReferences: unknown[], toolEvents: unknown[], minimumArtifactCount: number) {
	const references = contentReferences.map(record);
	const events = toolEvents.map(record);
	const uniqueReferences = new Set(references.map((reference) => `${String(reference.model ?? '')}:${String(reference.contentPath ?? '')}`));
	const eventsById = new Map(events.map((event) => [String(event.id ?? ''), event]));
	const hasCommit = events.some((event) => event.status === 'completed'
		&& Array.isArray(event.derivedEventTypes)
		&& event.derivedEventTypes.includes('content_committed'));
	return references.length >= minimumArtifactCount
		&& uniqueReferences.size === references.length
		&& references.every((reference) => {
			const receiptId = String(reference.receiptId ?? '');
			const toolEventId = String(reference.toolEventId ?? '');
			const event = eventsById.get(toolEventId);
			return Boolean(receiptId && toolEventId && event?.status === 'completed'
				&& Array.isArray(event.derivedEventTypes)
				&& event.derivedEventTypes.includes('content_created'));
		})
		&& (references.length === 0 || hasCommit);
}

export async function verifyCapacityAcceptanceTerminal(input: {
	adminClient: MarketClient;
	config: ReturnType<typeof capacityAcceptanceConfig>;
	assignmentId: string;
	minimumArtifactCount?: number;
}) {
	const terminal = await input.adminClient.capacityProviderAssignment(input.config.teamId, input.assignmentId).catch((error) => {
		throw new Error(`Capacity acceptance terminal assignment inspection failed: ${error instanceof Error ? error.message : String(error)}`);
	});
	const finalStatus = String(terminal.payload.status ?? '');
	if (finalStatus !== 'completed') throw new Error(`Capacity acceptance Agent runtime finished with assignment status "${finalStatus || 'unknown'}".`);
	const terminalProxyHandle = terminal.payload.treedxProxyHandle && typeof terminal.payload.treedxProxyHandle === 'object'
		? terminal.payload.treedxProxyHandle as Record<string, unknown>
		: {};
	if (terminalProxyHandle.status !== 'revoked' || !terminalProxyHandle.revokedAt) {
		throw new Error('Capacity acceptance terminal assignment retained an issued TreeDX proxy handle.');
	}
	const terminalCapabilityHandles = terminal.payload.capabilityHandles && typeof terminal.payload.capabilityHandles === 'object'
		? terminal.payload.capabilityHandles as Record<string, unknown>
		: {};
	const capabilityEntries = ['repository', 'treeDx', 'workflowOperations', 'secrets']
		.flatMap((key) => Array.isArray(terminalCapabilityHandles[key]) ? terminalCapabilityHandles[key] as unknown[] : []);
	if (capabilityEntries.some((entry) => !entry || typeof entry !== 'object' || (entry as Record<string, unknown>).status !== 'revoked')) {
		throw new Error('Capacity acceptance terminal assignment retained an active assignment capability handle.');
	}
	const modeRuns = await input.adminClient.projectAgentModeRuns(input.config.projectId, { assignmentId: input.assignmentId }).catch((error) => {
		throw new Error(`Capacity acceptance mode-run inspection failed: ${error instanceof Error ? error.message : String(error)}`);
	});
	const completedModeRun = modeRuns.payload.items.find((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).status === 'succeeded') as Record<string, unknown> | undefined;
	if (!completedModeRun?.id) throw new Error('Capacity acceptance Agent runtime did not expose a succeeded mode run.');
	if (modeRuns.payload.items.some((entry) => !entry || typeof entry !== 'object' || (entry as Record<string, unknown>).providerAssignmentId !== input.assignmentId)) {
		throw new Error('Capacity acceptance mode-run inspection returned evidence from another assignment.');
	}
	const lifecycleOutput = terminal.payload.lifecycleOutput && typeof terminal.payload.lifecycleOutput === 'object'
		? terminal.payload.lifecycleOutput as Record<string, unknown>
		: {};
	const artifactManifest = lifecycleOutput.artifactManifest && typeof lifecycleOutput.artifactManifest === 'object'
		? lifecycleOutput.artifactManifest as Record<string, unknown>
		: null;
	if (!artifactManifest || artifactManifest.assignmentId !== input.assignmentId) {
		throw new Error('Capacity acceptance terminal assignment omitted its assignment-scoped artifact manifest.');
	}
	const contentReferences = Array.isArray(artifactManifest.contentReferences) ? artifactManifest.contentReferences : [];
	const toolEvents = Array.isArray(artifactManifest.toolEvents) ? artifactManifest.toolEvents : [];
	const completedToolIds = toolEvents
		.filter((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).status === 'completed')
		.map((entry) => String((entry as Record<string, unknown>).toolId ?? ''));
	const minimumArtifactCount = input.minimumArtifactCount ?? 1;
	if (!hasAuthenticatedCommittedContentReferences(contentReferences, toolEvents, minimumArtifactCount)) {
		throw new Error(`Capacity acceptance required at least ${minimumArtifactCount} unique content artifact(s), each tied to a completed content_created event and an authenticated assignment commit; observed ${contentReferences.length} artifact(s) and tools [${completedToolIds.join(', ')}].`);
	}
	const library = (await input.adminClient.projectTreeDxLibrary(input.config.projectId)).payload;
	if (!library?.repositoryId) throw new Error('Capacity acceptance cannot read back its artifact without the project TreeDX repository binding.');
	for (const rawReference of contentReferences) {
		const contentReference = rawReference as Record<string, unknown>;
		const contentPath = String(contentReference.contentPath ?? '');
		const contentRef = String(contentReference.ref ?? '');
		const commitSha = String(contentReference.commitSha ?? '');
		if (!contentPath || !contentRef || !commitSha) throw new Error('Capacity acceptance content artifact omitted exact path, ref, or commit provenance.');
		const readBack = await input.adminClient.treeDxReadRepositoryFiles(input.config.projectId, library.repositoryId, {
			paths: [contentPath], ref: contentRef, encoding: 'utf8', parseFrontmatter: true,
		});
		const readBackPayload = readBack.payload && typeof readBack.payload === 'object' ? readBack.payload as Record<string, unknown> : {};
		const readBackFiles = Array.isArray(readBackPayload.files) ? readBackPayload.files : [];
		if (!readBackFiles.some((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).path === contentPath)) {
			throw new Error('Capacity acceptance could not read its committed artifact from the exact TreeDX ref.');
		}
	}
	const workDayId = String(terminal.payload.workDayId ?? '');
	if (!workDayId) throw new Error('Capacity acceptance terminal assignment omitted its workday provenance.');
	const [reservations, usage, ledger] = await Promise.all([
		input.adminClient.capacityReservations(input.config.teamId, { projectId: input.config.projectId, workDayId, limit: 100 }),
		input.adminClient.capacityUsage(input.config.teamId, { projectId: input.config.projectId, workDayId, limit: 100 }),
		input.adminClient.capacityLedger(input.config.teamId, { projectId: input.config.projectId, workDayId, limit: 100 }),
	]);
	const matchingReservations = reservations.payload.items.filter((entry) => entry.assignmentId === input.assignmentId);
	const matchingUsage = usage.payload.items.filter((entry) => entry.assignmentId === input.assignmentId);
	const aggregateUsage = matchingUsage.filter((entry) => entry.accountingMode === 'aggregate');
	const matchingLedger = ledger.payload.items.filter((entry) => entry.assignmentId === input.assignmentId);
	if (matchingReservations.length !== 1 || matchingReservations[0]?.state !== 'consumed') {
		throw new Error('Capacity acceptance did not observe exactly one consumed reservation for its assignment.');
	}
	if (aggregateUsage.length !== 1) throw new Error(`Capacity acceptance expected one aggregate usage actual, observed ${aggregateUsage.length}.`);
	if (matchingLedger.length !== 1) throw new Error(`Capacity acceptance expected one exactly-once ledger settlement, observed ${matchingLedger.length}.`);
	return {
		finalStatus,
		modeRunId: String(completedModeRun.id),
		modeRunCount: modeRuns.payload.items.length,
		artifactCount: contentReferences.length,
		toolEventCount: completedToolIds.length,
		usageActualCount: matchingUsage.length,
		ledgerEntryCount: matchingLedger.length,
	};
}
