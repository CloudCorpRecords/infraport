/**
 * infraport MCP server. Tools: search_modules, get_module_details,
 * get_latest_module_version, search_providers, get_provider_details,
 * get_latest_provider_version, search_policies, get_policy_details,
 * list_workspaces, get_workspace.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects keys that are not in
 * this tool's public spec ("$schema" and "additionalProperties"), which
 * breaks exact tool-list/schema parity with the spec. This file serves
 * tools/list with the spec's exact input schemas as explicit literals,
 * while zod still validates every tools/call argument set.
 *
 * TFE_TOKEN is read at call time. Registry tools ignore it entirely
 * and work with no token; only the workspace tools require it, and a
 * missing token returns an honest isError result naming TFE_TOKEN
 * instead of failing the handshake.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
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

const SearchModulesArgs = z.object({
  query: z.string(),
  provider: z.string().optional(),
  offset: z.number().optional(),
});
const GetModuleDetailsArgs = z.object({
  namespace: z.string(),
  name: z.string(),
  provider: z.string(),
  version: z.string().optional(),
});
const GetLatestModuleVersionArgs = z.object({
  namespace: z.string(),
  name: z.string(),
  provider: z.string(),
});
const SearchProvidersArgs = z.object({
  query: z.string(),
  offset: z.number().optional(),
});
const GetProviderDetailsArgs = z.object({
  namespace: z.string(),
  type: z.string(),
  version: z.string().optional(),
});
const GetLatestProviderVersionArgs = z.object({
  namespace: z.string(),
  type: z.string(),
});
const SearchPoliciesArgs = z.object({
  query: z.string(),
  offset: z.number().optional(),
});
const GetPolicyDetailsArgs = z.object({
  namespace: z.string(),
  name: z.string(),
});
const ListWorkspacesArgs = z.object({ organization: z.string() });
const GetWorkspaceArgs = z.object({
  organization: z.string(),
  workspace: z.string(),
});

const TOOLS = [
  {
    name: "search_modules",
    description: "Search the Terraform Registry for modules matching a query.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search text used to find modules in the Terraform Registry." },
        provider: { type: "string", description: "Optional provider name to filter the module search results to one provider." },
        offset: { type: "number", description: "Optional pagination offset for the module search results." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_module_details",
    description: "Fetch details for one registry module by namespace, name, and provider.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Namespace of the module in the Terraform Registry." },
        name: { type: "string", description: "Name of the module in the Terraform Registry." },
        provider: { type: "string", description: "Name of the provider the module targets." },
        version: { type: "string", description: "Optional specific module version to fetch; when omitted, details for the latest version are returned." },
      },
      required: ["namespace", "name", "provider"],
    },
  },
  {
    name: "get_latest_module_version",
    description: "Get the latest published version of a registry module.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Namespace of the module in the Terraform Registry." },
        name: { type: "string", description: "Name of the module in the Terraform Registry." },
        provider: { type: "string", description: "Name of the provider the module targets." },
      },
      required: ["namespace", "name", "provider"],
    },
  },
  {
    name: "search_providers",
    description: "Search the Terraform Registry for providers matching a query.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search text used to find providers in the Terraform Registry." },
        offset: { type: "number", description: "Optional pagination offset for the provider search results." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_provider_details",
    description: "Fetch details for one registry provider by namespace and type.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Namespace of the provider in the Terraform Registry." },
        type: { type: "string", description: "Provider type, the short name that identifies the provider within its namespace." },
        version: { type: "string", description: "Optional specific provider version to fetch; when omitted, details for the latest version are returned." },
      },
      required: ["namespace", "type"],
    },
  },
  {
    name: "get_latest_provider_version",
    description: "Get the latest published version of a registry provider.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Namespace of the provider in the Terraform Registry." },
        type: { type: "string", description: "Provider type, the short name that identifies the provider within its namespace." },
      },
      required: ["namespace", "type"],
    },
  },
  {
    name: "search_policies",
    description: "Search the Terraform Registry for Sentinel policies matching a query.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search text used to find Sentinel policy sets in the Terraform Registry." },
        offset: { type: "number", description: "Optional pagination offset for the policy search results." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_policy_details",
    description: "Fetch details for one registry policy set by namespace and name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "Namespace of the policy set in the Terraform Registry." },
        name: { type: "string", description: "Name of the policy set in the Terraform Registry." },
      },
      required: ["namespace", "name"],
    },
  },
  {
    name: "list_workspaces",
    description: "List HCP Terraform workspaces in an organization. Requires TFE_TOKEN.",
    inputSchema: {
      type: "object" as const,
      properties: { organization: { type: "string", description: "Name of the HCP Terraform organization whose workspaces should be listed." } },
      required: ["organization"],
    },
  },
  {
    name: "get_workspace",
    description: "Fetch one HCP Terraform workspace by organization and workspace name. Requires TFE_TOKEN.",
    inputSchema: {
      type: "object" as const,
      properties: {
        organization: { type: "string", description: "Name of the HCP Terraform organization that owns the workspace." },
        workspace: { type: "string", description: "Name of the HCP Terraform workspace to fetch." },
      },
      required: ["organization", "workspace"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "infraport", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const token = process.env[TOKEN_ENV];
  try {
    let out: unknown;
    if (name === "search_modules") {
      out = await searchModules(fetchFn, SearchModulesArgs.parse(args ?? {}));
    } else if (name === "get_module_details") {
      out = await getModuleDetails(fetchFn, GetModuleDetailsArgs.parse(args ?? {}));
    } else if (name === "get_latest_module_version") {
      out = await getLatestModuleVersion(fetchFn, GetLatestModuleVersionArgs.parse(args ?? {}));
    } else if (name === "search_providers") {
      out = await searchProviders(fetchFn, SearchProvidersArgs.parse(args ?? {}));
    } else if (name === "get_provider_details") {
      out = await getProviderDetails(fetchFn, GetProviderDetailsArgs.parse(args ?? {}));
    } else if (name === "get_latest_provider_version") {
      out = await getLatestProviderVersion(fetchFn, GetLatestProviderVersionArgs.parse(args ?? {}));
    } else if (name === "search_policies") {
      out = await searchPolicies(fetchFn, SearchPoliciesArgs.parse(args ?? {}));
    } else if (name === "get_policy_details") {
      out = await getPolicyDetails(fetchFn, GetPolicyDetailsArgs.parse(args ?? {}));
    } else if (name === "list_workspaces") {
      out = await listWorkspaces(fetchFn, token, ListWorkspacesArgs.parse(args ?? {}));
    } else if (name === "get_workspace") {
      out = await getWorkspace(fetchFn, token, GetWorkspaceArgs.parse(args ?? {}));
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
