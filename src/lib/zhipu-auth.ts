import {
  extractProviderOptionsApiKey,
  getApiKeyCheckedPaths,
  getFirstAuthEntryValue,
  getGlobalOpencodeConfigCandidatePaths,
  resolveApiKeyFromEnvAndConfig,
} from "./api-key-resolver.js";
import { sanitizeDisplayText } from "./display-sanitize.js";
import { getAuthPaths, readAuthFileCached } from "./opencode-auth.js";

import type { AuthData, ZaiAuthData } from "./types.js";

export const DEFAULT_ZHIPU_AUTH_CACHE_MAX_AGE_MS = 5_000;
const ZHIPU_AUTH_KEYS = ["zhipu-coding-plan"] as const;
const ZHIPU_PROVIDER_KEYS = ["zhipu", "zhipu-coding-plan", "glm-coding-plan"] as const;
const ALLOWED_ZHIPU_ENV_VARS = ["ZHIPU_API_KEY", "ZHIPU_CODING_PLAN_API_KEY"] as const;

export type ZhipuKeySource =
  | "env:ZHIPU_API_KEY"
  | "env:ZHIPU_CODING_PLAN_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

export type ResolvedZhipuAuth =
  | { state: "none" }
  | { state: "configured"; apiKey: string }
  | { state: "invalid"; error: string };

export type ZhipuAuthDiagnostics =
  | {
      state: "none";
      source: null;
      checkedPaths: string[];
      authPaths: string[];
    }
  | {
      state: "configured";
      source: ZhipuKeySource;
      checkedPaths: string[];
      authPaths: string[];
    }
  | {
      state: "invalid";
      source: "auth.json";
      checkedPaths: string[];
      authPaths: string[];
      error: string;
    };

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

function getZhipuAuthEntry(auth: AuthData | null | undefined): unknown {
  return getFirstAuthEntryValue(auth, ZHIPU_AUTH_KEYS);
}

function isZhipuAuthData(value: unknown): value is ZaiAuthData {
  return value !== null && typeof value === "object";
}

function sanitizeZhipuAuthValue(value: string): string {
  const sanitized = sanitizeDisplayText(value).replace(/\s+/g, " ").trim();
  return (sanitized || "unknown").slice(0, 120);
}

export function resolveZhipuAuth(auth: AuthData | null | undefined): ResolvedZhipuAuth {
  const zhipu = getZhipuAuthEntry(auth);
  if (zhipu === null || zhipu === undefined) {
    return { state: "none" };
  }

  if (!isZhipuAuthData(zhipu)) {
    return { state: "invalid", error: "Zhipu auth entry has invalid shape" };
  }

  if (typeof zhipu.type !== "string") {
    return { state: "invalid", error: "Zhipu auth entry present but type is missing or invalid" };
  }

  if (zhipu.type !== "api") {
    return {
      state: "invalid",
      error: `Unsupported Zhipu auth type: "${sanitizeZhipuAuthValue(zhipu.type)}"`,
    };
  }

  const key = typeof zhipu.key === "string" ? zhipu.key.trim() : "";
  if (!key) {
    return { state: "invalid", error: "Zhipu auth entry present but key is empty" };
  }

  return { state: "configured", apiKey: key };
}

async function resolveZhipuAuthWithSource(params?: {
  maxAgeMs?: number;
}): Promise<{ auth: ResolvedZhipuAuth; source: ZhipuKeySource | null }> {
  const resolvedFromEnvOrConfig = await resolveApiKeyFromEnvAndConfig<ZhipuKeySource>({
    envVars: [
      { name: "ZHIPU_API_KEY", source: "env:ZHIPU_API_KEY" },
      {
        name: "ZHIPU_CODING_PLAN_API_KEY",
        source: "env:ZHIPU_CODING_PLAN_API_KEY",
      },
    ],
    extractFromConfig: (config) =>
      extractProviderOptionsApiKey(config, {
        providerKeys: ZHIPU_PROVIDER_KEYS,
        allowedEnvVars: ALLOWED_ZHIPU_ENV_VARS,
      }),
    configJsonSource: "opencode.json",
    configJsoncSource: "opencode.jsonc",
    getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  });

  if (resolvedFromEnvOrConfig) {
    return {
      auth: { state: "configured", apiKey: resolvedFromEnvOrConfig.key },
      source: resolvedFromEnvOrConfig.source,
    };
  }

  const maxAgeMs = Math.max(0, params?.maxAgeMs ?? DEFAULT_ZHIPU_AUTH_CACHE_MAX_AGE_MS);
  const authData = await readAuthFileCached({ maxAgeMs });
  const auth = resolveZhipuAuth(authData);

  return {
    auth,
    source: auth.state === "none" ? null : "auth.json",
  };
}

export async function resolveZhipuAuthCached(params?: {
  maxAgeMs?: number;
}): Promise<ResolvedZhipuAuth> {
  return (await resolveZhipuAuthWithSource(params)).auth;
}

export async function getZhipuAuthDiagnostics(params?: {
  maxAgeMs?: number;
}): Promise<ZhipuAuthDiagnostics> {
  const { auth, source } = await resolveZhipuAuthWithSource(params);
  const checkedPaths = getApiKeyCheckedPaths({
    envVarNames: [...ALLOWED_ZHIPU_ENV_VARS],
    getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  });
  const authPaths = getAuthPaths();

  if (auth.state === "none") {
    return {
      state: "none",
      source: null,
      checkedPaths,
      authPaths,
    };
  }

  if (auth.state === "invalid") {
    return {
      state: "invalid",
      source: "auth.json",
      checkedPaths,
      authPaths,
      error: auth.error,
    };
  }

  return {
    state: "configured",
    source: source ?? "auth.json",
    checkedPaths,
    authPaths,
  };
}
