import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { adapterForProvider, fetchProviderJson, resolveUsageAuth } from "./query.js";

// Cache only capabilities, never credentials; keys are salted resolved-auth fingerprints.
const CACHE_TTL_MS = 5 * 60_000;
// Catalog protocol compatibility version, not a model eligibility list.
// Matches the inspected Codex release; the backend uses this to shape metadata.
const CATALOG_CLIENT_VERSION = "0.162.0";
export function parseCodexFastCatalog(payload: Record<string, unknown>): ReadonlySet<string> {
	if (!Array.isArray(payload.models)) throw new Error("Codex catalog omitted models.");
	const supported = new Set<string>();
	for (const raw of payload.models) {
		if (!raw || typeof raw !== "object") continue;
		const model = raw as Record<string, unknown>;
		if (typeof model.slug !== "string") continue;
		const tiers = model.service_tiers;
		const fast =
			Array.isArray(tiers) &&
			tiers.some(
				(tier) => tier && typeof tier === "object" && ["priority", "fast"].includes(tier.id),
			);
		const legacy = !Array.isArray(tiers) || tiers.length === 0;
		if (
			fast ||
			(legacy &&
				Array.isArray(model.additional_speed_tiers) &&
				model.additional_speed_tiers.includes("fast"))
		) {
			supported.add(model.slug);
		}
	}
	return supported;
}

export function createCodexFastCatalog() {
	const cache = new Map<string, { models: ReadonlySet<string> | undefined; expires: number }>();
	const save = (key: string, models: ReadonlySet<string> | undefined, ttl: number) => {
		if (cache.size >= 8 && !cache.has(key)) cache.delete(cache.keys().next().value as string);
		cache.set(key, { models, expires: Date.now() + ttl });
	};
	return async (
		ctx: ExtensionContext,
		signal: AbortSignal,
	): Promise<ReadonlySet<string> | undefined> => {
		if (signal.aborted) return undefined;
		const adapter = adapterForProvider("openai-codex");
		if (!adapter) return undefined;
		let key: string | undefined;
		try {
			const auth = await resolveUsageAuth(ctx, adapter);
			if (!auth || signal.aborted) return undefined;
			key = auth.fingerprint;
			const cached = cache.get(key);
			if (cached && cached.expires > Date.now()) return cached.models;
			const payload = await fetchProviderJson(
				`https://chatgpt.com/backend-api/codex/models?client_version=${CATALOG_CLIENT_VERSION}`,
				auth,
				signal,
				10_000,
				"Codex model catalog",
				{ maxSuccessBodyBytes: 4 * 1024 * 1024, redirect: "error" },
			);
			signal.throwIfAborted();
			const models = parseCodexFastCatalog(payload);
			save(key, models, CACHE_TTL_MS);
			return models;
		} catch {
			if (signal.aborted) return undefined;
			const fallback = key ? cache.get(key)?.models : undefined;
			// Avoid adding a failed ten-second catalog lookup to every model request.
			if (key) save(key, fallback, 30_000);
			return fallback;
		}
	};
}
