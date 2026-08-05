declare module '../support/market-client.ts' {
	interface MarketClient {
		agentLabWorkdayContext: OmitThisParameter<typeof import('./capacity/observability/contracts/agent-lab.ts').agentLabWorkdayContextMethod>;
		agentLabOverview: OmitThisParameter<typeof import('./capacity/observability/contracts/agent-lab.ts').agentLabOverviewMethod>;
		agentLabActivity: OmitThisParameter<typeof import('./capacity/observability/contracts/agent-lab.ts').agentLabActivityMethod>;
		agentLabMetricSeries: OmitThisParameter<typeof import('./capacity/observability/contracts/agent-lab.ts').agentLabMetricSeriesMethod>;
		agentLabEntities: OmitThisParameter<typeof import('./capacity/observability/contracts/agent-lab.ts').agentLabEntitiesMethod>;
		updateAgentLabTargets: OmitThisParameter<typeof import('./capacity/observability/contracts/agent-lab.ts').updateAgentLabTargetsMethod>;
	}
}

export {};
