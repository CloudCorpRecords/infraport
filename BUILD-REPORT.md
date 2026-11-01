# infraport — Build Report

MCP Rebuild 100, Tier B. Clean-room rebuild of the HashiCorp
terraform-mcp-server, built from the public Terraform Registry API
and HCP Terraform API documentation captured in
`harness/fixtures/terraform-tools-original.json` only. The fixture
was created for this build, marked `"_source": docs-derived CORE
SUBSET ... labelled core-subset: 10 tools (8 registry + 2
workspace) ... Parity is against this subset only. Not
hand-probed`. Local build only — nothing pushed or published, and
no live network call was made or claimed at any point.

Identity: repo `infraport`, npm `@reneturcios/infraport`,
MCP name `io.github.CloudCorpRecords/infraport`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `infraport: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Terraform Registry modules,
  providers and policies, plus HCP Terraform workspaces." =
  **82 chars** (≤100 ✓); npm entry carries `version: 0.1.0`; OCI
  entry `ghcr.io/cloudcorprecords/infraport:0.1.0` carries **no**
  `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/infraport"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`search-modules`, `module`,
  `module-version`, `search-providers`, `provider`,
  `provider-version`, `search-policies`, `policy`, `workspaces`,
  `workspace`, `mcp`, `--version`; exit 2 usage / 1 API error),
  `src/mcp.ts`, `src/types.ts`, `src/infraport.ts` (core logic,
  `VERSION = "0.1.0"`)
- `test/infraport.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to infraport)

## Tools implemented (10/10, core subset)

Registry (keyless): `search_modules`, `get_module_details`,
`get_latest_module_version`, `search_providers`,
`get_provider_details`, `get_latest_provider_version`,
`search_policies`, `get_policy_details`.
HCP Terraform workspaces: `list_workspaces`, `get_workspace`.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals, per the standing fleet rule: `McpServer`'s
  zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties` keys that are absent from the public spec
  and break exact schema parity. Zod still validates every
  `tools/call`.
- Two surfaces, kept separate:
  - Registry under `https://registry.terraform.io/v1`:
    `GET /modules/search?q=&provider=&offset=` (only provided
    params are included), `GET /modules/{ns}/{name}/{provider}`
    (`/{version}` appended only when a version is given),
    `GET /providers/search`, `GET /providers/{ns}/{type}`
    (`/{version}` likewise), `GET /policies/search`,
    `GET /policies/{ns}/{name}`. Registry calls send **no**
    Authorization header and never require a token.
  - HCP Terraform under `https://app.terraform.io/api/v2`:
    `GET /organizations/{org}/workspaces` and
    `GET /organizations/{org}/workspaces/{name}`, with
    `Authorization: Bearer` and
    `Content-Type: application/vnd.api+json`.
- `TFE_TOKEN` is read at call time in both the MCP server and the
  CLI. Only the two workspace tools require it: `requireTfeToken`
  throws before any request with an error naming `TFE_TOKEN`
  (verified over stdio and in unit tests, where the fake fetch is
  asserted never called). Registry tools ignore the token entirely
  and do not error when it is absent.
- Latest-version extraction is a local contract over the
  documented module/provider payload (see Gaps):
  `get_latest_module_version` GETs the module record and returns
  `{version, module: <payload>}`, taking the version from
  `payload.version` or `modules[0].version`; if none is found it
  errors with "no version found in registry response".
  `get_latest_provider_version` is the analogous
  `{version, provider: <payload>}` shape.
- HTTP failures surface the status plus the upstream
  `errors[0].detail`/`title` (or a string error / top-level
  `message`) when present.
- All HTTP flows through an injectable `FetchFn` (types.ts). The
  test suite uses a fake fetch returning hand-written
  Terraform-shaped JSON fixtures — **no live call was performed**.

## Verification (foreground, exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo tsc_exit=$?
tsc_exit=0
```
`dist/` produced, including `dist/cli.js`.

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 20
ℹ pass 20
ℹ fail 0
```
Covers: search_modules URL query composition (provider/offset
included when given, omitted when absent); registry calls sending
no Authorization header; module details version path on and off;
latest module version extraction from both `.version` and
`modules[0].version` payloads and the no-version error; providers
search/details (version path on/off) and latest-version
extraction; policies search/details; `list_workspaces` and
`get_workspace` without a token erroring naming `TFE_TOKEN` with
the fetch never called; with a token, Bearer +
`application/vnd.api+json` headers to `app.terraform.io`; and HTTP
errors surfacing `errors[0].detail`, a string error, and a
top-level message.

### 3. CLI / MCP smoke
`--version` → `0.1.0`; unknown command exits 2 with Usage. MCP
`initialize` over stdio → `serverInfo: {"name":"infraport",
"version":"0.1.0"}`. A `tools/call` for `list_workspaces` with
`TFE_TOKEN` unset returned `isError: true` with text
"TFE_TOKEN environment variable is required: set TFE_TOKEN to an
HCP Terraform API token and retry". Live API calls were **not**
run (no token, egress blocked).

### 4. Parity (harness, from ~/workspace/mcp-rebuild-100/harness/)
```
$ python3 parity.py --original fixtures/terraform-tools-original.json \
    --rebuild "stdio:node .../builds/infraport/dist/cli.js mcp" \
    --out .../builds/infraport/parity-out
verdict=PASS parity_pct=100.0 original_tools=10 rebuild_tools=10 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
(parity.json: identical_tools 10/10.) Original side is tools-file
mode, so `fixture_results` records `SKIPPED-TOOLS-FILE-MODE` —
expected harness semantics, not an error. Parity is against the
labelled 10-tool core subset only.

## Lockfile status

`package-lock.json` was copied from modelrun's and its identity
fields edited (top-level `name`, root package `name`, root package
`bin` key → infraport; dependency ranges are identical, so the
tree is unchanged). **Clean lockfile regen required before
publish** (regenerate with no `node_modules` present); do not
publish from this lockfile as-is. `node_modules` here is a copy of
modelrun's; `.bin/tsc` / `.bin/tsx` verified working after
`chmod +x`.

## Gaps / honest notes

- Subset omissions (recorded in the fixture `_source`, not
  rebuilt): policy details/search depth tools beyond the two
  policy tools, HCP run management (create/list runs,
  apply/discard), workspace create/update/delete and variables,
  and module/provider publishing. The 100.0% parity is against
  the labelled 10-tool subset only, never the full documented
  terraform-mcp-server surface.
- No live Terraform Registry or HCP Terraform call was made (VM
  egress is blocked and no `TFE_TOKEN` is available in this
  environment). Request construction is written against the
  documented API paths and payload shapes; live payload drift is
  unverified until the publish wave can smoke, including with a
  real token for the workspace tools. Behaviour parity is
  tool/schema + docs-contract, not live-proven.
- Latest-version extraction is a local contract over the
  documented module/provider payload, not a documented upstream
  endpoint: there is no dedicated "latest version" route in the
  spec used here, so infraport reads the module/provider record
  and extracts `version` (or the first listed record's `version`).
  If the live Registry payload nests the current version
  differently, this extraction is the first check at publish-wave
  live smoke; a payload with no extractable version fails honestly
  instead of inventing one.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
