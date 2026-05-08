/**
 * Zhipu provider wrapper.
 *
 * Normalizes Zhipu quota into generic toast entries.
 */

import type {
  QuotaProvider,
  QuotaProviderContext,
  QuotaProviderResult,
  QuotaToastEntry,
} from "../lib/entries.js";
import { queryZhipuQuota } from "../lib/zhipu.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import {
  DEFAULT_ZHIPU_AUTH_CACHE_MAX_AGE_MS,
  resolveZhipuAuthCached,
} from "../lib/zhipu-auth.js";
import { attemptedErrorResult, attemptedResult, notAttemptedResult } from "./result-helpers.js";

export const zhipuProvider: QuotaProvider = {
  id: "zhipu",

  async isAvailable(ctx: QuotaProviderContext): Promise<boolean> {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "zhipu",
      fallbackOnError: false,
    });
    if (!providerAvailable) {
      return false;
    }

    const auth = await resolveZhipuAuthCached({
      maxAgeMs: DEFAULT_ZHIPU_AUTH_CACHE_MAX_AGE_MS,
    });
    return auth.state === "configured" || auth.state === "invalid";
  },

  matchesCurrentModel(model: string): boolean {
    const lower = model.toLowerCase();
    const provider = lower.split("/")[0];
    return !!provider && (provider.includes("zhipu") || provider === "glm-coding-plan");
  },

  async fetch(ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    const result = await queryZhipuQuota({ requestTimeoutMs: ctx.config?.requestTimeoutMs });

    if (!result) {
      return notAttemptedResult();
    }

    if (!result.success) {
      return attemptedErrorResult("Zhipu", result.error);
    }

    const entries: QuotaToastEntry[] = [];
    const group = result.label;

    const fiveHour = result.windows.fiveHour;
    if (fiveHour) {
      entries.push({
        name: `${group} 5h`,
        group,
        label: "5h:",
        percentRemaining: fiveHour.percentRemaining,
        resetTimeIso: fiveHour.resetTimeIso,
      });
    }

    const weekly = result.windows.weekly;
    if (weekly) {
      entries.push({
        name: `${group} Weekly`,
        group,
        label: "Weekly:",
        percentRemaining: weekly.percentRemaining,
        resetTimeIso: weekly.resetTimeIso,
      });
    }

    const mcp = result.windows.mcp;
    if (mcp) {
      entries.push({
        name: `${group} MCP`,
        group,
        label: "MCP:",
        percentRemaining: mcp.percentRemaining,
        resetTimeIso: mcp.resetTimeIso,
      });
    }

    if (entries.length === 0) {
      entries.push({ name: result.label, percentRemaining: 0 });
    }

    return attemptedResult(entries, [], {
      singleWindowDisplayName: result.label,
    });
  },
};
