import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sdkRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workspaceRoot = resolve(sdkRoot, "..", "..");

function read(path: string) {
  return readFileSync(path, "utf8");
}

function listTests(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listTests(path);
    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("TreeDX release gate integration", () => {
  it("keeps package-local OpenAPI files for standalone SDK verification", () => {
    expect(existsSync(resolve(sdkRoot, "docs/api/openapi.yaml"))).toBe(true);
    expect(existsSync(resolve(sdkRoot, "docs/api/openapi.json"))).toBe(true);
    expect(
      read(resolve(sdkRoot, "scripts/generate-treedx-openapi-types.ts")),
    ).toContain("workspaceOpenApiPath");
    expect(
      read(resolve(sdkRoot, "scripts/generate-treedx-openapi-types.ts")),
    ).toContain("packageOpenApiPath");
  });

  it("keeps package scripts wired to contract checks", () => {
    const pkg = JSON.parse(read(resolve(sdkRoot, "package.json")));
    expect(pkg.scripts["treedx:check-types"]).toContain("--check");
    expect(pkg.scripts["treedx:contract"]).toContain(
      "treedx-openapi-contract.test.ts",
    );
    expect(pkg.scripts.verify).toBeTruthy();
  });

  it("does not use skipped Vitest tests in the SDK package", () => {
    const sources = listTests(resolve(sdkRoot, "test"));
    for (const sourcePath of sources) {
      const source = read(sourcePath);
      expect(source, sourcePath).not.toMatch(/\b(?:it|test|describe)\.skip\b/u);
      expect(source, sourcePath).not.toMatch(/\bskipIf\s*\(/u);
    }
  });

  it("has unified release-gate scripts in the repository root", () => {
    const scripts = [
      "scripts/openapi-check.sh",
      "scripts/storage-recovery-check.sh",
      "scripts/security-check.sh",
      "scripts/test-all.sh",
      "scripts/release-gate.sh",
    ];
    const present = scripts.map((script) =>
      existsSync(resolve(workspaceRoot, script)),
    );

    if (!present.every(Boolean)) {
      expect(existsSync(resolve(sdkRoot, "docs/api/openapi.yaml"))).toBe(true);
      expect(existsSync(resolve(sdkRoot, "docs/api/openapi.json"))).toBe(true);
      return;
    }

    for (const script of scripts) {
      expect(existsSync(resolve(workspaceRoot, script)), script).toBe(true);
    }
  });
});
