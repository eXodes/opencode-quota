/**
 * Crof.ai provider wrapper.
 */

import type {
  QuotaProvider,
  QuotaProviderContext,
  QuotaProviderResult,
  QuotaToastEntry,
} from "../lib/entries.js";
import { formatCrofCreditsValue, hasCrofApiKeyConfigured, queryCrofQuota } from "../lib/crof.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import { modelProviderMatchesRuntimeId } from "../lib/provider-model-matching.js";
import { attemptedErrorResult, attemptedResult, notAttemptedResult } from "./result-helpers.js";

function formatRequestAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(Math.trunc(value));
  return value.toFixed(2).replace(/\.?0+$/u, "");
}

export const crofProvider: QuotaProvider = {
  id: "crof",

  async isAvailable(ctx: QuotaProviderContext): Promise<boolean> {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "crof",
      fallbackOnError: false,
    });
    if (providerAvailable) return true;

    return await hasCrofApiKeyConfigured();
  },

  matchesCurrentModel(model: string): boolean {
    return modelProviderMatchesRuntimeId(model, "crof");
  },

  async fetch(ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    const result = await queryCrofQuota({ requestTimeoutMs: ctx.config?.requestTimeoutMs });

    if (!result) {
      return notAttemptedResult();
    }

    if (!result.success) {
      return attemptedErrorResult("Crof", result.error);
    }

    const entries: QuotaToastEntry[] = [
      {
        name: "Crof Requests",
        group: "Crof",
        label: "Requests:",
        right: `${formatRequestAmount(result.usableRequests)}/${formatRequestAmount(result.requestsPlan)}`,
        percentRemaining: result.percentRemaining,
      },
      {
        kind: "value",
        name: "Crof Credits",
        group: "Crof",
        label: "Credits:",
        value: formatCrofCreditsValue(result.credits),
      },
    ];

    return attemptedResult(entries);
  },
};
