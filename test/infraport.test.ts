import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getLatestModuleVersion,
  getLatestProviderVersion,
  getModuleDetails,
  getPolicyDetails,
  getProviderDetails,
  getWorkspace,
  listWorkspaces,
  requireTfeToken,
  searchModules,
  searchPolicies,
  searchProviders,
} from "../src/infraport.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

function jsonResponse(body: unknown, status = 200, statusText = "OK"): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

interface Captured {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function fakeFetch(captured: Captured, body: unknown = { modules: [] }): FetchFn {
  return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    captured.url = url;
    captured.method = init?.method;
    captured.headers = init?.headers;
    captured.body = init?.body;
    return jsonResponse(body);
  };
}

describe("search_modules", () => {
  it("composes the search URL with provider and offset when given", async () => {
    const c: Captured = {};
    await searchModules(fakeFetch(c), { query: "vpc", provider: "aws", offset: 10 });
    const url = new URL(c.url ?? "");
    assert.equal(url.origin + url.pathname, "https://registry.terraform.io/v1/modules/search");
    assert.equal(url.searchParams.get("q"), "vpc");
    assert.equal(url.searchParams.get("provider"), "aws");
    assert.equal(url.searchParams.get("offset"), "10");
    assert.equal(c.method, "GET");
  });

  it("omits provider and offset when absent", async () => {
    const c: Captured = {};
    await searchModules(fakeFetch(c), { query: "vpc" });
    const url = new URL(c.url ?? "");
    assert.equal(url.searchParams.get("q"), "vpc");
    assert.equal(url.searchParams.has("provider"), false);
    assert.equal(url.searchParams.has("offset"), false);
  });

  it("sends no Authorization header on registry calls", async () => {
    const c: Captured = {};
    await searchModules(fakeFetch(c), { query: "vpc" });
    assert.equal(c.headers?.Authorization, undefined);
    assert.equal("Authorization" in (c.headers ?? {}), false);
  });
});

describe("module details and latest version", () => {
  it("builds the module path without a version segment by default", async () => {
    const c: Captured = {};
    await getModuleDetails(fakeFetch(c, { id: "x" }), {
      namespace: "terraform-aws-modules",
      name: "vpc",
      provider: "aws",
    });
    assert.equal(
      new URL(c.url ?? "").pathname,
      "/v1/modules/terraform-aws-modules/vpc/aws",
    );
  });

  it("appends the version segment when a version is given", async () => {
    const c: Captured = {};
    await getModuleDetails(fakeFetch(c, { id: "x" }), {
      namespace: "hashicorp",
      name: "consul",
      provider: "aws",
      version: "0.0.5",
    });
    assert.equal(new URL(c.url ?? "").pathname, "/v1/modules/hashicorp/consul/aws/0.0.5");
  });

  it("extracts the latest module version from a .version payload", async () => {
    const c: Captured = {};
    const out = (await getLatestModuleVersion(
      fakeFetch(c, { version: "5.1.0", name: "vpc" }),
      { namespace: "ns", name: "vpc", provider: "aws" },
    )) as { version: string; module: { version: string } };
    assert.equal(out.version, "5.1.0");
    assert.equal(out.module.version, "5.1.0");
  });

  it("extracts the latest module version from modules[0].version", async () => {
    const c: Captured = {};
    const out = (await getLatestModuleVersion(
      fakeFetch(c, { modules: [{ version: "2.0.0" }] }),
      { namespace: "ns", name: "m", provider: "aws" },
    )) as { version: string };
    assert.equal(out.version, "2.0.0");
  });

  it("errors when no version is present in the registry response", async () => {
    const c: Captured = {};
    await assert.rejects(
      () => getLatestModuleVersion(fakeFetch(c, { name: "m" }), {
        namespace: "ns",
        name: "m",
        provider: "aws",
      }),
      /no version found in registry response/,
    );
  });
});

describe("providers", () => {
  it("searches providers with q and offset", async () => {
    const c: Captured = {};
    await searchProviders(fakeFetch(c, { providers: [] }), { query: "aws", offset: 5 });
    const url = new URL(c.url ?? "");
    assert.equal(url.pathname, "/v1/providers/search");
    assert.equal(url.searchParams.get("q"), "aws");
    assert.equal(url.searchParams.get("offset"), "5");
  });

  it("gets provider details with and without a version segment", async () => {
    const c: Captured = {};
    await getProviderDetails(fakeFetch(c, { id: "p" }), { namespace: "hashicorp", type: "aws" });
    assert.equal(new URL(c.url ?? "").pathname, "/v1/providers/hashicorp/aws");
    const v: Captured = {};
    await getProviderDetails(fakeFetch(v, { id: "p" }), {
      namespace: "hashicorp",
      type: "aws",
      version: "5.0.0",
    });
    assert.equal(new URL(v.url ?? "").pathname, "/v1/providers/hashicorp/aws/5.0.0");
  });

  it("extracts the latest provider version from the payload", async () => {
    const c: Captured = {};
    const out = (await getLatestProviderVersion(
      fakeFetch(c, { version: "5.31.0", type: "aws" }),
      { namespace: "hashicorp", type: "aws" },
    )) as { version: string; provider: { version: string } };
    assert.equal(out.version, "5.31.0");
    assert.equal(out.provider.version, "5.31.0");
  });
});

describe("policies", () => {
  it("searches policies with q and offset", async () => {
    const c: Captured = {};
    await searchPolicies(fakeFetch(c, { policies: [] }), { query: "tags", offset: 2 });
    const url = new URL(c.url ?? "");
    assert.equal(url.pathname, "/v1/policies/search");
    assert.equal(url.searchParams.get("q"), "tags");
    assert.equal(url.searchParams.get("offset"), "2");
  });

  it("gets policy details by namespace and name", async () => {
    const c: Captured = {};
    await getPolicyDetails(fakeFetch(c, { id: "pol" }), {
      namespace: "hashicorp",
      name: "enforce-tags",
    });
    assert.equal(new URL(c.url ?? "").pathname, "/v1/policies/hashicorp/enforce-tags");
  });
});

describe("workspaces and TFE_TOKEN", () => {
  it("requireTfeToken rejects a missing or blank token naming TFE_TOKEN", () => {
    assert.throws(() => requireTfeToken(undefined), /TFE_TOKEN/);
    assert.throws(() => requireTfeToken("  "), /TFE_TOKEN/);
    assert.equal(requireTfeToken(" tok "), "tok");
  });

  it("list_workspaces without a token errors naming TFE_TOKEN and never fetches", async () => {
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    await assert.rejects(
      () => listWorkspaces(spy, undefined, { organization: "my-org" }),
      /TFE_TOKEN/,
    );
    assert.equal(called, false);
  });

  it("get_workspace without a token errors naming TFE_TOKEN and never fetches", async () => {
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    await assert.rejects(
      () => getWorkspace(spy, "", { organization: "my-org", workspace: "prod" }),
      /TFE_TOKEN/,
    );
    assert.equal(called, false);
  });

  it("list_workspaces with a token sends Bearer + vnd.api+json to app.terraform.io", async () => {
    const c: Captured = {};
    await listWorkspaces(fakeFetch(c, { data: [] }), "secret-token", { organization: "my-org" });
    const url = new URL(c.url ?? "");
    assert.equal(url.origin, "https://app.terraform.io");
    assert.equal(url.pathname, "/api/v2/organizations/my-org/workspaces");
    assert.equal(c.headers?.Authorization, "Bearer secret-token");
    assert.equal(c.headers?.["Content-Type"], "application/vnd.api+json");
    assert.equal(c.method, "GET");
  });

  it("get_workspace builds the organization/workspace path", async () => {
    const c: Captured = {};
    await getWorkspace(fakeFetch(c, { data: { id: "ws-1" } }), "tok", {
      organization: "my-org",
      workspace: "prod",
    });
    assert.equal(
      new URL(c.url ?? "").pathname,
      "/api/v2/organizations/my-org/workspaces/prod",
    );
  });
});

describe("HTTP errors", () => {
  it("surfaces status plus upstream errors[0].detail", async () => {
    const failing: FetchFn = async () =>
      jsonResponse({ errors: [{ detail: "module not found", title: "Not Found" }] }, 404, "Not Found");
    await assert.rejects(
      () => getModuleDetails(failing, { namespace: "ns", name: "nope", provider: "aws" }),
      /HTTP 404.*module not found/,
    );
  });

  it("surfaces a string error and a top-level message when present", async () => {
    const failing: FetchFn = async () => jsonResponse({ errors: ["bad query"] }, 400, "Bad Request");
    await assert.rejects(() => searchModules(failing, { query: "x" }), /HTTP 400.*bad query/);
    const failing2: FetchFn = async () => jsonResponse({ message: "rate limited" }, 429, "Too Many Requests");
    await assert.rejects(() => searchProviders(failing2, { query: "x" }), /HTTP 429.*rate limited/);
  });
});
