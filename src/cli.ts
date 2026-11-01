#!/usr/bin/env node
/**
 * infraport CLI.
 *
 *   infraport search-modules <q>
 *   infraport module <namespace> <name> <provider>
 *   infraport module-version <namespace> <name> <provider>
 *   infraport search-providers <q>
 *   infraport provider <namespace> <type>
 *   infraport provider-version <namespace> <type>
 *   infraport search-policies <q>
 *   infraport policy <namespace> <name>
 *   infraport workspaces <organization>
 *   infraport workspace <organization> <name>
 *   infraport mcp
 *
 * Registry commands need no token. Workspace commands read the
 * HCP Terraform token from TFE_TOKEN.
 * Exit codes: 0 success, 1 API error, 2 usage error.
 */
import {
  formatPayload,
  getLatestModuleVersion,
  getLatestProviderVersion,
  getModuleDetails,
  getPolicyDetails,
  getProviderDetails,
  getWorkspace,
  listWorkspaces,
  searchModules,
  searchPolicies,
  searchProviders,
  TOKEN_ENV,
  VERSION,
} from "./infraport.js";
import type { FetchFn } from "./types.js";

function usage(): never {
  console.error(`Usage:
  infraport search-modules <q>
  infraport module <namespace> <name> <provider>
  infraport module-version <namespace> <name> <provider>
  infraport search-providers <q>
  infraport provider <namespace> <type>
  infraport provider-version <namespace> <type>
  infraport search-policies <q>
  infraport policy <namespace> <name>
  infraport workspaces <organization>
  infraport workspace <organization> <name>
  infraport mcp
  infraport --version`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const token = process.env[TOKEN_ENV];
  const known = [
    "search-modules", "module", "module-version", "search-providers",
    "provider", "provider-version", "search-policies", "policy",
    "workspaces", "workspace",
  ];
  if (!known.includes(cmd)) usage();
  try {
    let out: unknown;
    if (cmd === "search-modules") {
      if (!rest[0]) usage();
      out = await searchModules(fetchFn, { query: rest[0] });
    } else if (cmd === "module") {
      if (!rest[0] || !rest[1] || !rest[2]) usage();
      out = await getModuleDetails(fetchFn, {
        namespace: rest[0],
        name: rest[1],
        provider: rest[2],
      });
    } else if (cmd === "module-version") {
      if (!rest[0] || !rest[1] || !rest[2]) usage();
      out = await getLatestModuleVersion(fetchFn, {
        namespace: rest[0],
        name: rest[1],
        provider: rest[2],
      });
    } else if (cmd === "search-providers") {
      if (!rest[0]) usage();
      out = await searchProviders(fetchFn, { query: rest[0] });
    } else if (cmd === "provider") {
      if (!rest[0] || !rest[1]) usage();
      out = await getProviderDetails(fetchFn, { namespace: rest[0], type: rest[1] });
    } else if (cmd === "provider-version") {
      if (!rest[0] || !rest[1]) usage();
      out = await getLatestProviderVersion(fetchFn, { namespace: rest[0], type: rest[1] });
    } else if (cmd === "search-policies") {
      if (!rest[0]) usage();
      out = await searchPolicies(fetchFn, { query: rest[0] });
    } else if (cmd === "policy") {
      if (!rest[0] || !rest[1]) usage();
      out = await getPolicyDetails(fetchFn, { namespace: rest[0], name: rest[1] });
    } else if (cmd === "workspaces") {
      if (!rest[0]) usage();
      out = await listWorkspaces(fetchFn, token, { organization: rest[0] });
    } else {
      if (!rest[0] || !rest[1]) usage();
      out = await getWorkspace(fetchFn, token, {
        organization: rest[0],
        workspace: rest[1],
      });
    }
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
