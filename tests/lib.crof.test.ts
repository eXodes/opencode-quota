import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { queryCrofQuota } from "../src/lib/crof.js";

vi.mock("../src/lib/opencode-auth.js", () => ({
  readAuthFile: vi.fn(),
}));

describe("queryCrofQuota", () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "opencode-quota-crof-"));
    process.env = { ...originalEnv, XDG_CONFIG_HOME: tempDir };
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns null when not configured", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValueOnce({});

    delete process.env.CROF_API_KEY;

    await expect(queryCrofQuota()).resolves.toBeNull();
  });

  it("returns usage data from API", async () => {
    process.env.CROF_API_KEY = "test-key";

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            credits: 12.3456,
            requests_plan: 500,
            usable_requests: 469,
          }),
          { status: 200 },
        ),
    ) as any;
    vi.stubGlobal("fetch", fetchMock);

    const out = await queryCrofQuota();
    expect(out).toEqual({
      success: true,
      credits: 12.3456,
      requestsPlan: 500,
      usableRequests: 469,
      percentRemaining: 94,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://crof.ai/usage_api/",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );
  });

  it("sanitizes API error text before returning it", async () => {
    process.env.CROF_API_KEY = "test-key";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized\u001b[31m", { status: 401 })) as any,
    );

    const out = await queryCrofQuota();
    expect(out && !out.success ? out.error : "").toBe("Crof API error 401: Unauthorized");
  });

  it("sanitizes malformed response errors", async () => {
    process.env.CROF_API_KEY = "test-key";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ credits: 1 }), { status: 200 })) as any,
    );

    const out = await queryCrofQuota();
    expect(out && !out.success ? out.error : "").toBe(
      "Crof API returned an unexpected response shape",
    );
  });

  it("ignores repo-local provider config for secret lookup", async () => {
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({
        provider: {
          crof: {
            options: {
              apiKey: "{env:CROF_API_KEY}",
            },
          },
        },
      }),
      "utf-8",
    );

    const out = await queryCrofQuota();
    expect(out).toBeNull();
  });

  it("reads crof api keys from trusted global config aliases", async () => {
    mkdirSync(join(tempDir, "opencode"), { recursive: true });
    writeFileSync(
      join(tempDir, "opencode", "opencode.json"),
      JSON.stringify({
        provider: {
          "crof-ai": {
            options: {
              apiKey: "global-config-key",
            },
          },
        },
      }),
      "utf-8",
    );

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            credits: -1,
            requests_plan: 500,
            usable_requests: 250,
          }),
          { status: 200 },
        ),
    ) as any;
    vi.stubGlobal("fetch", fetchMock);

    const out = await queryCrofQuota();
    expect(out && out.success ? out.percentRemaining : -1).toBe(50);
    expect(out && out.success ? out.credits : 0).toBe(-1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://crof.ai/usage_api/",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer global-config-key",
        }),
      }),
    );
  });

  it("rejects arbitrary env templates in trusted global config", async () => {
    process.env.GITHUB_TOKEN = "github-secret";
    mkdirSync(join(tempDir, "opencode"), { recursive: true });
    writeFileSync(
      join(tempDir, "opencode", "opencode.json"),
      JSON.stringify({
        provider: {
          crof: {
            options: {
              apiKey: "{env:GITHUB_TOKEN}",
            },
          },
          nahcrof: {
            options: {
              apiKey: "{env:CROF_API_KEY}",
            },
          },
        },
      }),
      "utf-8",
    );

    const out = await queryCrofQuota();
    expect(out).toBeNull();
  });

  it("falls back to auth.json provider aliases", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValueOnce({
      nahcrof: {
        type: "api",
        key: "auth-key",
      },
    });

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            credits: 0,
            requests_plan: 0,
            usable_requests: 0,
          }),
          { status: 200 },
        ),
    ) as any;
    vi.stubGlobal("fetch", fetchMock);

    const out = await queryCrofQuota();
    expect(out && out.success ? out.percentRemaining : -1).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://crof.ai/usage_api/",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer auth-key",
        }),
      }),
    );
  });
});
