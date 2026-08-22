import {
	type ExtensionContext,
	FooterComponent,
	type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const USAGE_STATUS_KEY = "usage";
const USAGE_GAP = 2;

type FooterSession = ConstructorParameters<typeof FooterComponent>[0];

/** Install the built-in footer with pi-usage appended to its stats line. */
export function installUsageFooter(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;

	ctx.ui.setFooter((tui, _theme, footerData) => {
		const footerDataWithoutUsage: ReadonlyFooterDataProvider = {
			getGitBranch: () => footerData.getGitBranch(),
			getAvailableProviderCount: () => footerData.getAvailableProviderCount(),
			onBranchChange: (callback) => footerData.onBranchChange(callback),
			getExtensionStatuses: () => {
				const statuses = new Map(footerData.getExtensionStatuses());
				statuses.delete(USAGE_STATUS_KEY);
				return statuses;
			},
		};
		const session = {
			state: {
				get model() {
					return ctx.model;
				},
				get thinkingLevel() {
					return ctx.thinkingLevel;
				},
			},
			sessionManager: ctx.sessionManager,
			getContextUsage: () => ctx.getContextUsage(),
			modelRuntime: {
				isUsingSubscription: (provider: string) => provider === "kimi-coding",
			},
		} as unknown as FooterSession;
		const builtInFooter = new FooterComponent(session, footerDataWithoutUsage);
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

		return {
			dispose() {
				unsubscribe();
				builtInFooter.dispose();
			},
			invalidate() {},
			render(width: number): string[] {
				const lines = builtInFooter.render(width);
				const usage = footerData.getExtensionStatuses().get(USAGE_STATUS_KEY);
				if (!usage) return lines;

				const usageWidth = visibleWidth(usage);
				if (usageWidth >= width) {
					lines[1] = truncateToWidth(usage, width, "");
					return lines;
				}

				const secondLine = lines[1] ?? "";
				const availableForStats = Math.max(0, width - usageWidth - USAGE_GAP);
				const stats = truncateToWidth(secondLine, availableForStats, "");
				const padding = " ".repeat(Math.max(1, width - visibleWidth(stats) - usageWidth));
				lines[1] = `${stats}${padding}${usage}`;
				return lines;
			},
		};
	});
}
