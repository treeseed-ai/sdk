import { z } from "zod";

/** Portable infrastructure data only; the host must resolve and recheck real authority. */
export class AgentSchemas {
  static readonly version = "1.0.0-cordis.1";
  static readonly key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
  static readonly generation = z.string().regex(/^[a-f0-9]{64}$/);
  private static readonly revision = z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER);
  private static readonly identity = z.strictObject({
    scopeId: this.key,
    principalId: this.key,
    resourceScope: this.key,
    grantId: this.key,
    grantRevision: this.revision,
  });
  static readonly authority = this.identity.extend({
    state: z.enum(["granted", "revoked"]),
  });
  static readonly request = this.identity.extend({
    protocol: z.literal(1),
    operation: z.literal("composition-probe"),
    executionId: this.key,
    expectedGeneration: this.generation,
    handlerId: this.key,
    text: z.string().max(1024),
  });
  static readonly blocker = z.discriminatedUnion("code", [
    z.strictObject({
      code: z.literal("INVALID_AGENT_CONTRACT"),
      message: z.literal("The Agent execution contract is invalid."),
    }),
    z.strictObject({
      code: z.literal("AGENT_GRANT_REVOKED"),
      message: z.literal("The Agent execution grant is revoked."),
    }),
    z.strictObject({
      code: z.literal("AGENT_SCOPE_MISMATCH"),
      message: z.literal("The Agent execution authority does not match."),
    }),
    z.strictObject({
      code: z.literal("STALE_AGENT_GENERATION"),
      message: z.literal("The Agent execution generation is stale."),
    }),
    z.strictObject({
      code: z.literal("AGENT_PROVIDER_FAILURE"),
      message: z.literal("The Agent provider failed."),
    }),
    z.strictObject({
      code: z.literal("AGENT_CANCELLED"),
      message: z.literal("The Agent execution was cancelled."),
    }),
    z.strictObject({
      code: z.literal("AGENT_CLEANUP_FAILED"),
      message: z.literal("The Agent execution cleanup failed."),
    }),
  ]);
  private static readonly resultIdentity = this.identity.extend({
    protocol: z.literal(1),
    executionId: this.key,
    generation: this.generation,
    handlerId: this.key,
  });
  static readonly result = z.discriminatedUnion("state", [
    this.resultIdentity.extend({
      state: z.literal("completed"),
      output: z.string().max(1024),
      blockers: z.array(this.blocker).max(0),
      cleanup: z.literal("disposed"),
    }),
    this.resultIdentity.extend({
      state: z.literal("cancelled"),
      output: z.null(),
      blockers: z.array(this.blocker).max(16),
      cleanup: z.literal("disposed"),
    }),
    this.resultIdentity.extend({
      state: z.literal("blocked"),
      output: z.null(),
      blockers: z.array(this.blocker).min(1).max(16),
      cleanup: z.literal("disposed"),
    }),
    this.resultIdentity.extend({
      state: z.literal("recovery-required"),
      output: z.null(),
      blockers: z.array(this.blocker).min(1).max(16),
      cleanup: z.literal("failed"),
    }),
  ]);
}
export type AgentExecutionRequest = z.infer<typeof AgentSchemas.request>;
export type AgentExecutionResult = z.infer<typeof AgentSchemas.result>;
export type AgentAuthorityBinding = z.infer<typeof AgentSchemas.authority>;
export type AgentBlocker = z.infer<typeof AgentSchemas.blocker>;
export type AgentContractCode =
  | "INVALID_AGENT_CONTRACT"
  | "AGENT_GRANT_REVOKED"
  | "AGENT_SCOPE_MISMATCH"
  | "STALE_AGENT_GENERATION";
export class AgentContractError extends Error {
  constructor(readonly code: AgentContractCode) {
    super(code);
    this.name = "AgentContractError";
  }
}
/** Equality admission only: never creates authority, reads credentials or calls a provider. */
export class AgentContractBinding {
  static assert(
    input: unknown,
    trusted: unknown,
    generation: string,
  ): AgentExecutionRequest {
    const value = AgentContractBinding.parse(AgentSchemas.request, input);
    const accepted = AgentContractBinding.parse(
      AgentSchemas.authority,
      trusted,
    );
    AgentContractBinding.parse(AgentSchemas.generation, generation);
    if (accepted.state !== "granted")
      throw new AgentContractError("AGENT_GRANT_REVOKED");
    AgentContractBinding.assertIdentity(value, accepted);
    if (value.expectedGeneration !== generation)
      throw new AgentContractError("STALE_AGENT_GENERATION");
    return value;
  }

  private static parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new AgentContractError("INVALID_AGENT_CONTRACT");
    return result.data;
  }

  private static assertIdentity(
    value: AgentExecutionRequest,
    accepted: AgentAuthorityBinding,
  ): void {
    const fields = [
      "scopeId",
      "principalId",
      "resourceScope",
      "grantId",
      "grantRevision",
    ] as const;
    for (const field of fields) {
      if (value[field] !== accepted[field])
        throw new AgentContractError("AGENT_SCOPE_MISMATCH");
    }
  }
}
