import type {
	ProviderUsageState,
	UsageBucket,
	UsageDisplayState,
	UsageModel,
	UsageReport,
} from "./types.js";

export type UsageStatusColor = "success" | "warning" | "error";

type UsageStatusStyler = {
	color: (color: UsageStatusColor, text: string) => string;
	dim: (text: string) => string;
};

const BAR_SEGMENTS = 20;
const VALUE_COLUMN = 29;
const COMPACT_MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

export function formatUsageReport(report: UsageReport, displayState: UsageDisplayState): string {
	const stateLabel = displayState === "current" ? "Current" : "Configured";
	const lines = [`${report.providerName} Usage · ${stateLabel}`];
	if (report.accountLabel) lines.push(`Account: ${report.accountLabel}`);
	lines.push(`Semantics: ${report.semantics.label}`, "");

	if (report.providerId === "openai-codex") formatCodexReport(lines, report);
	else if (report.providerId === "github-copilot") formatGitHubCopilotReport(lines, report);
	else if (report.providerId === "openrouter") formatOpenRouterReport(lines, report);
	else if (report.providerId === "opencode-go") formatOpenCodeZenReport(lines, report);
	else formatGenericReport(lines, report);

	if (report.notes) {
		for (const note of report.notes) lines.push(note);
	}
	return lines.join("\n").trimEnd();
}

export function formatUsageStatusline(report: UsageReport, model?: UsageModel): string | undefined {
	if (report.providerId === "openai-codex") return formatCodexStatusline(report, model);
	if (report.providerId === "github-copilot") return formatGitHubCopilotStatusline(report);
	if (report.providerId === "openrouter") {
		const limit = report.buckets.find((bucket) => bucket.id === "key-limit");
		if (limit?.remaining !== undefined) return `${formatUsd(limit.remaining)} left`;
		const total = report.metrics.find((metric) => metric.id === "usage-total");
		if (typeof total?.value === "number") return `${formatUsd(total.value)} used`;
	}
	if (report.providerId === "opencode-go") return formatOpenCodeZenStatusline(report);
	return undefined;
}

export function styleUsageStatusline(
	value: string,
	report: UsageReport,
	styler: UsageStatusStyler,
): string {
	const percentagePattern = /(\d+(?:\.\d+)?)%/gu;
	const isUsedPercentage = report.providerId === "opencode-go";
	let cursor = 0;
	let styled = "";
	for (const match of value.matchAll(percentagePattern)) {
		const index = match.index ?? 0;
		const numeric = Number(match[1]);
		const remaining = isUsedPercentage ? 100 - numeric : numeric;
		const color = remaining >= 70 ? "success" : remaining >= 30 ? "warning" : "error";
		styled += styler.dim(value.slice(cursor, index));
		styled += styler.color(color, match[0]);
		cursor = index + match[0].length;
	}
	return `${styled}${styler.dim(value.slice(cursor))}`;
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
	const percent = percentRemaining(quota);
	const reset = quota.resetsAt ? ` (resets ${formatReset(quota.resetsAt)})` : "";
	lines.push(
		`${`${quota.label}:`.padEnd(VALUE_COLUMN)}${quota.remaining} of ${quota.limit} left · ${percent}%${reset}`,
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
	return `${kind === "premium" ? "" : `${kind} `}${quota.remaining}/${quota.limit} ${percentRemaining(quota)}%${overageSuffix}`;
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

function percentRemaining(bucket: UsageBucket): number {
	if (!bucket.limit || bucket.remaining === undefined) return 0;
	return Math.round(clampPercent((bucket.remaining / bucket.limit) * 100));
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

function formatCodexStatusline(report: UsageReport, model?: UsageModel): string | undefined {
	const group = selectCodexGroup(report, model);
	if (!group) return formatCodexCreditsStatus(report);
	const buckets = report.buckets.filter((bucket) => (bucket.groupId ?? bucket.id) === group);
	const parts: string[] = [];
	for (const bucket of buckets) {
		if (bucket.remaining === undefined) continue;
		const fallback = bucket.id.endsWith(":secondary") ? "weekly" : "5h";
		parts.push(
			`${clampPercent(bucket.remaining).toFixed(0)}% (${formatCompactReset(bucket, fallback)})`,
		);
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
	const remaining = clampPercent(bucket.remaining ?? 0);
	const filled = Math.round((remaining / 100) * BAR_SEGMENTS);
	const reset = bucket.resetsAt ? ` (resets ${formatReset(bucket.resetsAt)})` : "";
	return `[${"█".repeat(filled)}${"░".repeat(BAR_SEGMENTS - filled)}] ${remaining.toFixed(0)}% left${reset}`;
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

function formatCompactReset(bucket: UsageBucket, fallback: "5h" | "weekly"): string {
	if (bucket.resetsAt !== undefined) {
		const reset = new Date(bucket.resetsAt * 1000);
		if (!Number.isNaN(reset.getTime())) {
			const isShortWindow =
				bucket.windowMinutes !== undefined ? bucket.windowMinutes < 1_440 : fallback === "5h";
			const time = `${reset.getHours().toString().padStart(2, "0")}:${reset
				.getMinutes()
				.toString()
				.padStart(2, "0")}`;
			if (isShortWindow) return time;
			return `${COMPACT_MONTHS[reset.getMonth()]} ${reset.getDate()} ${time}`;
		}
	}
	return formatWindowLabel(bucket.windowMinutes, fallback, true);
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
