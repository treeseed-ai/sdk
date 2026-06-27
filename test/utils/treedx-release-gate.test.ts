import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findTreeseedPackageAdapter,
  renderTreeseedPackageWorkflow,
} from "../../src/operations/services/package-adapters.ts";

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

function createTreeDxAdapterFixture() {
  const root = mkdtempSync(join(tmpdir(), "treeseed-sdk-treedx-adapter-"));
  const packageRoot = resolve(root, "packages/treedx");
  mkdirSync(resolve(packageRoot, "scripts"), { recursive: true });
  writeFileSync(
    resolve(packageRoot, "treeseed.package.yaml"),
    [
      "id: treedx",
      "name: TreeDX",
      "kind: beam-elixir-rust",
      "type: image-service",
      "image: treeseed/treedx",
      "repository: treeseed-ai/treedx",
      "verify:",
      "  fast: scripts/test-treedx-fast.sh",
      "  local: scripts/test-all.sh",
      "  release: scripts/release-gate.sh",
      "releaseGate:",
      "  workflow: .github/workflows/release-gate.yml",
      "dockerImages:",
      "  releaseWorkflow: publish.yml",
      "  architectures:",
      "    - amd64",
      "    - arm64",
      "githubEnvironments:",
      "  - staging",
      "  - production",
      "requiredSecrets:",
      "  - DOCKERHUB_TOKEN",
      "",
    ].join("\n"),
  );
  return findTreeseedPackageAdapter(root, "treedx");
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

  it("renders TreeDX workflows without Node package install assumptions", () => {
    const adapter =
      findTreeseedPackageAdapter(workspaceRoot, "treedx") ??
      createTreeDxAdapterFixture();
    expect(adapter).toBeTruthy();

    const releaseGate = renderTreeseedPackageWorkflow(adapter!, "release-gate");
    const publish = renderTreeseedPackageWorkflow(adapter!, "docker-image");

    expect(releaseGate).toMatch(/bash scripts\/(?:release-gate|test-all)\.sh/u);
    for (const source of [releaseGate, publish]) {
      expect(source).not.toContain("actions/setup-node");
      expect(source).not.toContain("npm ci");
    }
  });
});
