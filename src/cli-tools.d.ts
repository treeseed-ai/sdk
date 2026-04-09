import { type AgentCliOptions } from './types/agents.ts';
export declare function normalizeAgentCliOptions(input: unknown): AgentCliOptions;
export declare function buildCopilotAllowToolArgs(allowTools?: AgentCliOptions['allowTools']): string[];
