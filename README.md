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
git clone https://github.com/cfdude/mac-shell-mcp.git
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

### Configuring in Roo Code and Claude Desktop

Both Roo Code and Claude Desktop use a similar configuration format for MCP servers. Here's how to set up the Mac Shell MCP server:

#### Using Local Installation

##### Roo Code Configuration

Add the following to your Roo Code MCP settings configuration file (located at `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json`):

```json
"mac-shell": {
  "command": "node",
  "args": [
    "/path/to/mac-shell-mcp/build/index.js"
  ],
  "alwaysAllow": [],
  "disabled": false
}
```

##### Claude Desktop Configuration

Add the following to your Claude Desktop configuration file (located at `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
"mac-shell": {
  "command": "node",
  "args": [
    "/path/to/mac-shell-mcp/build/index.js"
  ],
  "alwaysAllow": false,
  "disabled": false
}
```

Replace `/path/to/mac-shell-mcp` with the actual path where you cloned the repository.

#### Using NPX (Recommended)

For a more convenient setup that doesn't require keeping a terminal window open, you can publish the package to npm and use it with npx:

##### Publishing to npm

1. Update the package.json with your details
2. Publish to npm:
   ```bash
   npm publish
   ```

##### Roo Code Configuration

```json
"mac-shell": {
  "command": "npx",
  "args": [
    "-y",
    "mac-shell-mcp"
  ],
  "alwaysAllow": [],
  "disabled": false
}
```

##### Claude Desktop Configuration

```json
"mac-shell": {
  "command": "npx",
  "args": [
    "-y",
    "mac-shell-mcp"
  ],
  "alwaysAllow": false,
  "disabled": false
}
```

This approach allows the MCP server to be started automatically by the MCP client without requiring a separate terminal window or manual intervention.

> **Note**:
> - For Roo Code: Setting `alwaysAllow` to an empty array `[]` is recommended for security reasons, as it will prompt for approval before executing any commands. If you want to allow specific commands without prompting, you can add their names to the array, for example: `"alwaysAllow": ["execute_command", "get_whitelist"]`.
> - For Claude Desktop: Setting `alwaysAllow` to `false` is recommended for security reasons. Claude Desktop uses a boolean value instead of an array, where `false` means all commands require approval and `true` means all commands are allowed without prompting.
>
> **Important**: The `alwaysAllow` parameter is processed by the MCP client (Roo Code or Claude Desktop), not by the Mac Shell MCP server itself. The server will work correctly with either format, as the client handles the approval process before sending requests to the server.

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

## Using as an npm Package

To use the Mac Shell MCP server with `npx` similar to other MCP servers like Brave Search, you can publish it to npm or use it directly from GitHub.

### Configuration with npx

Add the following to your MCP settings configuration:

#### Roo Code
```json
"mac-shell": {
  "command": "npx",
  "args": [
    "-y",
    "github:cfdude/mac-shell-mcp"
  ],
  "alwaysAllow": [],
  "disabled": false
}
```

#### Claude Desktop
```json
"mac-shell": {
  "command": "npx",
  "args": [
    "-y",
    "github:cfdude/mac-shell-mcp"
  ],
  "alwaysAllow": false,
  "disabled": false
}
```

This will automatically download and run the server without requiring a manual clone and build process.

### Publishing to npm

If you want to publish your own version to npm:

1. Update the package.json with your details
2. Add a "bin" field to package.json:
   ```json
   "bin": {
     "mac-shell-mcp": "./build/index.js"
   }
   ```
3. Publish to npm:
   ```bash
   npm publish
   ```

Then you can use it in your MCP configuration:

#### Roo Code
```json
"mac-shell": {
  "command": "npx",
  "args": [
    "-y",
    "mac-shell-mcp"
  ],
  "alwaysAllow": [],
  "disabled": false
}
```

#### Claude Desktop
```json
"mac-shell": {
  "command": "npx",
  "args": [
    "-y",
    "mac-shell-mcp"
  ],
  "alwaysAllow": false,
  "disabled": false
}
```

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
