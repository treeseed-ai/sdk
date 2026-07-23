declare module '../sdk.ts' {
	interface AgentSdk {
		resolveDispatchToken: OmitThisParameter<typeof import('./resolve-dispatch-token.ts').resolveDispatchTokenMethod>;
		executeDispatchLocally: OmitThisParameter<typeof import('./execute-dispatch-locally.ts').executeDispatchLocallyMethod>;
		dispatch: OmitThisParameter<typeof import('./dispatch.ts').dispatchMethod>;
		envelope<TPayload>(model: string, operation: import('../sdk-types.ts').SdkJsonEnvelope<TPayload>['operation'], payload: TPayload, meta?: Record<string, unknown>): import('../sdk-types.ts').SdkJsonEnvelope<TPayload>;
		get: OmitThisParameter<typeof import('./get.ts').getMethod>;
		read: OmitThisParameter<typeof import('./read.ts').readMethod>;
		search: OmitThisParameter<typeof import('./search.ts').searchMethod>;
		follow: OmitThisParameter<typeof import('./follow.ts').followMethod>;
		pick: OmitThisParameter<typeof import('./pick.ts').pickMethod>;
		create: OmitThisParameter<typeof import('./create.ts').createMethod>;
		update: OmitThisParameter<typeof import('./update.ts').updateMethod>;
		claimMessage: OmitThisParameter<typeof import('./claim-message.ts').claimMessageMethod>;
		ackMessage: OmitThisParameter<typeof import('./ack-message.ts').ackMessageMethod>;
		createMessage: OmitThisParameter<typeof import('./create-message.ts').createMessageMethod>;
		recordRun: OmitThisParameter<typeof import('./record-run.ts').recordRunMethod>;
		getCursor: OmitThisParameter<typeof import('./get-cursor.ts').getCursorMethod>;
		upsertCursor: OmitThisParameter<typeof import('./upsert-cursor.ts').upsertCursorMethod>;
		releaseLease: OmitThisParameter<typeof import('./release-lease.ts').releaseLeaseMethod>;
		releaseAllLeases: OmitThisParameter<typeof import('./release-all-leases.ts').releaseAllLeasesMethod>;
		createApprovalRequest: OmitThisParameter<typeof import('./create-approval-request.ts').createApprovalRequestMethod>;
		listApprovalRequests: OmitThisParameter<typeof import('./list-approval-requests.ts').listApprovalRequestsMethod>;
		decideApprovalRequest: OmitThisParameter<typeof import('./decide-approval-request.ts').decideApprovalRequestMethod>;
		upsertTeamInboxItem: OmitThisParameter<typeof import('./upsert-team-inbox-item.ts').upsertTeamInboxItemMethod>;
		listWorkstreams: OmitThisParameter<typeof import('./list-workstreams.ts').listWorkstreamsMethod>;
		getWorkstream: OmitThisParameter<typeof import('./get-workstream.ts').getWorkstreamMethod>;
		upsertWorkstream: OmitThisParameter<typeof import('./upsert-workstream.ts').upsertWorkstreamMethod>;
		appendWorkstreamEvent: OmitThisParameter<typeof import('./append-workstream-event.ts').appendWorkstreamEventMethod>;
		listReleases: OmitThisParameter<typeof import('./list-releases.ts').listReleasesMethod>;
		getRelease: OmitThisParameter<typeof import('./get-release.ts').getReleaseMethod>;
		upsertRelease: OmitThisParameter<typeof import('./upsert-release.ts').upsertReleaseMethod>;
		listSharePackages: OmitThisParameter<typeof import('./list-share-packages.ts').listSharePackagesMethod>;
		getSharePackage: OmitThisParameter<typeof import('./get-share-package.ts').getSharePackageMethod>;
		upsertSharePackage: OmitThisParameter<typeof import('./upsert-share-package.ts').upsertSharePackageMethod>;
		listAgentSpecs: OmitThisParameter<typeof import('./list-agent-specs.ts').listAgentSpecsMethod>;
		listRawAgentSpecs: OmitThisParameter<typeof import('./list-raw-agent-specs.ts').listRawAgentSpecsMethod>;
		scopeForAgent: OmitThisParameter<typeof import('./scope-for-agent.ts').scopeForAgentMethod>;
		refreshGraph: OmitThisParameter<typeof import('./refresh-graph.ts').refreshGraphMethod>;
		searchFiles: OmitThisParameter<typeof import('./search-files.ts').searchFilesMethod>;
		searchSections: OmitThisParameter<typeof import('./search-sections.ts').searchSectionsMethod>;
		searchEntities: OmitThisParameter<typeof import('./search-entities.ts').searchEntitiesMethod>;
		getGraphNode: OmitThisParameter<typeof import('./get-graph-node.ts').getGraphNodeMethod>;
		getNeighbors: OmitThisParameter<typeof import('./get-neighbors.ts').getNeighborsMethod>;
		followReferences: OmitThisParameter<typeof import('./follow-references.ts').followReferencesMethod>;
		getBacklinks: OmitThisParameter<typeof import('./get-backlinks.ts').getBacklinksMethod>;
		getRelated: OmitThisParameter<typeof import('./get-related.ts').getRelatedMethod>;
		getSubgraph: OmitThisParameter<typeof import('./get-subgraph.ts').getSubgraphMethod>;
		resolveSeeds: OmitThisParameter<typeof import('./resolve-seeds.ts').resolveSeedsMethod>;
		queryGraph: OmitThisParameter<typeof import('./query-graph.ts').queryGraphMethod>;
		buildContextPack: OmitThisParameter<typeof import('./build-context-pack.ts').buildContextPackMethod>;
		parseGraphDsl: OmitThisParameter<typeof import('./parse-graph-dsl.ts').parseGraphDslMethod>;
		resolveReference: OmitThisParameter<typeof import('./resolve-reference.ts').resolveReferenceMethod>;
		explainReferenceChain: OmitThisParameter<typeof import('./explain-reference-chain.ts').explainReferenceChainMethod>;
	}
}

export {};
