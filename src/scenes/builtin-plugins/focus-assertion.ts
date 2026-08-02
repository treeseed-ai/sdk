import type { SceneSelector } from "../types.ts";
import { sceneErrorDiagnostic } from "../support/reporting/diagnostics.ts";
import { assertionReport } from "./duration.ts";

export async function assertSceneFocus({
  value,
  stepId,
  resolveSelector,
}: {
  value: unknown;
  stepId: string;
  resolveSelector: (selector: SceneSelector) => any;
}) {
  const selector = value as SceneSelector;
  return assertionReport(
    "focused",
    async () => {
      const locator = resolveSelector(selector);
      const element = locator.first ? locator.first() : locator;
      if (
        !(await element.evaluate(
          (node: Element) => node === document.activeElement,
        ))
      ) {
        throw sceneErrorDiagnostic(
          "scene.focus_mismatch",
          "Expected selector to own keyboard focus.",
          `workflow.${stepId}.expect.focused`,
        );
      }
    },
    selector,
  );
}
