/**
 * Crof.ai quota fetcher.
 *
 * Resolves API key from multiple sources and queries:
 * https://crof.ai/usage_api/
 */

import type { CrofResult } from "./types.js";
import { sanitizeDisplaySnippet, sanitizeDisplayText } from "./display-sanitize.js";
import { clampPercent } from "./format-utils.js";
import { fetchWithTimeout } from "./http.js";
import {
  getCrofKeyDiagnostics,
  hasCrofApiKey,
  resolveCrofApiKey,
  type CrofKeySource,
} from "./crof-config.js";

interface CrofUsageResponse {
  credits?: number;
  requests_plan?: number;
  usable_requests?: number;
}

const CROF_USAGE_URL = "https://crof.ai/usage_api/";
const USER_AGENT = "OpenCode-Quota-Toast/1.0";

export { getCrofKeyDiagnostics, hasCrofApiKey as hasCrofApiKeyConfigured, type CrofKeySource } from "./crof-config.js";

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseCrofUsage(data: unknown): Exclude<CrofResult, null | { success: false; error: string }> {
  if (!data || typeof data !== "object") {
    throw new Error("Crof API returned an unexpected response shape");
  }

  const response = data as CrofUsageResponse;
  const credits = getFiniteNumber(response.credits);
  const requestsPlan = getFiniteNumber(response.requests_plan);
  const usableRequests = getFiniteNumber(response.usable_requests);

  if (credits === undefined || requestsPlan === undefined || usableRequests === undefined) {
    throw new Error("Crof API returned an unexpected response shape");
  }

  return {
    success: true,
    credits,
    requestsPlan,
    usableRequests,
    percentRemaining: requestsPlan > 0 ? clampPercent((usableRequests / requestsPlan) * 100) : 0,
  };
}

export function formatCrofCreditsValue(credits: number): string {
  if (!Number.isFinite(credits)) return "0 credits";
  const value = Number.isInteger(credits) ? String(Math.trunc(credits)) : credits.toFixed(4).replace(/\.?0+$/u, "");
  return `${value} credits`;
}

export async function queryCrofQuota(options: { requestTimeoutMs?: number } = {}): Promise<CrofResult> {
  const resolved = await resolveCrofApiKey();
  if (!resolved) return null;

  try {
    const resp = await fetchWithTimeout(
      CROF_USAGE_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${resolved.key}`,
          "User-Agent": USER_AGENT,
        },
      },
      options.requestTimeoutMs,
    );

    if (!resp.ok) {
      const text = await resp.text();
      return {
        success: false,
        error: `Crof API error ${resp.status}: ${sanitizeDisplaySnippet(text, 120)}`,
      };
    }

    return parseCrofUsage(await resp.json());
  } catch (err) {
    return {
      success: false,
      error: sanitizeDisplayText(err instanceof Error ? err.message : String(err)),
    };
  }
}
