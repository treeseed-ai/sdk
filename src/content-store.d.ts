import type { SdkContentEntry, SdkFollowRequest, SdkGetRequest, SdkMutationRequest, SdkPickRequest, SdkPickResult, SdkSearchRequest, SdkUpdateRequest } from './sdk-types.ts';
import type { AgentDatabase } from './d1-store.ts';
export declare class ContentStore {
    private readonly repoRoot;
    private readonly database;
    private readonly gitRuntime;
    constructor(repoRoot: string, database: AgentDatabase);
    list(model: string): Promise<SdkContentEntry[]>;
    get(request: SdkGetRequest): Promise<SdkContentEntry>;
    search(request: SdkSearchRequest): Promise<SdkContentEntry[]>;
    follow(request: SdkFollowRequest): Promise<{
        items: SdkContentEntry[];
        since: string;
    }>;
    pick(request: SdkPickRequest): Promise<SdkPickResult<SdkContentEntry>>;
    create(request: SdkMutationRequest): Promise<{
        item: SdkContentEntry;
        git: import("./git-runtime.ts").GitMutationResult;
    }>;
    update(request: SdkUpdateRequest): Promise<{
        item: SdkContentEntry;
        git: import("./git-runtime.ts").GitMutationResult;
    }>;
}
