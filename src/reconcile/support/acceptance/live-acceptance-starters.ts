import { MarketClient } from '../../../entrypoints/clients/market-client.ts';
import type { CapacityGovernanceRuntimeConnection } from '../../capacity/capacity-core/live-acceptance-capacity-governance.ts';
import type { CapacityAcceptanceExecutionInput } from '../../capacity/capacity-core/live-acceptance-capacity-executor.ts';
import type { RunLiveReconcileTestsOptions } from './live-acceptance.ts';
import { runLocalEngineeringStarterAcceptance } from './live-acceptance-starter-engineering.ts';
import { runLocalResearchStarterPlanningAcceptance } from './live-acceptance-starter-planning.ts';
import { runLocalConcurrentStarterAcceptance } from './live-acceptance-starter-concurrency.ts';

export async function runLocalAutonomousStarterAcceptances(input: {
	adminClient: MarketClient;
	apiUrl: string;
	runId: string;
	runtime: CapacityGovernanceRuntimeConnection;
	fetchImpl: typeof fetch;
	privateJwk: CapacityAcceptanceExecutionInput['privateJwk'];
	executor: NonNullable<RunLiveReconcileTestsOptions['capacityAssignmentExecutor']>;
}) {
	// Prove the highest-risk provider-global, cross-project contract first so a
	// broken portfolio boundary fails before either long autonomous graph runs.
	const starterConcurrency = await runLocalConcurrentStarterAcceptance(input);
	const starterEngineering = await runLocalEngineeringStarterAcceptance(input);
	const starterPlanning = await runLocalResearchStarterPlanningAcceptance(input);
	return { starterPlanning, starterEngineering, starterConcurrency };
}
