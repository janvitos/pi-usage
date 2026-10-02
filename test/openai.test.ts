import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { formatUsageReport, formatUsageStatusline } from "../src/format.js";
import { adapterForProvider, resolveUsageAuth } from "../src/query.js";

const model = {
	id: "gpt-5.4",
	name: "GPT-5.4",
	provider: "openai",
	api: "openai-responses",
	baseUrl: "https://api.openai.com/v1",
};
const credential = {
	type: "oauth" as const,
	access: "chatgpt-token",
	refresh: "refresh-token",
	expires: Date.now() + 60_000,
	scopes: ["chatgpt.tokens.use.direct"],
};
function context(baseUrl = model.baseUrl): ExtensionContext {
	const current = { ...model, baseUrl };
	return {
		model: current,
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: credential.access }),
			getProviderAuth: async () => ({ auth: { apiKey: credential.access } }),
			getAvailable: () => [current],
			getAll: () => [current],
		},
	} as unknown as ExtensionContext;
}

test("OpenAI recognizes its own ChatGPT OAuth without inventing Codex quotas", async () => {
	const adapter = adapterForProvider("openai");
	assert.ok(adapter);
	const auth = await resolveUsageAuth(context(), adapter, new Uint8Array(32), () => credential);
	assert.ok(auth);
	assert.equal(auth.model.provider, "openai");
	const report = await adapter.query(auth, new AbortController().signal, 1_000);
	assert.equal(report.providerId, "openai");
	assert.deepEqual(report.buckets, []);
	assert.equal(formatUsageStatusline(report), undefined);
	assert.match(formatUsageReport(report, "current"), /https:\/\/chatgpt.com\/settings\/usage/);
});

test("OpenAI rejects API keys, mismatched OAuth tokens, and missing direct-token scope", async () => {
	const adapter = adapterForProvider("openai");
	assert.ok(adapter);
	for (const invalid of [
		{ type: "api_key", key: credential.access },
		{ ...credential, access: "other-account" },
		{ ...credential, scopes: [] },
	]) {
		await assert.rejects(
			resolveUsageAuth(context(), adapter, new Uint8Array(32), () => invalid),
			/matching Sign in with ChatGPT OAuth/,
		);
	}
});

test("OpenAI rejects proxy origins before resolving credentials", async () => {
	const adapter = adapterForProvider("openai");
	assert.ok(adapter);
	await assert.rejects(
		resolveUsageAuth(context("https://proxy.example/v1"), adapter),
		/custom provider base URL/,
	);
});
