import type {
	SceneBrowserAdapter,
	SceneBrowserLaunchInput,
	SceneBrowserSession,
} from '../types.ts';

function normalizePlaywrightError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? 'Unknown Playwright error.');
	const missingBrowser = /Executable doesn't exist|browserType\.launch|playwright install/iu.test(message);
	const tagged = new Error(message) as Error & { sceneCode?: string };
	tagged.sceneCode = missingBrowser ? 'scene.playwright_browser_missing' : 'scene.playwright_unavailable';
	return tagged;
}

export function createPlaywrightSceneBrowserAdapter(): SceneBrowserAdapter {
	return {
		async launch(input: SceneBrowserLaunchInput): Promise<SceneBrowserSession> {
			let playwright: any;
			try {
				playwright = await import('playwright');
			} catch (error) {
				throw normalizePlaywrightError(error);
			}
			const browserType = playwright[input.browser];
			if (!browserType) {
				throw new Error(`Unsupported Playwright browser: ${input.browser}`);
			}
			try {
				const browser = await browserType.launch();
				const context = await browser.newContext({
					viewport: input.viewport,
					screen: input.viewport,
					deviceScaleFactor: input.deviceScaleFactor ?? 1,
					isMobile: input.isMobile ?? false,
					hasTouch: input.hasTouch ?? false,
					...(input.userAgent ? { userAgent: input.userAgent } : {}),
					...(input.recordVideoDir ? { recordVideo: { dir: input.recordVideoDir, size: input.videoSize ?? input.viewport } } : {}),
				});
				const page = await context.newPage();
				const video = page.video?.() ?? null;
				return {
					page,
					async startTracing() {
						await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
					},
					async stopTracing(tracePath: string) {
						await context.tracing.stop({ path: tracePath });
					},
					async videoPaths() {
						if (!video) return [];
						try {
							return [await video.path()];
						} catch {
							return [];
						}
					},
					async close() {
						await context.close().catch(() => undefined);
						await browser.close().catch(() => undefined);
					},
				};
			} catch (error) {
				throw normalizePlaywrightError(error);
			}
		},
	};
}
