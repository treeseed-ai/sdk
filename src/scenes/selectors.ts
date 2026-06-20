import type { TreeseedSceneLocator, TreeseedScenePage, TreeseedSceneSelector } from './types.ts';

function escapeAttribute(value: string) {
	return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

export function describeTreeseedSceneSelector(selector: TreeseedSceneSelector) {
	if ('scene' in selector) return `data-scene=${selector.scene}`;
	if ('testId' in selector) return `data-testid=${selector.testId}`;
	if ('role' in selector) return selector.name ? `role=${selector.role} name=${selector.name}` : `role=${selector.role}`;
	if ('text' in selector) return `text=${selector.text}`;
	return `css=${selector.css}`;
}

export function resolveTreeseedSceneLocator(page: TreeseedScenePage, selector: TreeseedSceneSelector): TreeseedSceneLocator {
	if ('scene' in selector) return page.locator(`[data-scene="${escapeAttribute(selector.scene)}"]`);
	if ('testId' in selector) return page.getByTestId(selector.testId);
	if ('role' in selector) return page.getByRole(selector.role, selector.name ? { name: selector.name } : undefined);
	if ('text' in selector) return page.getByText(selector.text);
	return page.locator(selector.css);
}
