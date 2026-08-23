import {
	type ExtensionContext,
	FooterComponent,
	type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { MUTED_USAGE_COLORS, usageStatusColor } from "./format.js";

const USAGE_STATUS_KEY = "usage";
type FooterSession = ConstructorParameters<typeof FooterComponent>[0];

/** Install the built-in footer with pi-usage on a dedicated status line. */
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
				const truncatedStats = truncateToWidth(stats, width, "");
				const contextPercent = /(\d+(?:\.\d+)?)%(?=\/\S)/u.exec(truncatedStats);
				if (contextPercent?.index !== undefined) {
					const percentage = contextPercent[0];
					const remaining = 100 - Number(contextPercent[1]);
					const before = truncatedStats.slice(0, contextPercent.index);
					const after = truncatedStats.slice(contextPercent.index + percentage.length);
					lines[1] = `${theme.fg("dim", before)}${MUTED_USAGE_COLORS[usageStatusColor(remaining)]}${percentage}\u001b[39m${theme.fg("dim", after)}`;
				} else {
					lines[1] = theme.fg("dim", truncatedStats);
				}
				const usageText = footerData.getExtensionStatuses().get(USAGE_STATUS_KEY);
				if (usageText) lines.splice(2, 0, truncateToWidth(usageText, width, ""));
				return lines;
			},
		};
	});
}
