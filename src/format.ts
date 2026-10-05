import type {
	ProviderUsageState,
	UsageBucket,
	UsageDisplayState,
	UsageModel,
	UsageReport,
} from "./types.js";

export type UsageStatusColor = "success" | "warning" | "error";

export const MUTED_USAGE_COLORS: Record<UsageStatusColor, string> = {
	success: "\u001b[38;2;82;119;82m", // #527752
	warning: "\u001b[38;2;120;107;58m", // #786b3a
	error: "\u001b[38;2;144;92;87m", // #905c57
};

type UsageStatusStyler = {
	color: (color: UsageStatusColor, text: string) => string;
	dim: (text: string) => string;
};

const BAR_SEGMENTS = 20;
const VALUE_COLUMN = 29;

export function formatUsageReport(report: UsageReport, displayState: UsageDisplayState): string {
	const stateLabel = displayState === "current" ? "Current" : "Configured";
	const lines = [`${report.providerName} Usage · ${stateLabel}`];
	if (report.accountLabel) lines.push(`Account: ${report.accountLabel}`);
	lines.push(`Semantics: ${report.semantics.label}`, "");

	if (report.providerId === "openai-codex") formatCodexReport(lines, report);
	else if (report.providerId === "github-copilot") formatGitHubCopilotReport(lines, report);
	else if (report.providerId === "openrouter") formatOpenRouterReport(lines, report);
	else if (report.providerId === "opencode-go") formatOpenCodeZenReport(lines, report);
	else if (report.providerId === "anthropic") formatClaudeReport(lines, report);
	else formatGenericReport(lines, report);

	if (report.notes) {
		for (const note of report.notes) lines.push(note);
	}
	return lines.join("\n").trimEnd();
}

export function formatUsageStatusline(
	report: UsageReport,
	model?: UsageModel,
	now = Date.now(),
): string | undefined {
	if (report.providerId === "openai-codex") return formatCodexStatusline(report, model, now);
	if (report.providerId === "github-copilot") return formatGitHubCopilotStatusline(report);
	if (report.providerId === "openrouter") {
		const limit = report.buckets.find((bucket) => bucket.id === "key-limit");
		if (limit?.remaining !== undefined) return `${formatUsd(limit.remaining)} left`;
		const total = report.metrics.find((metric) => metric.id === "usage-total");
		if (typeof total?.value === "number") return `${formatUsd(total.value)} used`;
	}
	if (report.providerId === "opencode-go") return formatOpenCodeZenStatusline(report);
	if (report.providerId === "anthropic") return formatClaudeStatusline(report, now);
	return undefined;
}

export function styleUsageStatusline(
	value: string,
	_report: UsageReport,
	styler: UsageStatusStyler,
): string {
	const percentagePattern = /(\d+(?:\.\d+)?)%/gu;
	let cursor = 0;
	let styled = "";
	for (const match of value.matchAll(percentagePattern)) {
		const index = match.index ?? 0;
		const numeric = Number(match[1]);
		// Every statusline percentage is consumption, matching Pi's context percentage.
		const color = usageStatusColor(100 - numeric);
		styled += styler.dim(value.slice(cursor, index));
		styled += styler.color(color, match[0]);
		cursor = index + match[0].length;
	}
	return `${styled}${styler.dim(value.slice(cursor))}`;
}

export function usageStatusColor(remaining: number): UsageStatusColor {
	return remaining >= 70 ? "success" : remaining >= 30 ? "warning" : "error";
}

export function formatProviderStates(states: readonly ProviderUsageState[]): string {
	return states
		.map((state) => {
			if (state.status === "ready") return formatUsageReport(state.report, state.displayState);
			const label = state.displayState === "current" ? "Current" : "Configured";
			const status =
				state.status === "auth-unavailable"
					? "Authentication unavailable"
					: state.status === "unsupported"
						? "Unsupported"
						: "Query failed";
			return `${state.providerName} · ${label}\n${status}: ${state.message}`;
		})
		.join("\n\n");
}

function formatCodexReport(lines: string[], report: UsageReport): void {
	let previousGroup: string | undefined;
	for (const bucket of report.buckets) {
		const group = bucket.groupId ?? bucket.id;
		if (group !== previousGroup && group !== "codex") {
			lines.push(`${bucket.groupLabel ?? group} limit:`);
		}
		previousGroup = group;
		const fallback = bucket.id.endsWith(":secondary") ? "weekly" : "5h";
		const label = `${formatWindowLabel(bucket.windowMinutes, fallback, false)} limit:`;
		lines.push(`${label.padEnd(VALUE_COLUMN)}${formatPercentBucket(bucket)}`);
	}
	for (const metric of report.metrics) {
		if (metric.id === "reset-credits") {
			lines.push(`${"Usage limit resets:".padEnd(VALUE_COLUMN)}${metric.value} available`);
		} else if (metric.id === "credits") {
			lines.push(
				`${"Credits:".padEnd(VALUE_COLUMN)}${formatMetricValue(metric.value, metric.unit)}`,
			);
		}
	}
}

function formatGitHubCopilotReport(lines: string[], report: UsageReport): void {
	const quota = findGitHubCopilotQuota(report);
	if (!quota || quota.limit === undefined || quota.remaining === undefined) {
		lines.push(`${`${quota?.label ?? "Copilot quota"}:`.padEnd(VALUE_COLUMN)}unlimited`);
		return;
	}
	const percent = percentUsed(quota);
	const reset = quota.resetsAt ? ` (resets ${formatReset(quota.resetsAt)})` : "";
	lines.push(
		`${`${quota.label}:`.padEnd(VALUE_COLUMN)}${quotaUsed(quota)} of ${quota.limit} used · ${percent}%${reset}`,
	);
	const overage = report.metrics.find((metric) => metric.id === "overage-used");
	if (typeof overage?.value === "number" && overage.value > 0) {
		lines.push(`${"Additional usage:".padEnd(VALUE_COLUMN)}${overage.value} ${quota.label}`);
	}
}

function formatGitHubCopilotStatusline(report: UsageReport): string {
	const quota = findGitHubCopilotQuota(report);
	const kind = compactGitHubCopilotQuotaKind(quota);
	if (!quota || quota.limit === undefined || quota.remaining === undefined) {
		return `${kind} unlimited`;
	}
	const overage = report.metrics.find((metric) => metric.id === "overage-used");
	const overageSuffix =
		typeof overage?.value === "number" && overage.value > 0 ? ` +${overage.value} over` : "";
	return `${kind === "premium" ? "" : `${kind} `}${quotaUsed(quota)}/${quota.limit} ${percentUsed(quota)}%${overageSuffix}`;
}

function findGitHubCopilotQuota(report: UsageReport): UsageBucket | undefined {
	return report.buckets.find((bucket) =>
		["ai-credits", "premium-requests", "chat-requests"].includes(bucket.id),
	);
}

function compactGitHubCopilotQuotaKind(bucket: UsageBucket | undefined): string {
	if (bucket?.id === "ai-credits") return "credits";
	if (bucket?.id === "chat-requests") return "chat";
	return "premium";
}

// Capped at the allowance; usage beyond it is reported separately as overage.
function quotaUsed(bucket: UsageBucket): number {
	const limit = bucket.limit ?? 0;
	const used = bucket.used ?? limit - (bucket.remaining ?? 0);
	return Math.min(limit, Math.max(0, used));
}

function percentUsed(bucket: UsageBucket): number {
	if (!bucket.limit) return 0;
	return Math.round(clampPercent((quotaUsed(bucket) / bucket.limit) * 100));
}

function formatOpenRouterReport(lines: string[], report: UsageReport): void {
	const limit = report.buckets.find((bucket) => bucket.id === "key-limit");
	if (limit) {
		const period = limit.period ? ` (${limit.period})` : "";
		const value =
			limit.remaining === undefined
				? `${formatUsd(limit.limit ?? 0)} cap; remaining unavailable`
				: `${formatUsd(limit.remaining)} of ${formatUsd(limit.limit ?? 0)} left`;
		lines.push(`${`Key limit${period}:`.padEnd(VALUE_COLUMN)}${value}`);
	}
	for (const metric of report.metrics) {
		lines.push(
			`${`${metric.label}:`.padEnd(VALUE_COLUMN)}${formatMetricValue(metric.value, metric.unit)}`,
		);
	}
}

function formatOpenCodeZenReport(lines: string[], report: UsageReport): void {
	for (const bucket of report.buckets) {
		const reset = bucket.resetsAt ? ` (resets ${formatReset(bucket.resetsAt)})` : "";
		const used = bucket.used ?? "unavailable";
		lines.push(`${`${bucket.label}:`.padEnd(VALUE_COLUMN)}${used}% used${reset}`);
	}
}

function formatOpenCodeZenStatusline(report: UsageReport): string | undefined {
	const parts: string[] = [];
	for (const bucket of report.buckets) {
		if (bucket.used === undefined) continue;
		const compact = bucket.id === "rolling" ? "r" : bucket.id === "weekly" ? "w" : "m";
		parts.push(`${clampPercent(bucket.used).toFixed(0)}% (${compact})`);
	}
	return parts.length > 0 ? parts.join(" ") : undefined;
}

function formatClaudeReport(lines: string[], report: UsageReport): void {
	for (const bucket of report.buckets) {
		lines.push(`${`${bucket.label}:`.padEnd(VALUE_COLUMN)}${formatPercentBucket(bucket)}`);
	}
}

// Session and all-model weekly windows only; model-scoped weekly limits stay in /usage.
function formatClaudeStatusline(report: UsageReport, now: number): string | undefined {
	const parts: string[] = [];
	for (const bucket of report.buckets) {
		const compact =
			bucket.label === "Five-hour" ? "5h" : bucket.label === "Weekly" ? "wk" : undefined;
		const used = usedPercent(bucket);
		if (!compact || used === undefined) continue;
		const reset =
			bucket.resetsAt !== undefined && Number.isFinite(bucket.resetsAt)
				? compact === "5h"
					? ` (${formatHourResetCountdown(bucket.resetsAt, now)})`
					: ` (${formatResetCountdown(bucket, "weekly", now)})`
				: "";
		parts.push(`${used.toFixed(0)}% (${compact})${reset}`);
	}
	return parts.length > 0 ? parts.join(" ") : undefined;
}

function formatGenericReport(lines: string[], report: UsageReport): void {
	for (const bucket of report.buckets) {
		lines.push(
			`${`${bucket.label}:`.padEnd(VALUE_COLUMN)}${formatMetricValue(bucket.remaining ?? bucket.used ?? "unavailable", bucket.unit)}`,
		);
	}
	for (const metric of report.metrics) {
		lines.push(
			`${`${metric.label}:`.padEnd(VALUE_COLUMN)}${formatMetricValue(metric.value, metric.unit)}`,
		);
	}
}

function formatCodexStatusline(
	report: UsageReport,
	model: UsageModel | undefined,
	now: number,
): string | undefined {
	const group = selectCodexGroup(report, model);
	if (!group) return formatCodexCreditsStatus(report);
	const buckets = report.buckets.filter((bucket) => (bucket.groupId ?? bucket.id) === group);
	const parts: string[] = [];
	for (const bucket of buckets) {
		const used = usedPercent(bucket);
		if (used === undefined) continue;
		const fallback = bucket.id.endsWith(":secondary") ? "weekly" : "5h";
		parts.push(`${used.toFixed(0)}% (${formatResetCountdown(bucket, fallback, now)})`);
	}
	return parts.length > 0 ? parts.join(" ") : formatCodexCreditsStatus(report);
}

function formatCodexCreditsStatus(report: UsageReport): string {
	const credits = report.metrics.find((metric) => metric.id === "credits");
	if (!credits) return "usage unavailable";
	if (credits.value === "none") return "no credits";
	if (credits.value === "available") return "credits available";
	if (credits.value === "unlimited") return "credits unlimited";
	return `${formatMetricValue(credits.value, "count")} credits`;
}

function selectCodexGroup(report: UsageReport, model?: UsageModel): string | undefined {
	const groups = [...new Set(report.buckets.map((bucket) => bucket.groupId ?? bucket.id))];
	if (model?.provider !== "openai-codex") {
		return groups.includes("codex") ? "codex" : groups[0];
	}
	const modelKeys = normalizedModelKeys(model);
	for (const group of groups) {
		const bucket = report.buckets.find(
			(candidate) => (candidate.groupId ?? candidate.id) === group,
		);
		const keys = [group, bucket?.groupLabel, ...(bucket?.modelKeys ?? [])]
			.map(normalizeKey)
			.filter((key): key is string => key !== undefined);
		if (keys.some((key) => modelKeys.has(key))) return group;
	}
	const variants = [...modelKeys]
		.map((key) => key.match(/(?:^|-)codex-(.+)$/)?.[1])
		.filter((value): value is string => Boolean(value));
	for (const variant of variants) {
		const matches = groups.filter((group) => {
			if (group === "codex") return false;
			const key = normalizeKey(group);
			return key ? normalizedKeyHasToken(key, variant) : false;
		});
		if (matches.length === 1) return matches[0];
	}
	return groups.includes("codex") ? "codex" : groups[0];
}

function normalizedModelKeys(model: UsageModel): Set<string> {
	const keys = new Set<string>();
	for (const value of [model.id, model.name]) {
		const key = normalizeKey(value);
		if (!key) continue;
		keys.add(key);
		const index = key.indexOf("codex");
		if (index >= 0) keys.add(key.slice(index));
	}
	return keys;
}

function normalizeKey(value: string | undefined): string | undefined {
	const separated = value?.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	if (!separated) return undefined;
	let start = 0;
	let end = separated.length;
	while (separated[start] === "-") start += 1;
	while (end > start && separated[end - 1] === "-") end -= 1;
	return separated.slice(start, end) || undefined;
}

function normalizedKeyHasToken(key: string, token: string): boolean {
	return (
		key === token ||
		key.startsWith(`${token}-`) ||
		key.endsWith(`-${token}`) ||
		key.includes(`-${token}-`)
	);
}

function formatPercentBucket(bucket: UsageBucket): string {
	const used = usedPercent(bucket) ?? 0;
	const filled = Math.round((used / 100) * BAR_SEGMENTS);
	const reset = bucket.resetsAt ? ` (resets ${formatReset(bucket.resetsAt)})` : "";
	return `[${"█".repeat(filled)}${"░".repeat(BAR_SEGMENTS - filled)}] ${used.toFixed(0)}% used${reset}`;
}

function usedPercent(bucket: UsageBucket): number | undefined {
	if (bucket.used !== undefined) return clampPercent(bucket.used);
	if (bucket.remaining === undefined) return undefined;
	return clampPercent(100 - bucket.remaining);
}

function formatWindowLabel(
	minutes: number | undefined,
	fallback: "5h" | "weekly",
	compact: boolean,
): string {
	if (!minutes || !Number.isFinite(minutes) || minutes <= 0) {
		return compact && fallback === "weekly" ? "wk" : capitalize(fallback);
	}
	if (minutes === 10_080) return compact ? "wk" : "Weekly";
	if (minutes % 10_080 === 0) return `${minutes / 10_080}w`;
	if (minutes % 1_440 === 0) return `${minutes / 1_440}d`;
	if (minutes % 60 === 0) return `${minutes / 60}h`;
	return `${minutes}m`;
}

function formatResetCountdown(bucket: UsageBucket, fallback: "5h" | "weekly", now: number): string {
	if (bucket.resetsAt === undefined) {
		return formatWindowLabel(bucket.windowMinutes, fallback, true);
	}
	const remainingMs = bucket.resetsAt * 1000 - now;
	if (!Number.isFinite(remainingMs)) {
		return formatWindowLabel(bucket.windowMinutes, fallback, true);
	}
	if (remainingMs <= 0) return "reset due";
	const totalMinutes = Math.floor(remainingMs / 60_000);
	const days = Math.floor(totalMinutes / 1_440);
	const hours = Math.floor((totalMinutes % 1_440) / 60);
	const minutes = totalMinutes % 60;
	return `${days}d ${hours}h ${minutes}m`;
}

function formatHourResetCountdown(resetsAt: number, now: number): string {
	const remainingMs = resetsAt * 1000 - now;
	if (remainingMs <= 0) return "reset due";
	const totalMinutes = Math.floor(remainingMs / 60_000);
	return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

function formatMetricValue(value: number | string, unit: UsageBucket["unit"] | undefined): string {
	if (unit === "usd" && typeof value === "number") return formatUsd(value);
	return String(value);
}

function formatUsd(value: number): string {
	return `$${value.toFixed(2)}`;
}

function formatReset(epochSeconds: number): string {
	const reset = new Date(epochSeconds * 1000);
	if (Number.isNaN(reset.getTime())) return "at an unknown time";
	const time = `${reset.getHours().toString().padStart(2, "0")}:${reset
		.getMinutes()
		.toString()
		.padStart(2, "0")}`;
	const now = new Date();
	if (reset.toDateString() === now.toDateString()) return time;
	return `${time} on ${reset.getDate()} ${reset.toLocaleDateString(undefined, { month: "short" })}`;
}

function capitalize(value: string): string {
	return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}
