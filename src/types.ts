/**
 * infraport types.
 *
 * Registry objects are addressed in path segments: modules by
 * namespace/name/provider, providers by namespace/type, and policy
 * sets by namespace/name. Workspaces belong to an HCP Terraform
 * organization. HTTP access is described by a minimal response
 * surface so tests can inject a fake fetch and never touch the
 * network.
 */

export interface SearchModulesOptions {
  query: string;
  provider?: string;
  offset?: number;
}

export interface GetModuleDetailsOptions {
  namespace: string;
  name: string;
  provider: string;
  version?: string;
}

export interface GetLatestModuleVersionOptions {
  namespace: string;
  name: string;
  provider: string;
}

export interface SearchProvidersOptions {
  query: string;
  offset?: number;
}

export interface GetProviderDetailsOptions {
  namespace: string;
  type: string;
  version?: string;
}

export interface GetLatestProviderVersionOptions {
  namespace: string;
  type: string;
}

export interface SearchPoliciesOptions {
  query: string;
  offset?: number;
}

export interface GetPolicyDetailsOptions {
  namespace: string;
  name: string;
}

export interface ListWorkspacesOptions {
  organization: string;
}

export interface GetWorkspaceOptions {
  organization: string;
  workspace: string;
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;
