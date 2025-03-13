# ADR 001: Command Security Levels

## Status

Accepted

## Context

When executing shell commands through an MCP server, there's a significant security risk if all commands are allowed without restrictions. Different commands have varying levels of potential impact on the system:

1. Some commands are relatively safe (e.g., `ls`, `pwd`, `echo`)
2. Some commands can modify the system but in limited ways (e.g., `mkdir`, `cp`, `mv`)
3. Some commands can cause significant damage (e.g., `rm -rf`, `sudo`)

We need a mechanism to categorize commands based on their potential risk and handle them accordingly.

## Decision

We will implement a three-tier security level system for commands:

1. **Safe Commands**: These commands can be executed immediately without approval. They are read-only or have minimal impact on the system.

2. **Commands Requiring Approval**: These commands can modify the system but are not inherently dangerous. They will be queued for explicit approval before execution.

3. **Forbidden Commands**: These commands are considered too dangerous and will be rejected outright.

Each command will be categorized in a whitelist, and the security level will determine how the command is handled when execution is requested.

## Consequences

### Positive

- Provides a clear security model for command execution
- Allows safe commands to be executed without friction
- Creates an approval workflow for potentially dangerous commands
- Completely blocks high-risk commands
- Makes the security policy explicit and configurable

### Negative

- Requires maintaining a whitelist of commands
- May introduce friction for legitimate use cases of commands requiring approval
- Initial categorization may not be perfect and could require adjustment

## Implementation

The security levels will be implemented as an enum in the `CommandService` class:

```typescript
export enum CommandSecurityLevel {
  SAFE = 'safe',
  REQUIRES_APPROVAL = 'requires_approval',
  FORBIDDEN = 'forbidden'
}
```

Commands will be stored in a whitelist with their security level:

```typescript
export interface CommandWhitelistEntry {
  command: string;
  securityLevel: CommandSecurityLevel;
  allowedArgs?: Array<string | RegExp>;
  description?: string;
}
```

When a command is executed, its security level will determine the behavior:
- Safe commands are executed immediately
- Commands requiring approval are queued for explicit approval
- Forbidden commands are rejected with an error