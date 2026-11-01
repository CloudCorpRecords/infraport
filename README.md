# infraport

infraport is a small reader for Terraform's two public surfaces.
The Terraform Registry is where modules, providers, and Sentinel
policy sets are published; infraport searches it and reads the
record for a single module, provider, or policy set, including the
latest published version of a module or provider. HCP Terraform is
where workspaces live; infraport lists the workspaces in an
organization and reads one workspace by name. One binary serves a
command-line interface and a stdio MCP server.

The two surfaces differ in one important way: the Registry is
keyless. Registry commands and tools work with no credentials at
all, and no `Authorization` header is ever sent to it. Only the two
workspace tools need a token — an HCP Terraform API token in the
`TFE_TOKEN` environment variable, sent as `Authorization: Bearer`
to `app.terraform.io`. When `TFE_TOKEN` is missing, a workspace
call fails with an error that names the variable, before any
request is made; registry calls are unaffected.

## Install

```bash
npx @reneturcios/infraport search-modules vpc
```

Or run the container image:

```bash
docker run -i -e TFE_TOKEN ghcr.io/cloudcorprecords/infraport
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

```bash
infraport search-modules vpc
infraport module terraform-aws-modules vpc aws
infraport module-version terraform-aws-modules vpc aws
infraport search-providers aws
infraport provider hashicorp aws
infraport provider-version hashicorp aws
infraport search-policies tags
infraport policy hashicorp enforce-tags

export TFE_TOKEN=<your HCP Terraform token>
infraport workspaces my-org
infraport workspace my-org prod

infraport --version
```

Each command prints the upstream JSON payload. The two
`*-version` commands print a small object holding the extracted
`version` plus the full registry payload it came from. Exit codes:
`0` on success, `1` when a call fails (including a missing
`TFE_TOKEN` for workspace commands, or an API error), `2` for usage
errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/infraport mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "infraport": {
      "command": "npx",
      "args": ["-y", "@reneturcios/infraport", "mcp"],
      "env": { "TFE_TOKEN": "..." }
    }
  }
}
```

The `env` entry is only needed for the two workspace tools; the
eight registry tools work without it.

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `search_modules` | `query` (required), `provider`, `offset` (optional) | Registry modules matching the query. |
| `get_module_details` | `namespace`, `name`, `provider` (required), `version` (optional) | The module record. |
| `get_latest_module_version` | `namespace`, `name`, `provider` (required) | The latest version extracted from the module record, plus that record. |
| `search_providers` | `query` (required), `offset` (optional) | Registry providers matching the query. |
| `get_provider_details` | `namespace`, `type` (required), `version` (optional) | The provider record. |
| `get_latest_provider_version` | `namespace`, `type` (required) | The latest version extracted from the provider record, plus that record. |
| `search_policies` | `query` (required), `offset` (optional) | Registry policy sets matching the query. |
| `get_policy_details` | `namespace`, `name` (required) | The policy set record. |
| `list_workspaces` | `organization` (required) | Workspaces in the organization. Requires `TFE_TOKEN`. |
| `get_workspace` | `organization`, `workspace` (required) | One workspace. Requires `TFE_TOKEN`. |

Registry calls use `https://registry.terraform.io/v1` and send no
authorization. Workspace calls use `https://app.terraform.io/api/v2`
with a Bearer token and the `application/vnd.api+json` content type.

This build covers a core subset: the eight registry tools above
plus workspace listing and reading. It does not manage runs, create
or change workspaces, edit variables, or publish modules, providers,
or policies.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch fixtures)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
