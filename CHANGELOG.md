# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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