/**
 * Crof.ai API key configuration resolver.
 *
 * Resolution priority (first wins):
 * 1. Environment variable: CROF_API_KEY
 * 2. User/global opencode.json/opencode.jsonc: provider.crof.options.apiKey
 *    or provider.crof-ai / provider.nahcrof options.apiKey
 * 3. auth.json: crof.key, crof-ai.key, or nahcrof.key
 */

import { readAuthFile } from "./opencode-auth.js";
import {
  extractAuthApiKeyEntry,
  extractProviderOptionsApiKey,
  getApiKeyDiagnostics,
  getGlobalOpencodeConfigCandidatePaths,
  resolveApiKey,
} from "./api-key-resolver.js";

export interface CrofApiKeyResult {
  key: string;
  source: CrofKeySource;
}

const ALLOWED_CROF_ENV_VARS = ["CROF_API_KEY"] as const;
const CROF_PROVIDER_KEYS = ["crof", "crof-ai", "nahcrof"] as const;

export type CrofKeySource = "env:CROF_API_KEY" | "opencode.json" | "opencode.jsonc" | "auth.json";

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

export async function resolveCrofApiKey(): Promise<CrofApiKeyResult | null> {
  return resolveApiKey<CrofKeySource>(
    {
      envVars: [{ name: "CROF_API_KEY", source: "env:CROF_API_KEY" }],
      extractFromConfig: (config) =>
        extractProviderOptionsApiKey(config, {
          providerKeys: CROF_PROVIDER_KEYS,
          allowedEnvVars: ALLOWED_CROF_ENV_VARS,
        }),
      configJsonSource: "opencode.json",
      configJsoncSource: "opencode.jsonc",
      extractFromAuth: (auth) => extractAuthApiKeyEntry(auth, CROF_PROVIDER_KEYS),
      authSource: "auth.json",
      getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
    },
    readAuthFile,
  );
}

export async function hasCrofApiKey(): Promise<boolean> {
  const result = await resolveCrofApiKey();
  return result !== null;
}

export async function getCrofKeyDiagnostics(): Promise<{
  configured: boolean;
  source: CrofKeySource | null;
  checkedPaths: string[];
}> {
  return getApiKeyDiagnostics<CrofKeySource>({
    envVarNames: ["CROF_API_KEY"],
    resolve: resolveCrofApiKey,
    getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  });
}
