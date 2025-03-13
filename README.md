# Mac Shell MCP Server

An MCP (Model Context Protocol) server for executing macOS terminal commands with ZSH shell. This server provides a secure way to execute shell commands with built-in whitelisting and approval mechanisms.

## Features

- Execute macOS terminal commands through MCP
- Command whitelisting with security levels:
  - **Safe**: Commands that can be executed without approval
  - **Requires Approval**: Commands that need explicit approval before execution
  - **Forbidden**: Commands that are explicitly blocked
- Pre-configured whitelist with common safe commands
- Approval workflow for potentially dangerous commands
- Comprehensive command management tools

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/mac-shell-mcp.git
cd mac-shell-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

## Usage

### Starting the Server

```bash
npm start
```

Or directly:

```bash
node build/index.js
```

### Connecting to Claude Desktop

1. Open Claude Desktop settings
2. Navigate to MCP settings
3. Add a new MCP server with the following configuration:
   - Name: Mac Shell
   - Command: `node /path/to/mac-shell-mcp/build/index.js`
4. Save and restart Claude Desktop

### Available Tools

The server exposes the following MCP tools:

#### `execute_command`

Execute a shell command on macOS.

```json
{
  "command": "ls",
  "args": ["-la"]
}
```

#### `get_whitelist`

Get the list of whitelisted commands.

```json
{}
```

#### `add_to_whitelist`

Add a command to the whitelist.

```json
{
  "command": "python3",
  "securityLevel": "safe",
  "description": "Run Python 3 scripts"
}
```

#### `update_security_level`

Update the security level of a whitelisted command.

```json
{
  "command": "python3",
  "securityLevel": "requires_approval"
}
```

#### `remove_from_whitelist`

Remove a command from the whitelist.

```json
{
  "command": "python3"
}
```

#### `get_pending_commands`

Get the list of commands pending approval.

```json
{}
```

#### `approve_command`

Approve a pending command.

```json
{
  "commandId": "command-uuid-here"
}
```

#### `deny_command`

Deny a pending command.

```json
{
  "commandId": "command-uuid-here",
  "reason": "This command is potentially dangerous"
}
```

## Default Whitelisted Commands

### Safe Commands (No Approval Required)

- `ls` - List directory contents
- `pwd` - Print working directory
- `echo` - Print text to standard output
- `cat` - Concatenate and print files
- `grep` - Search for patterns in files
- `find` - Find files in a directory hierarchy
- `cd` - Change directory
- `head` - Output the first part of files
- `tail` - Output the last part of files
- `wc` - Print newline, word, and byte counts

### Commands Requiring Approval

- `mv` - Move (rename) files
- `cp` - Copy files and directories
- `mkdir` - Create directories
- `touch` - Change file timestamps or create empty files
- `chmod` - Change file mode bits
- `chown` - Change file owner and group

### Forbidden Commands

- `rm` - Remove files or directories
- `sudo` - Execute a command as another user

## Security Considerations

- All commands are executed with the permissions of the user running the MCP server
- Commands requiring approval are held in a queue until explicitly approved
- Forbidden commands are never executed
- The server uses Node.js's `execFile` instead of `exec` to prevent shell injection
- Arguments are validated against allowed patterns when specified

## Extending the Whitelist

You can extend the whitelist by using the `add_to_whitelist` tool. For example:

```json
{
  "command": "npm",
  "securityLevel": "requires_approval",
  "description": "Node.js package manager"
}
```

## License

MIT