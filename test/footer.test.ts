import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { test } from "vitest";
import { installUsageFooter } from "../src/footer.js";
import { MUTED_USAGE_COLORS } from "../src/format.js";
import { createMockContext } from "../test-support.js";

initTheme("dark", false);

test("usage status gets a dedicated third footer line", () => {
	const harness = createMockContext({
		hasUI: true,
		mode: "tui",
		model: {
			id: "test-model",
			provider: "openai-codex",
			contextWindow: 100_000,
		},
		sessionManager: {
			getCwd: () => "/tmp/project",
			getEntries: () => [],
			getSessionName: () => undefined,
		},
	});
	const { ctx } = harness;
	installUsageFooter(ctx);
	const footer = harness.footer;

	assert.equal(typeof footer, "function");
	const statuses = new Map([
		["other", "other status"],
		["usage", "70% (3d 7h 42m)"],
	]);
	const footerData = {
		getAvailableProviderCount: () => 1,
		getExtensionStatuses: () => statuses,
		getGitBranch: () => "main",
		onBranchChange: () => () => undefined,
	};
	const component = (
		footer as (...args: never[]) => { render(width: number): string[]; dispose(): void }
	)({ requestRender() {} }, ctx.ui.theme, footerData);

	const lines = component.render(100);
	assert.equal(lines.length, 4);
	assert.match(lines[1] ?? "", /\(auto\).*test-model$/u);
	assert.doesNotMatch(lines[1] ?? "", /70%|other status/u);
	assert.equal(lines[2], "70% (3d 7h 42m)");
	assert.equal(lines[3], "other status");
	component.dispose();
});

test("footer preserves model and thinking level across renders and terminal widths", () => {
	const harness = createMockContext({
		hasUI: true,
		mode: "tui",
		model: { id: "reasoning-model", provider: "openai-codex", reasoning: true },
		thinkingLevel: "medium",
		sessionManager: {
			getCwd: () => "/tmp/project",
			getEntries: () => [],
			getSessionName: () => undefined,
		},
	});
	installUsageFooter(harness.ctx);
	const footerData = {
		getAvailableProviderCount: () => 1,
		getExtensionStatuses: () => new Map<string, string>(),
		getGitBranch: () => undefined,
		onBranchChange: () => () => undefined,
	};
	const component = (
		harness.footer as (...args: never[]) => { render(width: number): string[]; dispose(): void }
	)({ requestRender() {} }, harness.ctx.ui.theme, footerData);
	const state = harness.ctx as unknown as {
		model: { id: string; provider: string; reasoning: boolean } | undefined;
		thinkingLevel: string;
	};
	for (const thinkingLevel of ["medium", "high", "off"]) {
		state.thinkingLevel = thinkingLevel;
		const line = stripTerminalSequences(component.render(100)[1] ?? "");
		assert.ok(
			line.endsWith(
				`reasoning-model • ${thinkingLevel === "off" ? "thinking off" : thinkingLevel}`,
			),
		);
	}
	for (const width of [10, 30, 60, 100]) {
		for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
	}
	state.model = { id: "replacement-model", provider: "openai-codex", reasoning: false };
	const replacementLine = stripTerminalSequences(component.render(100)[1] ?? "");
	assert.ok(replacementLine.endsWith("replacement-model"));
	assert.doesNotMatch(replacementLine, /reasoning-model|thinking off/u);
	state.model = undefined;
	assert.ok(stripTerminalSequences(component.render(100)[1] ?? "").endsWith("no-model"));
	component.dispose();
});

test("context usage follows the usage indicator color sequence", () => {
	const cases = [
		[30, MUTED_USAGE_COLORS.success],
		[31, MUTED_USAGE_COLORS.warning],
		[70, MUTED_USAGE_COLORS.warning],
		[71, MUTED_USAGE_COLORS.error],
	] as const;
	for (const [percent, color] of cases) {
		const harness = createMockContext({
			hasUI: true,
			mode: "tui",
			model: {
				id: "test-model",
				provider: "openai-codex",
				contextWindow: 100_000,
			},
			getContextUsage: () => ({ tokens: percent * 1_000, contextWindow: 100_000, percent }),
			sessionManager: {
				getCwd: () => "/tmp/project",
				getEntries: () => [],
				getSessionName: () => undefined,
			},
		});
		installUsageFooter(harness.ctx);
		const footerData = {
			getAvailableProviderCount: () => 1,
			getExtensionStatuses: () => new Map<string, string>(),
			getGitBranch: () => undefined,
			onBranchChange: () => () => undefined,
		};
		const component = (
			harness.footer as (...args: never[]) => { render(width: number): string[]; dispose(): void }
		)({ requestRender() {} }, harness.ctx.ui.theme, footerData);

		const lines = component.render(100);
		assert.ok(lines[1]?.includes(`${color}${percent.toFixed(1)}%\u001b[39m`));
		component.dispose();
	}
});
