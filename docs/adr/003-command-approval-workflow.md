# ADR 003: Command Approval Workflow

## Status

Accepted

## Context

When executing shell commands, there's a middle ground between completely safe commands and forbidden commands. Some commands can modify the system in potentially harmful ways but are still necessary for legitimate use cases. We need a mechanism to handle these commands safely.

Options considered:
1. Reject all potentially dangerous commands
2. Allow all commands with appropriate warnings
3. Implement an approval workflow for commands that require additional verification

## Decision

We will implement an approval workflow for commands that are potentially dangerous but still necessary. This workflow will:

1. Queue commands marked as requiring approval
2. Provide tools to list pending commands
3. Allow explicit approval or denial of pending commands
4. Execute approved commands and reject denied commands

This approach balances security with usability by allowing potentially dangerous commands to be executed after explicit approval.

## Consequences

### Positive

- Provides a middle ground between allowing and forbidding commands
- Creates an audit trail of command approvals
- Allows for human judgment in borderline cases
- Enables safe use of necessary system-modifying commands
- Prevents accidental execution of dangerous commands

### Negative

- Introduces asynchronous workflow for command execution
- Requires additional user interaction for approval
- May create confusion if approvals are delayed or forgotten

## Implementation

The approval workflow will be implemented using a queue of pending commands:

```typescript
interface PendingCommand {
  id: string;
  command: string;
  args: string[];
  requestedAt: Date;
  requestedBy?: string;
  resolve: (value: CommandResult) => void;
  reject: (reason: Error) => void;
}
```

When a command requiring approval is executed, it will be added to the queue:

```typescript
private queueCommandForApproval(
  command: string,
  args: string[] = [],
  requestedBy?: string
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const pendingCommand: PendingCommand = {
      id,
      command,
      args,
      requestedAt: new Date(),
      requestedBy,
      resolve,
      reject
    };

    this.pendingCommands.set(id, pendingCommand);
    this.emit('command:pending', pendingCommand);
  });
}
```

The MCP server will expose tools to list, approve, and deny pending commands:

```typescript
// Get pending commands
const pendingCommands = await client.callTool('get_pending_commands', {});

// Approve a command
await client.callTool('approve_command', { commandId });

// Deny a command
await client.callTool('deny_command', { commandId, reason: 'Not allowed' });
```

This workflow ensures that potentially dangerous commands are only executed after explicit approval, providing an additional layer of security.