declare module '../support/market-client.ts' {
	interface MarketClient {
		projectAgentAuthoringDraft: OmitThisParameter<typeof import('./projects/agents/contracts/project-agent-authoring-draft.ts').projectAgentAuthoringDraftMethod>;
		authorProjectAgent: OmitThisParameter<typeof import('./projects/agents/creation/author-project-agent.ts').authorProjectAgentMethod>;
		authorProjectDefinitions: OmitThisParameter<typeof import('./projects/agents/creation/author-project-definitions.ts').authorProjectDefinitionsMethod>;
		checkProjectContextQuery: OmitThisParameter<typeof import('./projects/agents/creation/check-project-context-query.ts').checkProjectContextQueryMethod>;
		projectContextQueryChecks: OmitThisParameter<typeof import('./projects/agents/contracts/project-context-query-checks.ts').projectContextQueryChecksMethod>;
		planAgentDeployment: OmitThisParameter<typeof import('./projects/agents/contracts/agent-deployments.ts').planAgentDeploymentMethod>;
		executeAgentDeployment: OmitThisParameter<typeof import('./projects/agents/contracts/agent-deployments.ts').executeAgentDeploymentMethod>;
		agentDeployment: OmitThisParameter<typeof import('./projects/agents/contracts/agent-deployments.ts').agentDeploymentMethod>;
		activateAgentDeployment: OmitThisParameter<typeof import('./projects/agents/contracts/agent-deployments.ts').activateAgentDeploymentMethod>;
		upgradeAgentDeployment: OmitThisParameter<typeof import('./projects/agents/contracts/agent-deployments.ts').upgradeAgentDeploymentMethod>;
	}
}

export {};
