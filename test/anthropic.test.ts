import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { test, vi } from "vitest";
import { formatUsageReport, formatUsageStatusline } from "../src/format.js";
import { normalizeAnthropicUsagePayload } from "../src/providers/anthropic.js";
import { adapterForProvider, resolveUsageAuth, usageProviderId } from "../src/query.js";

const credential = { type: "oauth", access: "claude-token" };
function context(baseUrl = "https://api.anthropic.com"): ExtensionContext {
	const model = { id: "claude-sonnet", provider: "anthropic", baseUrl };
	return {
		model,
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({
				ok: true,
				headers: { Authorization: `Bearer ${credential.access}` },
			}),
			getProviderAuth: async () => ({
				auth: { headers: { Authorization: `Bearer ${credential.access}` }, baseUrl },
			}),
			getAvailable: () => [model],
			getAll: () => [model],
		},
	} as unknown as ExtensionContext;
}

test("Claude normalizes valid windows and ignores invalid or absent quotas", () => {
	const report = normalizeAnthropicUsagePayload(
		{
			five_hour: { utilization: 25, resets_at: "2026-10-05T00:00:00Z" },
			seven_day: { utilization: 105, resets_at: "invalid" },
			seven_day_sonnet: null,
			seven_day_opus: { utilization: 0 },
			seven_day_oauth_apps: { utilization: "20" },
		},
		42,
	);
	assert.equal(report.capturedAt, 42);
	assert.equal(report.buckets.length, 3);
	assert.equal(report.buckets[0]?.remaining, 75);
	assert.equal(report.buckets[0]?.resetsAt, Date.parse("2026-10-05T00:00:00Z") / 1000);
	assert.equal(report.buckets[1]?.remaining, 0);
	assert.equal(report.buckets[1]?.resetsAt, undefined);
	assert.throws(() => normalizeAnthropicUsagePayload({}, 0), /no displayable/);
});

test("Claude only queries with matching Pi OAuth and forwards minimal headers", async () => {
	const adapter = adapterForProvider("anthropic");
	assert.ok(adapter);
	const auth = await resolveUsageAuth(context(), adapter, new Uint8Array(32), () => credential);
	assert.ok(auth);
	assert.deepEqual(auth.headers, {
		Authorization: "Bearer claude-token",
		"anthropic-beta": "oauth-2025-04-20",
	});
	const fetchMock = vi.fn(
		async () => new Response(JSON.stringify({ five_hour: { utilization: 20 } })),
	);
	vi.stubGlobal("fetch", fetchMock);
	try {
		const report = await adapter.query(auth, new AbortController().signal, 1000);
		assert.equal(report.providerId, "anthropic");
		assert.equal(fetchMock.mock.calls[0]?.[0], "https://api.anthropic.com/api/oauth/usage");
	} finally {
		vi.unstubAllGlobals();
	}
	for (const invalid of [
		{ type: "api_key", key: "claude-token" },
		{ ...credential, access: "other" },
	]) {
		await assert.rejects(
			resolveUsageAuth(context(), adapter, new Uint8Array(32), () => invalid),
			/matching Pi Anthropic OAuth/,
		);
	}
	await assert.rejects(
		resolveUsageAuth(context("https://proxy.example"), adapter),
		/custom provider base URL/,
	);
});

function bridgeContext(authBaseUrl?: string): {
	ctx: ExtensionContext;
	requestedProviders: string[];
} {
	const bridgeModel = {
		id: "claude-opus-5-5",
		provider: "claude-bridge",
		baseUrl: "claude-bridge",
	};
	const anthropicModel = {
		id: "claude-opus-5-5",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
	};
	const requestedProviders: string[] = [];
	const ctx = {
		model: bridgeModel,
		modelRegistry: {
			getApiKeyAndHeaders: async () => {
				throw new Error("the bridge placeholder key must not be used");
			},
			getProviderAuth: async (providerId: string) => {
				requestedProviders.push(providerId);
				return {
					auth: {
						headers: { Authorization: `Bearer ${credential.access}` },
						...(authBaseUrl ? { baseUrl: authBaseUrl } : {}),
					},
				};
			},
			getAvailable: () => [bridgeModel],
			getAll: () => [bridgeModel, anthropicModel],
		},
	} as unknown as ExtensionContext;
	return { ctx, requestedProviders };
}

test("claude-bridge reports the Anthropic account whose credential the bridge receives", async () => {
	assert.equal(usageProviderId("claude-bridge"), "anthropic");
	const adapter = adapterForProvider("claude-bridge");
	assert.equal(adapter?.id, "anthropic");
	assert.ok(adapter);
	const { ctx, requestedProviders } = bridgeContext();
	const auth = await resolveUsageAuth(ctx, adapter, new Uint8Array(32), () => credential);
	assert.ok(auth);
	assert.deepEqual(requestedProviders, ["anthropic"]);
	assert.equal(auth.model.provider, "anthropic");
	assert.equal(auth.headers.Authorization, "Bearer claude-token");

	const proxied = bridgeContext("https://proxy.example");
	await assert.rejects(
		resolveUsageAuth(proxied.ctx, adapter, new Uint8Array(32), () => credential),
		/proxy-resolved credential/,
	);
});

test("Claude statusline shows used session and weekly allowance", () => {
	const legacy = normalizeAnthropicUsagePayload(
		{
			five_hour: { utilization: 25, resets_at: "2026-10-05T00:00:00Z" },
			seven_day: { utilization: 60 },
			seven_day_opus: { utilization: 90 },
		},
		1,
	);
	assert.equal(formatUsageStatusline(legacy), "25% (5h) 60% (wk)");
	assert.match(formatUsageReport(legacy, "current"), /Five-hour:.*25% used \(resets /);
	assert.match(formatUsageReport(legacy, "current"), /Weekly Opus:.*90% used/);

	const structured = normalizeAnthropicUsagePayload(
		{
			limits: [
				{ kind: "session", percent: 10 },
				{ kind: "weekly_all", percent: 30 },
				{ kind: "weekly_scoped", percent: 50, scope: { model: { display_name: "Opus" } } },
			],
		},
		1,
	);
	assert.equal(formatUsageStatusline(structured), "10% (session) 30% (wk)");
	assert.match(formatUsageReport(structured, "current"), /Weekly Opus:.*50% used/);
});
