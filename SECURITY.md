# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| < 1.1   | :x:                |

## Reporting a Vulnerability

The Mac Shell MCP server executes system commands and takes security seriously. If you discover a security vulnerability, please follow these steps:

1. **DO NOT** open a public issue
2. Report it privately, by either route:
   - **Preferred:** [GitHub private vulnerability reporting](https://github.com/cfdude/mac-shell-mcp/security/advisories/new)
   - Email **security@onvex.ai**

   Please include:
   - A description of the vulnerability
   - Steps to reproduce the issue
   - Potential impact
   - Suggested fix (if any)

We will acknowledge your email within 48 hours and provide a detailed response within 7 days.

## Security Features

This MCP server implements several security measures:

- **Command Whitelisting**: Only pre-approved commands can be executed
- **Security Levels**: Commands are categorized as safe, requires approval, or forbidden
- **User Permissions**: Commands run with the permissions of the MCP server user

> **Accuracy note (2026-08-28).** Earlier versions of this document claimed
> "No Shell Injection: Uses `execFile` instead of `exec` to prevent injection attacks"
> and described the approval workflow as an enforced control. **Neither claim holds in
> 1.x**, and both have been removed rather than restated. Treat 1.x as providing no
> meaningful sandbox. A redesign correcting this ships in 2.0.0; see
> `docs/superpowers/specs/2026-08-13-mac-shell-mcp-2.0-security-redesign.md`.

## Best Practices

When using this MCP server:

1. **Review the whitelist** regularly and remove unnecessary commands
2. **Set appropriate security levels** for commands based on your use case
3. **Never run the server with elevated privileges** (e.g., sudo)
4. **Do not rely on the 1.x approval workflow as a security boundary** — configure your
   MCP client to prompt for tool calls instead
5. **Keep the server updated** to receive security patches

## Known Limitations

- Commands execute with the full permissions of the user running the server
- **In 1.x the approval mechanism is not an enforced control** and must not be treated as one
- File system access is limited only by OS permissions — 1.x does not confine commands to any directory
- Unfixed vulnerabilities in 1.x are tracked in this repository's
  [security advisories](https://github.com/cfdude/mac-shell-mcp/security/advisories)

## Distribution

The npm package named `mac-shell-mcp` is **not published by this project** and is not under
its control. Install from this repository until an officially published package is announced.