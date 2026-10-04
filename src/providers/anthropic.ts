import { sanitizeDisplayText } from "../core.js";
import type { UsageBucket, UsageReport } from "../types.js";

const WINDOWS = [
	["five_hour", "Five-hour", 300],
	["seven_day", "Weekly", 10080],
	["seven_day_sonnet", "Weekly Sonnet", 10080],
	["seven_day_opus", "Weekly Opus", 10080],
	["seven_day_oauth_apps", "Weekly OAuth apps", 10080],
] as const;

export function normalizeAnthropicUsagePayload(
	payload: Record<string, unknown>,
	capturedAt: number,
): UsageReport {
	const buckets: UsageBucket[] = [];
	for (const [id, label, windowMinutes] of WINDOWS) {
		const raw = payload[id];
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const window = raw as Record<string, unknown>;
		const used = window.utilization;
		if (typeof used !== "number" || !Number.isFinite(used) || used < 0) continue;
		const reset = typeof window.resets_at === "string" ? Date.parse(window.resets_at) : NaN;
		buckets.push({
			id,
			label,
			used,
			remaining: Math.max(0, 100 - used),
			limit: 100,
			unit: "percent",
			windowMinutes,
			...(Number.isFinite(reset) ? { resetsAt: Math.floor(reset / 1000) } : {}),
		});
	}
	if (Array.isArray(payload.limits)) {
		const structured: UsageBucket[] = [];
		for (const [index, raw] of payload.limits.entries()) {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
			const limit = raw as Record<string, unknown>;
			const used = limit.percent;
			if (typeof used !== "number" || !Number.isFinite(used) || used < 0) continue;
			if (!["session", "weekly_all", "weekly_scoped"].includes(String(limit.kind))) continue;
			const scope = limit.scope as { model?: { display_name?: unknown } } | undefined;
			const name =
				typeof scope?.model?.display_name === "string"
					? sanitizeDisplayText(scope.model.display_name, 80)
					: "Scoped";
			const label =
				limit.kind === "session"
					? "Session"
					: limit.kind === "weekly_all"
						? "Weekly"
						: `Weekly ${name}`;
			const reset = typeof limit.resets_at === "string" ? Date.parse(limit.resets_at) : NaN;
			structured.push({
				id: `limit-${index}`,
				label,
				used,
				remaining: Math.max(0, 100 - used),
				limit: 100,
				unit: "percent",
				...(limit.kind !== "session" ? { windowMinutes: 10080 } : {}),
				...(Number.isFinite(reset) ? { resetsAt: Math.floor(reset / 1000) } : {}),
			});
		}
		if (structured.length) buckets.splice(0, buckets.length, ...structured);
	}
	if (!buckets.length) throw new Error("Claude usage endpoint returned no displayable usage data.");
	return {
		providerId: "anthropic",
		providerName: "Claude",
		capturedAt,
		source: "anthropic-oauth-usage",
		semantics: { kind: "consumer-subscription", label: "Claude subscription limits" },
		buckets,
		metrics: [],
		notes: [
			"Subscription usage uses an undocumented Anthropic endpoint; API-key billing and extra-usage spending are not included.",
		],
	};
}
