#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CommandService, CommandSecurityLevel } from './services/command-service.js';

/**
 * MacShellMcpServer - MCP server for executing macOS terminal commands with ZSH
 */
class MacShellMcpServer {
  private server: Server;
  private commandService: CommandService;
  private pendingApprovals: Map<string, { command: string; args: string[] }>;

  constructor() {
    // Initialize the command service with ZSH shell
    this.commandService = new CommandService('/bin/zsh');
    this.pendingApprovals = new Map();

    // Initialize the MCP server
    this.server = new Server(
      {
        name: 'mac-shell-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Set up event handlers for command service
    this.setupCommandServiceEvents();

    // Set up MCP request handlers
    this.setupRequestHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Set up event handlers for the command service
   */
  private setupCommandServiceEvents(): void {
    this.commandService.on('command:pending', (pendingCommand) => {
      console.error(`[Pending Command] ID: ${pendingCommand.id}, Command: ${pendingCommand.command} ${pendingCommand.args.join(' ')}`);
      this.pendingApprovals.set(pendingCommand.id, {
        command: pendingCommand.command,
        args: pendingCommand.args,
      });
    });

    this.commandService.on('command:approved', (data) => {
      console.error(`[Approved Command] ID: ${data.commandId}`);
      this.pendingApprovals.delete(data.commandId);
    });

    this.commandService.on('command:denied', (data) => {
      console.error(`[Denied Command] ID: ${data.commandId}, Reason: ${data.reason}`);
      this.pendingApprovals.delete(data.commandId);
    });

    this.commandService.on('command:failed', (data) => {
      console.error(`[Failed Command] ID: ${data.commandId}, Error: ${data.error.message}`);
      this.pendingApprovals.delete(data.commandId);
    });
  }

  /**
   * Set up MCP request handlers
   */
  private setupRequestHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'execute_command',
          description: 'Execute a shell command on macOS',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'The command to execute',
              },
              args: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Command arguments',
              },
            },
            required: ['command'],
          },
        },
        {
          name: 'get_whitelist',
          description: 'Get the list of whitelisted commands',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'add_to_whitelist',
          description: 'Add a command to the whitelist',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'The command to whitelist',
              },
              securityLevel: {
                type: 'string',
                enum: ['safe', 'requires_approval', 'forbidden'],
                description: 'Security level for the command',
              },
              description: {
                type: 'string',
                description: 'Description of the command',
              },
            },
            required: ['command', 'securityLevel'],
          },
        },
        {
          name: 'update_security_level',
          description: 'Update the security level of a whitelisted command',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'The command to update',
              },
              securityLevel: {
                type: 'string',
                enum: ['safe', 'requires_approval', 'forbidden'],
                description: 'New security level for the command',
              },
            },
            required: ['command', 'securityLevel'],
          },
        },
        {
          name: 'remove_from_whitelist',
          description: 'Remove a command from the whitelist',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'The command to remove from whitelist',
              },
            },
            required: ['command'],
          },
        },
        {
          name: 'get_pending_commands',
          description: 'Get the list of commands pending approval',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'approve_command',
          description: 'Approve a pending command',
          inputSchema: {
            type: 'object',
            properties: {
              commandId: {
                type: 'string',
                description: 'ID of the command to approve',
              },
            },
            required: ['commandId'],
          },
        },
        {
          name: 'deny_command',
          description: 'Deny a pending command',
          inputSchema: {
            type: 'object',
            properties: {
              commandId: {
                type: 'string',
                description: 'ID of the command to deny',
              },
              reason: {
                type: 'string',
                description: 'Reason for denial',
              },
            },
            required: ['commandId'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'execute_command':
            return await this.handleExecuteCommand(args);
          case 'get_whitelist':
            return await this.handleGetWhitelist();
          case 'add_to_whitelist':
            return await this.handleAddToWhitelist(args);
          case 'update_security_level':
            return await this.handleUpdateSecurityLevel(args);
          case 'remove_from_whitelist':
            return await this.handleRemoveFromWhitelist(args);
          case 'get_pending_commands':
            return await this.handleGetPendingCommands();
          case 'approve_command':
            return await this.handleApproveCommand(args);
          case 'deny_command':
            return await this.handleDenyCommand(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        
        if (error instanceof Error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          'An unexpected error occurred'
        );
      }
    });
  }

  /**
   * Handle execute_command tool
   */
  private async handleExecuteCommand(args: any) {
    const schema = z.object({
      command: z.string(),
      args: z.array(z.string()).optional(),
    });

    const { command, args: commandArgs = [] } = schema.parse(args);

    try {
      const result = await this.commandService.executeCommand(command, commandArgs);
      
      return {
        content: [
          {
            type: 'text',
            text: result.stdout,
          },
          {
            type: 'text',
            text: result.stderr ? `Error output: ${result.stderr}` : '',
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          content: [
            {
              type: 'text',
              text: `Command execution failed: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  }

  /**
   * Handle get_whitelist tool
   */
  private async handleGetWhitelist() {
    const whitelist = this.commandService.getWhitelist();
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(whitelist, null, 2),
        },
      ],
    };
  }

  /**
   * Handle add_to_whitelist tool
   */
  private async handleAddToWhitelist(args: any) {
    const schema = z.object({
      command: z.string(),
      securityLevel: z.enum(['safe', 'requires_approval', 'forbidden']),
      description: z.string().optional(),
    });

    const { command, securityLevel, description } = schema.parse(args);

    // Map string security level to enum
    const securityLevelEnum = securityLevel === 'safe'
      ? CommandSecurityLevel.SAFE
      : securityLevel === 'requires_approval'
        ? CommandSecurityLevel.REQUIRES_APPROVAL
        : CommandSecurityLevel.FORBIDDEN;

    this.commandService.addToWhitelist({
      command,
      securityLevel: securityLevelEnum,
      description,
    });

    return {
      content: [
        {
          type: 'text',
          text: `Command '${command}' added to whitelist with security level '${securityLevel}'`,
        },
      ],
    };
  }

  /**
   * Handle update_security_level tool
   */
  private async handleUpdateSecurityLevel(args: any) {
    const schema = z.object({
      command: z.string(),
      securityLevel: z.enum(['safe', 'requires_approval', 'forbidden']),
    });

    const { command, securityLevel } = schema.parse(args);

    // Map string security level to enum
    const securityLevelEnum = securityLevel === 'safe'
      ? CommandSecurityLevel.SAFE
      : securityLevel === 'requires_approval'
        ? CommandSecurityLevel.REQUIRES_APPROVAL
        : CommandSecurityLevel.FORBIDDEN;

    this.commandService.updateSecurityLevel(command, securityLevelEnum);

    return {
      content: [
        {
          type: 'text',
          text: `Security level for command '${command}' updated to '${securityLevel}'`,
        },
      ],
    };
  }

  /**
   * Handle remove_from_whitelist tool
   */
  private async handleRemoveFromWhitelist(args: any) {
    const schema = z.object({
      command: z.string(),
    });

    const { command } = schema.parse(args);

    this.commandService.removeFromWhitelist(command);

    return {
      content: [
        {
          type: 'text',
          text: `Command '${command}' removed from whitelist`,
        },
      ],
    };
  }

  /**
   * Handle get_pending_commands tool
   */
  private async handleGetPendingCommands() {
    const pendingCommands = this.commandService.getPendingCommands();
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(pendingCommands.map(cmd => ({
            id: cmd.id,
            command: cmd.command,
            args: cmd.args,
            requestedAt: cmd.requestedAt,
            requestedBy: cmd.requestedBy,
          })), null, 2),
        },
      ],
    };
  }

  /**
   * Handle approve_command tool
   */
  private async handleApproveCommand(args: any) {
    const schema = z.object({
      commandId: z.string(),
    });

    const { commandId } = schema.parse(args);

    try {
      const result = await this.commandService.approveCommand(commandId);
      
      return {
        content: [
          {
            type: 'text',
            text: `Command approved and executed successfully.\nOutput: ${result.stdout}`,
          },
          {
            type: 'text',
            text: result.stderr ? `Error output: ${result.stderr}` : '',
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          content: [
            {
              type: 'text',
              text: `Command approval failed: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  }

  /**
   * Handle deny_command tool
   */
  private async handleDenyCommand(args: any) {
    const schema = z.object({
      commandId: z.string(),
      reason: z.string().optional(),
    });

    const { commandId, reason } = schema.parse(args);

    try {
      this.commandService.denyCommand(commandId, reason);
      
      return {
        content: [
          {
            type: 'text',
            text: `Command denied${reason ? `: ${reason}` : ''}`,
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          content: [
            {
              type: 'text',
              text: `Command denial failed: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  }

  /**
   * Run the MCP server
   */
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Mac Shell MCP server running on stdio');
  }
}

// Create and run the server
const server = new MacShellMcpServer();
server.run().catch(console.error);