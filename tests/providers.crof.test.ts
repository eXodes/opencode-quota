import { describe, expect, it, vi } from "vitest";

import {
  expectAttemptedWithErrorLabel,
  expectAttemptedWithNoErrors,
  expectNotAttempted,
} from "./helpers/provider-assertions.js";
import { crofProvider } from "../src/providers/crof.js";

vi.mock("../src/lib/crof.js", () => ({
  queryCrofQuota: vi.fn(),
  hasCrofApiKeyConfigured: vi.fn(),
  formatCrofCreditsValue: vi.fn((credits: number) => `${credits} credits`),
}));

vi.mock("../src/lib/provider-availability.js", () => ({
  isCanonicalProviderAvailable: vi.fn(),
}));

describe("crof provider", () => {
  it("returns attempted:false when not configured", async () => {
    const { queryCrofQuota } = await import("../src/lib/crof.js");
    (queryCrofQuota as any).mockResolvedValueOnce(null);

    const out = await crofProvider.fetch({} as any);
    expectNotAttempted(out);
  });

  it("maps success into request and credit rows", async () => {
    const { queryCrofQuota } = await import("../src/lib/crof.js");
    (queryCrofQuota as any).mockResolvedValueOnce({
      success: true,
      credits: -1.25,
      requestsPlan: 500,
      usableRequests: 469,
      percentRemaining: 94,
    });

    const out = await crofProvider.fetch({ config: {} } as any);
    expectAttemptedWithNoErrors(out);
    expect(out.entries).toEqual([
      {
        name: "Crof Requests",
        group: "Crof",
        label: "Requests:",
        right: "469/500",
        percentRemaining: 94,
      },
      {
        kind: "value",
        name: "Crof Credits",
        group: "Crof",
        label: "Credits:",
        value: "-1.25 credits",
      },
    ]);
  });

  it("maps errors into toast errors", async () => {
    const { queryCrofQuota } = await import("../src/lib/crof.js");
    (queryCrofQuota as any).mockResolvedValueOnce({
      success: false,
      error: "Unauthorized",
    });

    const out = await crofProvider.fetch({} as any);
    expectAttemptedWithErrorLabel(out, "Crof");
  });

  it("matches Crof runtime model ids", () => {
    expect(crofProvider.matchesCurrentModel?.("crof/model")).toBe(true);
    expect(crofProvider.matchesCurrentModel?.("crof-ai/model")).toBe(true);
    expect(crofProvider.matchesCurrentModel?.("nahcrof/model")).toBe(true);
    expect(crofProvider.matchesCurrentModel?.("openai/gpt-5")).toBe(false);
  });

  it("is available when crof provider ids are reported by metadata", async () => {
    const { isCanonicalProviderAvailable } = await import("../src/lib/provider-availability.js");
    (isCanonicalProviderAvailable as any).mockResolvedValueOnce(true);

    await expect(crofProvider.isAvailable({} as any)).resolves.toBe(true);
    expect(isCanonicalProviderAvailable).toHaveBeenCalledWith({
      ctx: {},
      providerId: "crof",
      fallbackOnError: false,
    });
  });

  it("falls back to trusted API key presence when provider ids are absent", async () => {
    const { isCanonicalProviderAvailable } = await import("../src/lib/provider-availability.js");
    const { hasCrofApiKeyConfigured } = await import("../src/lib/crof.js");
    (isCanonicalProviderAvailable as any).mockResolvedValueOnce(false);
    (hasCrofApiKeyConfigured as any).mockResolvedValueOnce(true);

    await expect(crofProvider.isAvailable({} as any)).resolves.toBe(true);
  });
});
