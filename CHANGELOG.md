# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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