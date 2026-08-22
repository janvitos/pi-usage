import {
	type ExtensionContext,
	FooterComponent,
	type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";

const USAGE_STATUS_KEY = "usage";
type FooterSession = ConstructorParameters<typeof FooterComponent>[0];

/** Install the built-in footer with pi-usage appended to its stats line. */
export function installUsageFooter(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;

	ctx.ui.setFooter((tui, theme, footerData) => {
		const footerDataWithoutUsage: ReadonlyFooterDataProvider = {
			getGitBranch: () => footerData.getGitBranch(),
			getAvailableProviderCount: () => 1,
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
				const secondLine = stripTerminalSequences(lines[1] ?? "");
				const model = ctx.model;
				const modelName = model?.id || "no-model";
				const thinkingLevel = ctx.thinkingLevel || "off";
				const modelText = model?.reasoning
					? `${modelName} • ${thinkingLevel === "off" ? "thinking off" : thinkingLevel}`
					: modelName;
				const stats = secondLine.endsWith(modelText)
					? secondLine.slice(0, -modelText.length).trimEnd()
					: secondLine.trimEnd();
				const usage = footerData.getExtensionStatuses().get(USAGE_STATUS_KEY);
				const usageText = usage ? stripTerminalSequences(usage) : "";
				const combined = usageText ? `${stats} ${usageText}` : stats;
				lines[1] = theme.fg("dim", truncateToWidth(combined, width, ""));
				return lines;
			},
		};
	});
}
