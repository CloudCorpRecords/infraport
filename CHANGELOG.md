# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `infraport search-modules|module|module-version|search-providers|provider|provider-version|search-policies|policy|workspaces|workspace`
  and `infraport mcp`. Registry commands need no token; workspace
  commands read the HCP Terraform token from `TFE_TOKEN`.
- MCP server (`infraport mcp`, stdio) with ten tools:
  `search_modules`, `get_module_details`,
  `get_latest_module_version`, `search_providers`,
  `get_provider_details`, `get_latest_provider_version`,
  `search_policies`, `get_policy_details`, `list_workspaces`, and
  `get_workspace`.
- Registry calls go to `https://registry.terraform.io/v1` with no
  Authorization header. Workspace calls go to
  `https://app.terraform.io/api/v2` with the token sent as an
  `Authorization: Bearer` header and the
  `application/vnd.api+json` content type.
- The latest-version tools extract the version from the documented
  module/provider payload (`version`, or the first listed record's
  `version`) and fail honestly when no version is present.
- A missing `TFE_TOKEN` fails only the workspace tools, with an
  error naming the variable, before any request is made.
- All HTTP goes through an injectable fetch function, so the test
  suite runs entirely on hand-written fixtures with no network access.
