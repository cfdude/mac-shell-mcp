# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

The Mac Shell MCP server executes system commands and takes security seriously. If you discover a security vulnerability, please follow these steps:

1. **DO NOT** open a public issue
2. Email the maintainers at [security@your-email.com] with:
   - A description of the vulnerability
   - Steps to reproduce the issue
   - Potential impact
   - Suggested fix (if any)

We will acknowledge your email within 48 hours and provide a detailed response within 7 days.

## Security Features

This MCP server implements several security measures:

- **Command Whitelisting**: Only pre-approved commands can be executed
- **Security Levels**: Commands are categorized as safe, requires approval, or forbidden
- **Approval Workflow**: Potentially dangerous commands require explicit approval
- **Argument Validation**: Command arguments are validated against patterns
- **No Shell Injection**: Uses `execFile` instead of `exec` to prevent injection attacks
- **User Permissions**: Commands run with the permissions of the MCP server user

## Best Practices

When using this MCP server:

1. **Review the whitelist** regularly and remove unnecessary commands
2. **Set appropriate security levels** for commands based on your use case
3. **Never run the server with elevated privileges** (e.g., sudo)
4. **Monitor pending commands** and only approve those you trust
5. **Keep the server updated** to receive security patches

## Known Limitations

- Commands execute with the full permissions of the user running the server
- The approval mechanism relies on the MCP client implementation
- File system access is limited only by OS permissions