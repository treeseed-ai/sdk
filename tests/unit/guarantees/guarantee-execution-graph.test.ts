import { describe, expect, it } from "vitest";

import { buildExecutionGraphReport } from "../../../src/guarantees/index/run-guarantees.ts";

describe("guarantee execution graph", () => {
	it("collapses a dependency shared by one execution key without emitting a self-cycle", () => {
		const report = buildExecutionGraphReport({
			runId: "isolated-run",
			environment: "local",
			plan: [
				{
					id: "guarantee.user.auth.register-user.001",
					status: "active",
					selected: true,
					dependency: false,
					depth: 0,
					dependsOn: [],
					dependencyReasons: [],
					devices: ["desktop_chromium"],
					sceneManifest: "register.scene.yaml",
					sceneExecutionKey: "admin.identity.onboarding",
					producesState: ["identity.primary"],
					consumesState: [],
				},
				{
					id: "guarantee.user.auth.verify-email.002",
					status: "active",
					selected: true,
					dependency: false,
					depth: 1,
					dependsOn: ["guarantee.user.auth.register-user.001"],
					dependencyReasons: ["explicit"],
					devices: ["desktop_chromium"],
					sceneManifest: "register.scene.yaml",
					sceneExecutionKey: "admin.identity.onboarding",
					producesState: ["identity.primary"],
					consumesState: [],
				},
			],
			results: [],
		});

		expect(report.nodes).toHaveLength(1);
		expect(report.nodes[0]).toMatchObject({
			id: "admin.identity.onboarding@desktop_chromium",
			guaranteeIds: [
				"guarantee.user.auth.register-user.001",
				"guarantee.user.auth.verify-email.002",
			],
			dependsOn: [],
		});
	});
});
