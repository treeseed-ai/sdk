export declare const AGENT_TRIGGER_KINDS: readonly ["schedule", "message", "follow", "startup"];
export declare const AGENT_PERMISSION_OPERATIONS: readonly ["get", "read", "search", "follow", "pick", "create", "update"];
export declare const AGENT_MESSAGE_STATUSES: readonly ["pending", "claimed", "completed", "failed", "dead_letter"];
export declare const AGENT_RUN_STATUSES: readonly ["running", "completed", "failed", "waiting"];
export declare const AGENT_HANDLER_KINDS: readonly ["planner", "architect", "engineer", "notifier", "researcher", "reviewer", "releaser"];
export declare const AGENT_CLI_ALLOW_TOOLS: readonly ["shell(git)", "shell(npm)", "web"];
export type AgentTriggerKind = (typeof AGENT_TRIGGER_KINDS)[number];
export type AgentPermissionOperation = (typeof AGENT_PERMISSION_OPERATIONS)[number];
export type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number];
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export type AgentHandlerKind = string;
export type AgentCliAllowTool = (typeof AGENT_CLI_ALLOW_TOOLS)[number];
export interface AgentTriggerConfig {
    type: AgentTriggerKind;
    cron?: string;
    messageTypes?: string[];
    models?: string[];
    sinceField?: string;
    runOnStart?: boolean;
}
export interface AgentPermissionConfig {
    model: string;
    operations: AgentPermissionOperation[];
}
export interface AgentOutputContract {
    messageTypes: string[];
    modelMutations: string[];
}
export interface AgentExecutionConfig {
    maxConcurrency: number;
    timeoutSeconds: number;
    cooldownSeconds: number;
    leaseSeconds: number;
    retryLimit: number;
    branchPrefix: string;
}
export interface AgentTriggerPolicy {
    maxRunsPerCycle?: number;
    messageBatchSize?: number;
}
export interface AgentCliOptions {
    model?: string;
    allowTools?: AgentCliAllowTool[];
    additionalArgs?: string[];
}
export interface AgentRuntimeSpec {
    slug: string;
    handler: AgentHandlerKind;
    enabled: boolean;
    systemPrompt: string;
    persona: string;
    cli: AgentCliOptions;
    triggers: AgentTriggerConfig[];
    triggerPolicy?: AgentTriggerPolicy;
    permissions: AgentPermissionConfig[];
    execution: AgentExecutionConfig;
    outputs: AgentOutputContract;
}
export interface AgentMessageRecord {
    [key: string]: unknown;
    id: number;
    type: string;
    status: AgentMessageStatus;
    payloadJson: string;
    relatedModel: string | null;
    relatedId: string | null;
    priority: number;
    availableAt: string;
    claimedBy: string | null;
    claimedAt: string | null;
    leaseExpiresAt: string | null;
    attempts: number;
    maxAttempts: number;
    createdAt: string;
    updatedAt: string;
}
export interface AgentRunRecord {
    [key: string]: unknown;
    runId: string;
    agentSlug: string;
    triggerSource: string;
    status: AgentRunStatus;
    selectedItemKey: string | null;
    selectedMessageId: number | null;
    branchName: string | null;
    prUrl: string | null;
    summary: string | null;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
}
export interface ContentLeaseRecord {
    [key: string]: unknown;
    model: string;
    itemKey: string;
    claimedBy: string;
    claimedAt: string;
    leaseExpiresAt: string;
    token: string;
}
