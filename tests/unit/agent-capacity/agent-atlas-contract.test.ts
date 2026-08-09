import { describe, expect, it } from "vitest";
import {
  AGENT_ATLAS_TOPOLOGY_CONTRACT,
  compileAgentDefinition,
  compileGroupDefinition,
  isAgentAtlasContextReference,
  validateGroupDefinition,
  validateGroupEdgeDefinition,
  validateGovernanceGroupGraph,
} from "../../../src/agent-capacity/index.ts";

describe("agent atlas contracts", () => {
  it("recognizes evidence-bound context references", () => {
    expect(
      isAgentAtlasContextReference({
        kind: "event",
        id: "event-1",
        projectId: "project-1",
        workdayId: "run-1",
        eventSequence: 4,
      }),
    ).toBe(true);
    expect(
      isAgentAtlasContextReference({
        kind: "event",
        id: "event-1",
        projectId: "project-1",
        eventSequence: -1,
      }),
    ).toBe(false);
    expect(AGENT_ATLAS_TOPOLOGY_CONTRACT).toBe(
      "treeseed.agent-atlas-topology/v1",
    );
  });

  it("compiles a group and its parent edge under the configured content root", () => {
    const compiled = compileGroupDefinition({
      contentRoot: "docs/src/content",
      intent: {
        name: "Research Team",
        description: "Evidence specialists.",
        classification: "agent-team",
        parentGroupId: "group:guide",
      },
    });
    expect(compiled.groupPath).toBe(
      "docs/src/content/groups/research-team.mdx",
    );
    expect(compiled.edgePath).toBe(
      "docs/src/content/group-edges/research-team.mdx",
    );
    expect(validateGroupDefinition(compiled.group)).toEqual({
      ok: true,
      diagnostics: [],
    });
    expect(validateGroupEdgeDefinition(compiled.edge)).toEqual({
      ok: true,
      diagnostics: [],
    });
    expect(compiled.edge).toMatchObject({
      fromGroupId: "group:research-team",
      toGroupId: "group:guide",
    });
  });

  it("rejects cycles in an authored group graph", () => {
    const first = compileGroupDefinition({
      contentRoot: "src/content",
      intent: { name: "First", description: "", classification: "team" },
    });
    const second = compileGroupDefinition({
      contentRoot: "src/content",
      intent: { name: "Second", description: "", classification: "team" },
    });
    expect(() =>
      validateGovernanceGroupGraph(
        [first.group, second.group],
        [
          {
            contract: "treeseed.group-edge/v1",
            id: "first-second",
            fromGroupId: first.group.id,
            toGroupId: second.group.id,
            predicate: "is-part-of",
            propagatesMembership: true,
          },
          {
            contract: "treeseed.group-edge/v1",
            id: "second-first",
            fromGroupId: second.group.id,
            toGroupId: first.group.id,
            predicate: "is-part-of",
            propagatesMembership: true,
          },
        ],
      ),
    ).toThrow(/cycle/u);
  });

  it("places new agents beneath a project configured content root", () => {
    const compiled = compileAgentDefinition({
      projectId: "project-1",
      contentRoot: "docs/src/content",
      intent: {
        name: "Evidence Guide",
        description: "Guides evidence.",
        purpose: "Review evidence.",
        responsibilities: [],
        durableInstructions: "",
        agentClass: "research",
        enabled: true,
        activityProfiles: {},
      },
    });
    expect(compiled.identity.path).toBe(
      "docs/src/content/agents/evidence-guide.mdx",
    );
    expect(compiled.frontmatter).toMatchObject({
      agentClass: "research",
      primaryGroupId: "group:project",
      groupIds: ["group:project"],
    });
    expect(compiled.generated.groupIds).not.toContain("research");
    expect(compiled.generated.groupIds).not.toContain("agent");
  });
});
