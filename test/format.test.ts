import assert from "node:assert/strict";
import { test } from "vitest";
import { formatUsageReport, formatUsageStatusline } from "../src/format.js";
import { normalizeCodexBackendPayload } from "../src/providers/codex.js";
import { normalizeGitHubCopilotUsagePayload } from "../src/providers/github-copilot.js";
import { normalizeOpenRouterKeyPayload } from "../src/providers/openrouter.js";

const countFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 20 });
const formatCount = (value: number) => countFormatter.format(value);

for (const balance of [0, 999, 1_000, 1_234_567.890123] as const) {
	const formatted = formatCount(balance);
	test(`formatUsage formats Codex credit balance ${balance} in status and detailed reports`, () => {
		const report = normalizeCodexBackendPayload(
			{ credits: { has_credits: true, balance: String(balance) } },
			0,
		);
		assert.equal(formatUsageStatusline(report), `${formatted} credits`);
		assert.ok(formatUsageReport(report, "current").endsWith(formatted));
	});
}

test("formatUsage preserves nonnumeric Codex credit states", () => {
	for (const [credits, status, detail] of [
		[{ has_credits: false }, "no credits", "none"],
		[{ has_credits: true }, "credits available", "available"],
		[{ has_credits: true, unlimited: true }, "credits unlimited", "unlimited"],
	] as const) {
		const report = normalizeCodexBackendPayload({ credits }, 0);
		assert.equal(formatUsageStatusline(report), status);
		assert.ok(formatUsageReport(report, "configured").endsWith(detail));
	}
});

for (const tokenBasedBilling of [true, false]) {
	const kind = tokenBasedBilling ? "credits " : "";
	const label = tokenBasedBilling ? "AI credits" : "Premium requests";
	test(`formatUsage groups Copilot ${label} counts without rounding fractions`, () => {
		const report = normalizeGitHubCopilotUsagePayload(
			{
				quota_snapshots: {
					premium_interactions: {
						token_based_billing: tokenBasedBilling,
						credits_used: 1_234.56789,
						entitlement: 10_000,
						remaining: 8_765.43211,
					},
				},
			},
			0,
		);
		assert.equal(
			formatUsageStatusline(report),
			`${kind}${formatCount(1_234.56789)}/${formatCount(10_000)} 12%`,
		);
		assert.ok(
			formatUsageReport(report, "current").includes(
				`${formatCount(1_234.56789)} of ${formatCount(10_000)} used · 12%`,
			),
		);
	});

	test(`formatUsage groups Copilot ${label} overage while capping included usage`, () => {
		const report = normalizeGitHubCopilotUsagePayload(
			{
				quota_snapshots: {
					premium_interactions: {
						token_based_billing: tokenBasedBilling,
						entitlement: 10_000,
						remaining: -1_234.5,
					},
				},
			},
			0,
		);
		assert.equal(
			formatUsageStatusline(report),
			`${kind}${formatCount(10_000)}/${formatCount(10_000)} 100% +${formatCount(1_234.5)} over`,
		);
		const detail = formatUsageReport(report, "configured");
		assert.ok(detail.includes(`${formatCount(10_000)} of ${formatCount(10_000)} used · 100%`));
		assert.ok(detail.endsWith(`${formatCount(1_234.5)} ${label}`));
	});
}

test("formatUsage groups Copilot chat quota counts", () => {
	const report = normalizeGitHubCopilotUsagePayload(
		{ limited_user_quotas: { chat: 8_000 }, monthly_quotas: { chat: 10_000 } },
		0,
	);
	assert.equal(
		formatUsageStatusline(report),
		`chat ${formatCount(2_000)}/${formatCount(10_000)} 20%`,
	);
	assert.ok(
		formatUsageReport(report, "current").includes(
			`${formatCount(2_000)} of ${formatCount(10_000)} used · 20%`,
		),
	);
});

test("formatUsage leaves dollar amounts unchanged", () => {
	const report = normalizeOpenRouterKeyPayload(
		{ data: { limit: 10_000, limit_remaining: 1_234.5, usage: 8_765.5 } },
		0,
	);
	assert.equal(formatUsageStatusline(report), "$1234.50 left");
	assert.match(formatUsageReport(report, "current"), /\$1234\.50 of \$10000\.00 left/u);
	assert.match(formatUsageReport(report, "current"), /\$8765\.50/u);
});
