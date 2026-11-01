/**
 * infraport core: ten tools across two Terraform surfaces.
 *
 * Registry (keyless, https://registry.terraform.io/v1):
 *   search_modules            GET /modules/search?q=&provider=&offset=
 *   get_module_details        GET /modules/{ns}/{name}/{provider}[/{version}]
 *   get_latest_module_version GET /modules/{ns}/{name}/{provider}
 *   search_providers          GET /providers/search?q=&offset=
 *   get_provider_details      GET /providers/{ns}/{type}[/{version}]
 *   get_latest_provider_version GET /providers/{ns}/{type}
 *   search_policies           GET /policies/search?q=&offset=
 *   get_policy_details        GET /policies/{ns}/{name}
 *
 * HCP Terraform (https://app.terraform.io/api/v2, Bearer TFE_TOKEN):
 *   list_workspaces           GET /organizations/{org}/workspaces
 *   get_workspace             GET /organizations/{org}/workspaces/{name}
 *
 * Registry calls never send an Authorization header and never
 * require a token. Only the workspace tools require TFE_TOKEN, and
 * a missing token fails before any request with an error naming
 * TFE_TOKEN. HTTP failures surface the status plus the upstream
 * errors[0] detail/title (or message) when present. All HTTP goes
 * through an injected FetchFn so everything is testable offline.
 */
import type {
  FetchFn,
  GetLatestModuleVersionOptions,
  GetLatestProviderVersionOptions,
  GetModuleDetailsOptions,
  GetPolicyDetailsOptions,
  GetProviderDetailsOptions,
  GetWorkspaceOptions,
  ListWorkspacesOptions,
  SearchModulesOptions,
  SearchPoliciesOptions,
  SearchProvidersOptions,
} from "./types.js";

export const VERSION = "0.1.0";

export const REGISTRY_BASE = "https://registry.terraform.io/v1";
export const TFE_BASE = "https://app.terraform.io/api/v2";
export const TOKEN_ENV = "TFE_TOKEN";

/** The honest missing-token error. Names the variable, never a value. */
export function requireTfeToken(token: string | undefined): string {
  const value = typeof token === "string" ? token.trim() : "";
  if (!value) {
    throw new Error(
      "TFE_TOKEN environment variable is required: set TFE_TOKEN to an HCP Terraform API token and retry",
    );
  }
  return value;
}

function requireId(value: unknown, field: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new Error(`${field} must be a non-empty string`);
  return v;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

function extractErrorDetail(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const errors = payload.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first: unknown = errors[0];
    if (typeof first === "string" && first) return first;
    if (isRecord(first)) {
      for (const key of ["detail", "title", "message", "status"]) {
        const v = first[key];
        if (typeof v === "string" && v) return v;
        if (typeof v === "number") return String(v);
      }
    }
  }
  if (typeof payload.message === "string" && payload.message) return payload.message;
  if (typeof payload.detail === "string" && payload.detail) return payload.detail;
  return "";
}

async function parseAndCheck(response: {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
}, label: string): Promise<unknown> {
  if (!response.ok) {
    let detail = "";
    try {
      detail = extractErrorDetail(await response.json());
    } catch {
      // A non-JSON error body still reports its HTTP status below.
    }
    throw new Error(
      `${label} request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail ? `: ${detail}` : ""}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned a response that was not valid JSON`);
  }
}

interface RegistryCall {
  query?: Record<string, string>;
}

async function callRegistry(
  fetchFn: FetchFn,
  path: string,
  call: RegistryCall = {},
): Promise<unknown> {
  let url = `${REGISTRY_BASE}${path}`;
  if (call.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(call.query)) params.set(k, v);
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  let response;
  try {
    response = await fetchFn(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new Error(
      `Terraform Registry request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseAndCheck(response, "Terraform Registry");
}

async function callTfe(
  fetchFn: FetchFn,
  token: string | undefined,
  path: string,
): Promise<unknown> {
  const key = requireTfeToken(token);
  let response;
  try {
    response = await fetchFn(`${TFE_BASE}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/vnd.api+json",
      },
    });
  } catch (err) {
    throw new Error(
      `HCP Terraform request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseAndCheck(response, "HCP Terraform");
}

function searchQuery(queryValue: string, extra: Record<string, string>): Record<string, string> {
  return { q: queryValue, ...extra };
}

function offsetEntry(offset: number | undefined): Record<string, string> {
  return offset !== undefined ? { offset: String(offset) } : {};
}

/** Search the Terraform Registry for modules matching a query. */
export async function searchModules(
  fetchFn: FetchFn,
  options: SearchModulesOptions,
): Promise<unknown> {
  const query = requireId(options.query, "query");
  const extra: Record<string, string> = { ...offsetEntry(options.offset) };
  if (options.provider !== undefined && options.provider !== "") {
    extra.provider = options.provider;
  }
  // Keep documented parameter order q, provider, offset in the URL.
  const ordered: Record<string, string> = { q: query };
  if (extra.provider) ordered.provider = extra.provider;
  if (extra.offset) ordered.offset = extra.offset;
  return callRegistry(fetchFn, "/modules/search", { query: ordered });
}

/** Fetch details for one registry module by namespace, name, and provider. */
export async function getModuleDetails(
  fetchFn: FetchFn,
  options: GetModuleDetailsOptions,
): Promise<unknown> {
  const namespace = requireId(options.namespace, "namespace");
  const name = requireId(options.name, "name");
  const provider = requireId(options.provider, "provider");
  let path = `/modules/${seg(namespace)}/${seg(name)}/${seg(provider)}`;
  if (options.version !== undefined && options.version !== "") {
    path += `/${seg(options.version)}`;
  }
  return callRegistry(fetchFn, path);
}

function extractVersion(payload: unknown, listKeys: string[]): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.version === "string" && payload.version) return payload.version;
  for (const key of listKeys) {
    const list = payload[key];
    if (Array.isArray(list) && list.length > 0) {
      const first: unknown = list[0];
      if (isRecord(first) && typeof first.version === "string" && first.version) {
        return first.version;
      }
      if (typeof first === "string" && first) return first;
    }
  }
  const versions = payload.versions;
  if (Array.isArray(versions) && versions.length > 0) {
    const last: unknown = versions[versions.length - 1];
    if (typeof last === "string" && last) return last;
    if (isRecord(last) && typeof last.version === "string" && last.version) return last.version;
  }
  return undefined;
}

/** Get the latest published version of a registry module. */
export async function getLatestModuleVersion(
  fetchFn: FetchFn,
  options: GetLatestModuleVersionOptions,
): Promise<unknown> {
  const payload = await getModuleDetails(fetchFn, options);
  const version = extractVersion(payload, ["modules"]);
  if (!version) throw new Error("no version found in registry response");
  return { version, module: payload };
}

/** Search the Terraform Registry for providers matching a query. */
export async function searchProviders(
  fetchFn: FetchFn,
  options: SearchProvidersOptions,
): Promise<unknown> {
  const query = requireId(options.query, "query");
  return callRegistry(fetchFn, "/providers/search", {
    query: searchQuery(query, offsetEntry(options.offset)),
  });
}

/** Fetch details for one registry provider by namespace and type. */
export async function getProviderDetails(
  fetchFn: FetchFn,
  options: GetProviderDetailsOptions,
): Promise<unknown> {
  const namespace = requireId(options.namespace, "namespace");
  const type = requireId(options.type, "type");
  let path = `/providers/${seg(namespace)}/${seg(type)}`;
  if (options.version !== undefined && options.version !== "") {
    path += `/${seg(options.version)}`;
  }
  return callRegistry(fetchFn, path);
}

/** Get the latest published version of a registry provider. */
export async function getLatestProviderVersion(
  fetchFn: FetchFn,
  options: GetLatestProviderVersionOptions,
): Promise<unknown> {
  const payload = await getProviderDetails(fetchFn, options);
  const version = extractVersion(payload, ["providers"]);
  if (!version) throw new Error("no version found in registry response");
  return { version, provider: payload };
}

/** Search the Terraform Registry for Sentinel policies matching a query. */
export async function searchPolicies(
  fetchFn: FetchFn,
  options: SearchPoliciesOptions,
): Promise<unknown> {
  const query = requireId(options.query, "query");
  return callRegistry(fetchFn, "/policies/search", {
    query: searchQuery(query, offsetEntry(options.offset)),
  });
}

/** Fetch details for one registry policy set by namespace and name. */
export async function getPolicyDetails(
  fetchFn: FetchFn,
  options: GetPolicyDetailsOptions,
): Promise<unknown> {
  const namespace = requireId(options.namespace, "namespace");
  const name = requireId(options.name, "name");
  return callRegistry(fetchFn, `/policies/${seg(namespace)}/${seg(name)}`);
}

/** List HCP Terraform workspaces in an organization. Requires TFE_TOKEN. */
export async function listWorkspaces(
  fetchFn: FetchFn,
  token: string | undefined,
  options: ListWorkspacesOptions,
): Promise<unknown> {
  // Validate the token before validating/building the request so a
  // missing token always errors naming TFE_TOKEN and no fetch runs.
  requireTfeToken(token);
  const organization = requireId(options.organization, "organization");
  return callTfe(fetchFn, token, `/organizations/${seg(organization)}/workspaces`);
}

/** Fetch one HCP Terraform workspace by organization and workspace name. Requires TFE_TOKEN. */
export async function getWorkspace(
  fetchFn: FetchFn,
  token: string | undefined,
  options: GetWorkspaceOptions,
): Promise<unknown> {
  requireTfeToken(token);
  const organization = requireId(options.organization, "organization");
  const workspace = requireId(options.workspace, "workspace");
  return callTfe(
    fetchFn,
    token,
    `/organizations/${seg(organization)}/workspaces/${seg(workspace)}`,
  );
}

/** Render an upstream payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}
