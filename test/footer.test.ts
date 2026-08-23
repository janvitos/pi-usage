import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { installUsageFooter } from "../src/footer.js";
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
	assert.match(lines[1] ?? "", /\(auto\)$/u);
	assert.doesNotMatch(lines[1] ?? "", /test-model|70%|other status/u);
	assert.equal(lines[2], "70% (3d 7h 42m)");
	assert.equal(lines[3], "other status");
	component.dispose();
});
