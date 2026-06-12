import { describe, expect, it, vi } from "vitest";
import { TreeDxApiError, TreeDxClient } from "../../src/treedx/index.ts";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TreeDX security contract", () => {
  for (const code of [
    "token_expired",
    "invalid_issuer",
    "invalid_audience",
    "invalid_signature",
    "permission_denied",
    "service_unavailable",
  ]) {
    it(`preserves ${code} error envelopes`, async () => {
      const payload = {
        ok: false,
        error: {
          code,
          message: "request failed",
          details: { reason: "contract" },
        },
      };
      const client = new TreeDxClient({
        baseUrl: "https://treedx.example.test",
        fetch: (async () =>
          json(
            payload,
            code === "service_unavailable" ? 503 : 403,
          )) as typeof fetch,
      });

      const error = await client.ready().then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(TreeDxApiError);
      expect(error).toMatchObject({
        code,
        payload,
        details: { reason: "contract" },
      });
    });
  }

  it("does not put raw Git credentials in remote request bodies", async () => {
    const calls: Array<{ body?: unknown }> = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return json({
          ok: true,
          push: {
            repoId: "repo_1",
            backend: "gix",
            status: "dry_run",
            updatedRefs: [],
            rejectedRefs: [],
          },
        });
      },
    );
    const client = new TreeDxClient({
      baseUrl: "https://treedx.example.test",
      token: "token",
      repoId: "repo_1",
      fetch: fetchMock as typeof fetch,
    });

    await client.push({
      remoteUrl: "https://example.test/repo.git",
      credentialId: "prod_origin",
      refspecs: ["refs/heads/main:refs/heads/main"],
      dryRun: true,
    });

    expect(calls[0]?.body).toMatchObject({ credentialId: "prod_origin" });
    expect(JSON.stringify(calls[0]?.body)).not.toContain("password");
    expect(JSON.stringify(calls[0]?.body)).not.toContain("accessToken");
    expect(JSON.stringify(calls[0]?.body)).not.toContain("https://user:");
  });
});
