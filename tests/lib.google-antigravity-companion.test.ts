import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const moduleMocks = vi.hoisted(() => ({
  resolveImpl: vi.fn<(specifier: string, options?: { paths?: string[] }) => string>(),
  runtimeDirs: {
    value: {
      cacheDirs: [] as string[],
    },
  },
}));

vi.mock("node:module", () => ({
  createRequire: () => ({
    resolve: moduleMocks.resolveImpl,
  }),
}));

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirCandidates: () => moduleMocks.runtimeDirs.value,
}));

function moduleNotFound(): Error & { code?: string } {
  const error = new Error("Cannot find module");
  error.code = "MODULE_NOT_FOUND";
  return error;
}

function packagePathNotExported(): Error & { code?: string } {
  const error = new Error("Package subpath is not defined by \"exports\"");
  error.code = "ERR_PACKAGE_PATH_NOT_EXPORTED";
  return error;
}

function writeAntigravityCredentials(path: string, params?: { declaration?: "export const" | "const" | "var" }): void {
  const declaration = params?.declaration ?? "export const";
  writeFileSync(
    path,
    [
      `${declaration} ANTIGRAVITY_CLIENT_ID = 'client-id';`,
      `${declaration} ANTIGRAVITY_CLIENT_SECRET = 'client-secret';`,
    ].join("\n"),
    "utf8",
  );
}

describe("google antigravity companion resolution", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    moduleMocks.resolveImpl.mockReset();
    moduleMocks.runtimeDirs.value = { cacheDirs: [] };
    tempDir = mkdtempSync(join(tmpdir(), "opencode-quota-antigravity-companion-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports missing when the companion package cannot be resolved", async () => {
    moduleMocks.resolveImpl.mockImplementation(() => {
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-antigravity-companion.js");

    await expect(mod.inspectAntigravityCompanionPresence()).resolves.toMatchObject({
      state: "missing",
    });
    await expect(mod.resolveAntigravityClientCredentials()).resolves.toMatchObject({
      state: "missing",
    });
  });

  it("reports invalid when the resolved module does not export usable credentials", async () => {
    const invalidModulePath = join(tempDir, "constants-invalid.mjs");
    writeFileSync(invalidModulePath, "export const ANTIGRAVITY_CLIENT_ID = '';\n", "utf8");
    moduleMocks.resolveImpl.mockReturnValue(invalidModulePath);

    const mod = await import("../src/lib/google-antigravity-companion.js");

    await expect(mod.inspectAntigravityCompanionPresence()).resolves.toMatchObject({
      state: "invalid",
      resolvedPath: invalidModulePath,
    });
    await expect(mod.resolveAntigravityClientCredentials()).resolves.toMatchObject({
      state: "invalid",
      resolvedPath: invalidModulePath,
    });
  });

  it("returns configured credentials when the companion module exports both values", async () => {
    const validModulePath = join(tempDir, "constants-valid.mjs");
    writeAntigravityCredentials(validModulePath);
    moduleMocks.resolveImpl.mockReturnValue(validModulePath);

    const mod = await import("../src/lib/google-antigravity-companion.js");

    await expect(mod.inspectAntigravityCompanionPresence()).resolves.toMatchObject({
      state: "present",
      resolvedPath: validModulePath,
    });
    await expect(mod.resolveAntigravityClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "client-id",
      clientSecret: "client-secret",
      resolvedPath: validModulePath,
    });
  });

  it("resolves the published constants file from OpenCode runtime cache paths", async () => {
    const runtimeCacheDir = join(tempDir, "cache", "opencode");
    const constantsPath = join(tempDir, "resolved", "constants.mjs");
    mkdirSync(join(tempDir, "resolved"), { recursive: true });
    writeAntigravityCredentials(constantsPath);
    moduleMocks.runtimeDirs.value = { cacheDirs: [runtimeCacheDir] };
    moduleMocks.resolveImpl.mockImplementation((specifier, options) => {
      if (
        specifier === "opencode-antigravity-auth/dist/src/constants.js" &&
        options?.paths?.includes(runtimeCacheDir)
      ) {
        return constantsPath;
      }
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-antigravity-companion.js");

    await expect(mod.resolveAntigravityClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "client-id",
      clientSecret: "client-secret",
      resolvedPath: constantsPath,
    });
    expect(moduleMocks.resolveImpl).toHaveBeenCalledWith(
      "opencode-antigravity-auth/dist/src/constants.js",
      { paths: [runtimeCacheDir] },
    );
  });

  it("reports invalid when package export blocks prove the package exists but no fallback resolves", async () => {
    moduleMocks.resolveImpl.mockImplementation((specifier) => {
      if (specifier.startsWith("opencode-antigravity-auth/")) {
        throw packagePathNotExported();
      }
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-antigravity-companion.js");

    await expect(mod.inspectAntigravityCompanionPresence()).resolves.toMatchObject({
      state: "invalid",
    });
    await expect(mod.resolveAntigravityClientCredentials()).resolves.toMatchObject({
      state: "invalid",
    });
  });

  it("falls through package export blocks and reads credentials from the package root export", async () => {
    const packageRoot = join(tempDir, "opencode-antigravity-auth");
    const distPath = join(packageRoot, "dist", "index.js");
    mkdirSync(join(packageRoot, "dist"), { recursive: true });
    writeAntigravityCredentials(distPath, { declaration: "var" });
    moduleMocks.resolveImpl.mockImplementation((specifier) => {
      if (specifier === "opencode-antigravity-auth") {
        return distPath;
      }
      if (specifier.startsWith("opencode-antigravity-auth/")) {
        throw packagePathNotExported();
      }
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-antigravity-companion.js");

    await expect(mod.resolveAntigravityClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "client-id",
      clientSecret: "client-secret",
      resolvedPath: distPath,
    });
  });

  it("reads credentials from package.json package-root candidates", async () => {
    const packageRoot = join(tempDir, "opencode-antigravity-auth");
    const packageJsonPath = join(packageRoot, "package.json");
    const constantsPath = join(packageRoot, "src", "constants.js");
    mkdirSync(join(packageRoot, "src"), { recursive: true });
    writeFileSync(packageJsonPath, JSON.stringify({ name: "opencode-antigravity-auth" }), "utf8");
    writeAntigravityCredentials(constantsPath, { declaration: "const" });
    moduleMocks.resolveImpl.mockImplementation((specifier) => {
      if (specifier === "opencode-antigravity-auth/package.json") {
        return packageJsonPath;
      }
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-antigravity-companion.js");

    await expect(mod.resolveAntigravityClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "client-id",
      clientSecret: "client-secret",
      resolvedPath: constantsPath,
    });
  });

  it.each([
    ["dist/src/constants.js", ["dist", "src"], "constants.js"],
    ["src/constants.ts", ["src"], "constants.ts"],
    ["src/constants.js", ["src"], "constants.js"],
    ["dist/index.js", ["dist"], "index.js"],
  ])("directly probes runtime cache %s", async (_label, dirs, fileName) => {
    const runtimeCacheDir = join(tempDir, "cache", "opencode");
    const packageRoot = join(runtimeCacheDir, "node_modules", "opencode-antigravity-auth");
    const candidatePath = join(packageRoot, ...dirs, fileName);
    mkdirSync(join(packageRoot, ...dirs), { recursive: true });
    writeAntigravityCredentials(candidatePath, { declaration: "var" });
    moduleMocks.runtimeDirs.value = { cacheDirs: [runtimeCacheDir] };
    moduleMocks.resolveImpl.mockImplementation(() => {
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-antigravity-companion.js");

    await expect(mod.resolveAntigravityClientCredentials()).resolves.toMatchObject({
      state: "configured",
      clientId: "client-id",
      clientSecret: "client-secret",
      resolvedPath: candidatePath,
    });
  });

  it("reports invalid when a runtime candidate exists but cannot be read", async () => {
    const runtimeCacheDir = join(tempDir, "cache", "opencode");
    const candidatePath = join(
      runtimeCacheDir,
      "node_modules",
      "opencode-antigravity-auth",
      "dist",
      "src",
      "constants.js",
    );
    mkdirSync(candidatePath, { recursive: true });
    moduleMocks.runtimeDirs.value = { cacheDirs: [runtimeCacheDir] };
    moduleMocks.resolveImpl.mockImplementation(() => {
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-antigravity-companion.js");

    await expect(mod.inspectAntigravityCompanionPresence()).resolves.toMatchObject({
      state: "invalid",
      resolvedPath: candidatePath,
    });
    await expect(mod.resolveAntigravityClientCredentials()).resolves.toMatchObject({
      state: "invalid",
      resolvedPath: candidatePath,
    });
  });

  it("reports invalid when a readable runtime candidate lacks usable credentials", async () => {
    const runtimeCacheDir = join(tempDir, "cache", "opencode");
    const candidatePath = join(
      runtimeCacheDir,
      "node_modules",
      "opencode-antigravity-auth",
      "dist",
      "src",
      "constants.js",
    );
    mkdirSync(join(runtimeCacheDir, "node_modules", "opencode-antigravity-auth", "dist", "src"), {
      recursive: true,
    });
    writeFileSync(candidatePath, "export const ANTIGRAVITY_CLIENT_ID = '';\n", "utf8");
    moduleMocks.runtimeDirs.value = { cacheDirs: [runtimeCacheDir] };
    moduleMocks.resolveImpl.mockImplementation(() => {
      throw moduleNotFound();
    });

    const mod = await import("../src/lib/google-antigravity-companion.js");

    await expect(mod.inspectAntigravityCompanionPresence()).resolves.toMatchObject({
      state: "invalid",
      resolvedPath: candidatePath,
    });
    await expect(mod.resolveAntigravityClientCredentials()).resolves.toMatchObject({
      state: "invalid",
      resolvedPath: candidatePath,
    });
  });

  it("reports invalid for non-fallthrough resolution errors", async () => {
    moduleMocks.resolveImpl.mockImplementation(() => {
      throw new Error("resolver failed");
    });

    const mod = await import("../src/lib/google-antigravity-companion.js");

    await expect(mod.inspectAntigravityCompanionPresence()).resolves.toMatchObject({
      state: "invalid",
    });
    await expect(mod.resolveAntigravityClientCredentials()).resolves.toMatchObject({
      state: "invalid",
    });
  });
});
