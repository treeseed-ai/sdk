declare module '../entrypoints/models/sdk.ts' {
	interface AgentSdk {
		resolveDispatchToken: OmitThisParameter<typeof import('./accounts/resolve-dispatch-token.ts').resolveDispatchTokenMethod>;
		executeDispatchLocally: OmitThisParameter<typeof import('./runtime/execute-dispatch-locally.ts').executeDispatchLocallyMethod>;
		dispatch: OmitThisParameter<typeof import('./support/messages/dispatch.ts').dispatchMethod>;
		envelope<TPayload>(model: string, operation: import('../entrypoints/models/sdk-types.ts').SdkJsonEnvelope<TPayload>['operation'], payload: TPayload, meta?: Record<string, unknown>): import('../entrypoints/models/sdk-types.ts').SdkJsonEnvelope<TPayload>;
		get: OmitThisParameter<typeof import('./support/get.ts').getMethod>;
		read: OmitThisParameter<typeof import('./support/read.ts').readMethod>;
		search: OmitThisParameter<typeof import('./support/search/search.ts').searchMethod>;
		follow: OmitThisParameter<typeof import('./support/graph/follow.ts').followMethod>;
		pick: OmitThisParameter<typeof import('./support/pick.ts').pickMethod>;
		create: OmitThisParameter<typeof import('./support/create.ts').createMethod>;
		update: OmitThisParameter<typeof import('./support/update.ts').updateMethod>;
		claimMessage: OmitThisParameter<typeof import('./support/messages/claim-message.ts').claimMessageMethod>;
		ackMessage: OmitThisParameter<typeof import('./support/messages/ack-message.ts').ackMessageMethod>;
		createMessage: OmitThisParameter<typeof import('./support/messages/create-message.ts').createMessageMethod>;
		recordRun: OmitThisParameter<typeof import('./support/execution/record-run.ts').recordRunMethod>;
		getCursor: OmitThisParameter<typeof import('./support/cursors/get-cursor.ts').getCursorMethod>;
		upsertCursor: OmitThisParameter<typeof import('./support/cursors/upsert-cursor.ts').upsertCursorMethod>;
		releaseLease: OmitThisParameter<typeof import('./packages/release-lease.ts').releaseLeaseMethod>;
		releaseAllLeases: OmitThisParameter<typeof import('./packages/release-all-leases.ts').releaseAllLeasesMethod>;
		createApprovalRequest: OmitThisParameter<typeof import('./support/approvals/create-approval-request.ts').createApprovalRequestMethod>;
		listApprovalRequests: OmitThisParameter<typeof import('./support/approvals/list-approval-requests.ts').listApprovalRequestsMethod>;
		decideApprovalRequest: OmitThisParameter<typeof import('./support/approvals/decide-approval-request.ts').decideApprovalRequestMethod>;
		upsertTeamInboxItem: OmitThisParameter<typeof import('./teams/upsert-team-inbox-item.ts').upsertTeamInboxItemMethod>;
		listWorkstreams: OmitThisParameter<typeof import('./support/workstreams/list-workstreams.ts').listWorkstreamsMethod>;
		getWorkstream: OmitThisParameter<typeof import('./support/workstreams/get-workstream.ts').getWorkstreamMethod>;
		upsertWorkstream: OmitThisParameter<typeof import('./support/workstreams/upsert-workstream.ts').upsertWorkstreamMethod>;
		appendWorkstreamEvent: OmitThisParameter<typeof import('./support/workstreams/append-workstream-event.ts').appendWorkstreamEventMethod>;
		listReleases: OmitThisParameter<typeof import('./packages/list-releases.ts').listReleasesMethod>;
		getRelease: OmitThisParameter<typeof import('./packages/get-release.ts').getReleaseMethod>;
		upsertRelease: OmitThisParameter<typeof import('./packages/upsert-release.ts').upsertReleaseMethod>;
		listSharePackages: OmitThisParameter<typeof import('./packages/list-share-packages.ts').listSharePackagesMethod>;
		getSharePackage: OmitThisParameter<typeof import('./packages/get-share-package.ts').getSharePackageMethod>;
		upsertSharePackage: OmitThisParameter<typeof import('./packages/upsert-share-package.ts').upsertSharePackageMethod>;
		listAgentSpecs: OmitThisParameter<typeof import('./agents/list-agent-specs.ts').listAgentSpecsMethod>;
		listRawAgentSpecs: OmitThisParameter<typeof import('./agents/list-raw-agent-specs.ts').listRawAgentSpecsMethod>;
		scopeForAgent: OmitThisParameter<typeof import('./agents/scope-for-agent.ts').scopeForAgentMethod>;
		refreshGraph: OmitThisParameter<typeof import('./treedx/graph/refresh-graph.ts').refreshGraphMethod>;
		searchFiles: OmitThisParameter<typeof import('./support/search/search-files.ts').searchFilesMethod>;
		searchSections: OmitThisParameter<typeof import('./support/search/search-sections.ts').searchSectionsMethod>;
		searchEntities: OmitThisParameter<typeof import('./support/search/search-entities.ts').searchEntitiesMethod>;
		getGraphNode: OmitThisParameter<typeof import('./treedx/graph/get-graph-node.ts').getGraphNodeMethod>;
		getNeighbors: OmitThisParameter<typeof import('./support/graph/get-neighbors.ts').getNeighborsMethod>;
		followReferences: OmitThisParameter<typeof import('./support/graph/follow-references.ts').followReferencesMethod>;
		getBacklinks: OmitThisParameter<typeof import('./support/graph/get-backlinks.ts').getBacklinksMethod>;
		getRelated: OmitThisParameter<typeof import('./support/graph/get-related.ts').getRelatedMethod>;
		getSubgraph: OmitThisParameter<typeof import('./treedx/graph/get-subgraph.ts').getSubgraphMethod>;
		resolveSeeds: OmitThisParameter<typeof import('./seeds/resolve-seeds.ts').resolveSeedsMethod>;
		queryGraph: OmitThisParameter<typeof import('./treedx/graph/query-graph.ts').queryGraphMethod>;
		buildContextPack: OmitThisParameter<typeof import('./build/build-context-pack.ts').buildContextPackMethod>;
		parseGraphDsl: OmitThisParameter<typeof import('./treedx/graph/parse-graph-dsl.ts').parseGraphDslMethod>;
		resolveReference: OmitThisParameter<typeof import('./support/graph/resolve-reference.ts').resolveReferenceMethod>;
		explainReferenceChain: OmitThisParameter<typeof import('./support/graph/explain-reference-chain.ts').explainReferenceChainMethod>;
	}
}

export {};
