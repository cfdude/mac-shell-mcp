# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-08-29

### Security

Fixes two vulnerability classes reported by four independent researchers.

- **CWE-862 — self-approval** (`GHSA-q7hh-g47q-hwqj`, Taran-Douley). The agent held the tools that approved its own requests, and the whitelist was mutable at runtime, so any client could promote a forbidden command to `safe`.
- **CWE-78 — shell injection** (`GHSA-2h3j-235x-vx2q` hackwither; `GHSA-8qwq-gwp3-g5h7` infosec-traceforce; `GHSA-h926-3g54-mr3v` bebold6133). `execFile` was called with a `shell` option, so arguments were concatenated into a shell command line and re-parsed.

### BREAKING

- Removed seven tools: `add_to_whitelist`, `update_security_level`, `remove_from_whitelist`, `approve_command`, `deny_command`, `get_pending_commands`, `get_whitelist`. No tool mutates policy; they are absent rather than gated.
- Runtime whitelist edits are replaced by a config file read once at startup.
- The default command set is now `ls pwd echo cat head tail wc grep`. `find`, `git` and every interpreter must be added deliberately.

### Added

- `get_policy` and `suggest_policy_config`
- `execute_external_command` as the sole route outside configured roots
- Configured roots, program directories, argument allowlists and per-command permissions
- Append-only audit log, bounded by rotation
- MCPB manifest and a sample configuration file

### Changed

- `execFile` is never given a `shell` option
- The child environment is constructed rather than inherited
- Programs resolve from configured program directories and are matched by resolved path, not basename
- Scope covers the working directory as well as path-shaped arguments
- Protection keys on the operation a request performs, not a declared effect
- Exit codes are preserved: a `grep` with no match is a normal result, not an error
- Output is capped by stopping collection; execution and concurrency are bounded
- TypeScript 6.0.3, MCP SDK 1.30, zod 4, ESLint 10, Jest 30

### Removed

- Delete support. `rm` was `FORBIDDEN` in 1.x, so this is zero regression. The git-aware recoverability design is preserved in `openspec/deferred/delete-safety-2.1.md`.

## [1.1.0] - 2025-01-25

### Added

- ESLint and Prettier configuration for code quality and formatting
- Comprehensive documentation files:
  - LICENSE (MIT)
  - CONTRIBUTORS.md
  - CONTRIBUTING.md
  - SECURITY.md
- Docker support with Dockerfile and .dockerignore
- Smithery package registry configuration (smithery.json)
- GitHub Actions CI workflow for automated testing
- Repository metadata in package.json (author: Rob Sherman, repository, bugs, homepage)
- .claude directory to .gitignore

### Changed

- Fixed all TypeScript linting warnings (replaced `any` with `unknown`)
- Updated Jest configuration to fix ESM module warnings
- Enhanced package.json with complete metadata

### Fixed

- TypeScript type safety improvements in command handlers

## [1.0.4] - 2025-03-12

### Added

- Added documentation for using the MCP server with npx
- Included instructions for publishing the package to npm
- Provided configuration examples for both Roo Code and Claude Desktop using npx

## [1.0.3] - 2025-03-12

### Fixed

- Improved documentation for Claude Desktop configuration which uses boolean value for `alwaysAllow`
- Added separate configuration examples for Roo Code and Claude Desktop
- Clarified that Roo Code uses array format while Claude Desktop uses boolean format
- Added explicit note that the `alwaysAllow` parameter is processed by the MCP client, not the server

## [1.0.2] - 2025-03-12

### Fixed

- Fixed MCP configuration format to use an empty array `[]` for `alwaysAllow` instead of `false`
- Updated all configuration examples in README.md to use the correct format
- Fixed error "Invalid config: missing or invalid parameters" when adding to MCP settings

## [1.0.1] - 2025-03-12

### Added

- Support for using the server as an npm package with npx
- Added bin field to package.json for CLI usage
- Improved MCP configuration instructions for Roo Code and Claude Desktop
- Added examples for using with npx directly from GitHub

## [1.0.0] - 2025-03-12

### Added

- Initial release of the Mac Shell MCP Server
- Command execution service with ZSH shell support
- Command whitelisting system with three security levels:
  - Safe commands (no approval required)
  - Commands requiring approval
  - Forbidden commands
- Pre-configured whitelist with common safe commands
- Approval workflow for potentially dangerous commands
- MCP tools for command execution and whitelist management:
  - `execute_command`: Execute shell commands
  - `get_whitelist`: Get the list of whitelisted commands
  - `add_to_whitelist`: Add a command to the whitelist
  - `update_security_level`: Update a command's security level
  - `remove_from_whitelist`: Remove a command from the whitelist
  - `get_pending_commands`: Get commands pending approval
  - `approve_command`: Approve a pending command
  - `deny_command`: Deny a pending command
- Comprehensive test suite for the command service
- Example client implementation
- Documentation and configuration examples
