import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
	codexFastAvailability,
	correctCodexFastMessageCost,
	rewriteCodexFastPayload,
} from "../src/codex-fast.js";
import { createCodexFastCatalog, parseCodexFastCatalog } from "../src/codex-fast-catalog.js";
import { createMockContext } from "../test-support.js";

const model = {
	id: "gpt-6.1-sol",
	provider: "openai-codex",
	api: "openai-codex-responses",
	cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
	baseUrl: "https://chatgpt.com/backend-api",
};
const payload = {
	models: [
		{ slug: "gpt-6.1-sol", service_tiers: [{ id: "priority" }] },
		{ slug: "future", service_tiers: [{ id: "fast" }] },
		{ slug: "legacy", additional_speed_tiers: ["fast"] },
		{ slug: "standard", service_tiers: [{ id: "default" }] },
		{
			slug: "explicit-standard",
			service_tiers: [{ id: "default" }],
			additional_speed_tiers: ["fast"],
		},
	],
};

test("catalog capabilities replace model-name assumptions and prefer modern tier metadata", () => {
	const supported = parseCodexFastCatalog(payload);
	assert.deepEqual([...supported], ["gpt-6.1-sol", "future", "legacy"]);
	assert.throws(() => parseCodexFastCatalog({}), /omitted models/);
	assert.equal(codexFastAvailability(model as never, true, supported).kind, "available");
	assert.deepEqual(rewriteCodexFastPayload({ model: model.id }, model as never, true, supported), {
		model: model.id,
		service_tier: "priority",
	});
	assert.match(
		(codexFastAvailability(model as never, true) as { reason: string }).reason,
		/Could not verify/,
	);
	assert.equal(
		correctCodexFastMessageCost(
			{
				role: "assistant",
				provider: model.provider,
				model: model.id,
				usage: {
					input: 100,
					output: 20,
					cacheRead: 10,
					cacheWrite: 0,
					cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 0, total: 6 },
				},
			},
			model as never,
			true,
		),
		undefined,
	);
});

test("catalog caches per resolved account, refreshes, and uses same-account fallback only", async (t) => {
	const originalFetch = globalThis.fetch;
	t.onTestFinished(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});
	let token = "account-a";
	const { ctx } = createMockContext({
		model,
		modelRegistry: {
			getAvailable: () => [model],
			getAll: () => [model],
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: token }),
			getProviderAuth: async () => ({ auth: { apiKey: token } }),
		},
	});
	let calls = 0;
	globalThis.fetch = async (url, options) => {
		calls++;
		assert.match(String(url), /backend-api\/codex\/models\?client_version=/);
		assert.equal(options?.redirect, "error");
		return new Response(JSON.stringify(payload));
	};
	const load = createCodexFastCatalog();
	const signal = new AbortController().signal;
	assert.ok((await load(ctx, signal))?.has(model.id));
	await load(ctx, signal);
	assert.equal(calls, 1);
	vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60_000);
	globalThis.fetch = async () => {
		calls++;
		throw new Error("offline");
	};
	assert.ok((await load(ctx, signal))?.has(model.id));
	assert.equal(calls, 2);
	token = "account-b";
	assert.equal(await load(ctx, signal), undefined);
	const controller = new AbortController();
	controller.abort();
	token = "account-a";
	assert.equal(await load(ctx, controller.signal), undefined);
});
