import { MarketClient } from '../market-client.ts';
import type { CapacityGovernanceRuntimeConnection } from './live-acceptance-capacity-governance.ts';
import type { TreeseedCapacityAcceptanceExecutionInput } from './live-acceptance-capacity-executor.ts';
import type { RunTreeseedLiveReconcileTestsOptions } from './live-acceptance.ts';
import { runLocalEngineeringStarterAcceptance } from './live-acceptance-starter-engineering.ts';
import { runLocalResearchStarterPlanningAcceptance } from './live-acceptance-starter-planning.ts';
import { runLocalConcurrentStarterAcceptance } from './live-acceptance-starter-concurrency.ts';

export async function runLocalAutonomousStarterAcceptances(input: {
	adminClient: MarketClient;
	apiUrl: string;
	runId: string;
	runtime: CapacityGovernanceRuntimeConnection;
	fetchImpl: typeof fetch;
	privateJwk: TreeseedCapacityAcceptanceExecutionInput['privateJwk'];
	executor: NonNullable<RunTreeseedLiveReconcileTestsOptions['capacityAssignmentExecutor']>;
}) {
	// Prove the highest-risk provider-global, cross-project contract first so a
	// broken portfolio boundary fails before either long autonomous graph runs.
	const starterConcurrency = await runLocalConcurrentStarterAcceptance(input);
	const starterEngineering = await runLocalEngineeringStarterAcceptance(input);
	const starterPlanning = await runLocalResearchStarterPlanningAcceptance(input);
	return { starterPlanning, starterEngineering, starterConcurrency };
}
