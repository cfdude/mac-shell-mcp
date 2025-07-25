import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

const execFileAsync = promisify(execFile);

/**
 * Command security level classification
 */
export enum CommandSecurityLevel {
  /** Safe commands that can be executed without approval */
  SAFE = 'safe',
  /** Commands that require approval before execution */
  REQUIRES_APPROVAL = 'requires_approval',
  /** Commands that are explicitly forbidden */
  FORBIDDEN = 'forbidden',
}

/**
 * Command whitelist entry
 */
export interface CommandWhitelistEntry {
  /** The command path or name */
  command: string;
  /** Security level of the command */
  securityLevel: CommandSecurityLevel;
  /** Allowed arguments (string for exact match, RegExp for pattern match) */
  allowedArgs?: Array<string | RegExp>;
  /** Description of the command for documentation */
  description?: string;
}

/**
 * Pending command awaiting approval
 */
export interface PendingCommand {
  /** Unique ID for the command */
  id: string;
  /** The command to execute */
  command: string;
  /** Arguments for the command */
  args: string[];
  /** When the command was requested */
  requestedAt: Date;
  /** Who requested the command */
  requestedBy?: string;
  /** Resolve function to call when approved */
  resolve: (value: { stdout: string; stderr: string }) => void;
  /** Reject function to call when denied */
  reject: (reason: Error) => void;
}

/**
 * Result of command execution
 */
export interface CommandResult {
  /** Standard output from the command */
  stdout: string;
  /** Standard error from the command */
  stderr: string;
}

/**
 * Service for securely executing shell commands
 */
export class CommandService extends EventEmitter {
  /** Default shell to use for commands */
  private shell: string;
  /** Command whitelist */
  private whitelist: Map<string, CommandWhitelistEntry>;
  /** Pending commands awaiting approval */
  private pendingCommands: Map<string, PendingCommand>;
  /** Default timeout for command execution in milliseconds */
  private defaultTimeout: number;

  /**
   * Create a new CommandService
   * @param shell The shell to use for commands (default: /bin/zsh)
   * @param defaultTimeout Default timeout for command execution in milliseconds (default: 30000)
   */
  constructor(shell = '/bin/zsh', defaultTimeout = 30000) {
    super();
    this.shell = shell;
    this.whitelist = new Map();
    this.pendingCommands = new Map();
    this.defaultTimeout = defaultTimeout;

    // Initialize with default safe commands
    this.initializeDefaultWhitelist();
  }

  /**
   * Initialize the default command whitelist
   */
  private initializeDefaultWhitelist(): void {
    // Safe commands (no approval required)
    const safeCommands: CommandWhitelistEntry[] = [
      {
        command: 'ls',
        securityLevel: CommandSecurityLevel.SAFE,
        description: 'List directory contents',
      },
      {
        command: 'pwd',
        securityLevel: CommandSecurityLevel.SAFE,
        description: 'Print working directory',
      },
      {
        command: 'echo',
        securityLevel: CommandSecurityLevel.SAFE,
        description: 'Print text to standard output',
      },
      {
        command: 'cat',
        securityLevel: CommandSecurityLevel.SAFE,
        description: 'Concatenate and print files',
      },
      {
        command: 'grep',
        securityLevel: CommandSecurityLevel.SAFE,
        description: 'Search for patterns in files',
      },
      {
        command: 'find',
        securityLevel: CommandSecurityLevel.SAFE,
        description: 'Find files in a directory hierarchy',
      },
      {
        command: 'cd',
        securityLevel: CommandSecurityLevel.SAFE,
        description: 'Change directory',
      },
      {
        command: 'head',
        securityLevel: CommandSecurityLevel.SAFE,
        description: 'Output the first part of files',
      },
      {
        command: 'tail',
        securityLevel: CommandSecurityLevel.SAFE,
        description: 'Output the last part of files',
      },
      {
        command: 'wc',
        securityLevel: CommandSecurityLevel.SAFE,
        description: 'Print newline, word, and byte counts',
      },
    ];

    // Commands requiring approval
    const approvalCommands: CommandWhitelistEntry[] = [
      {
        command: 'mv',
        securityLevel: CommandSecurityLevel.REQUIRES_APPROVAL,
        description: 'Move (rename) files',
      },
      {
        command: 'cp',
        securityLevel: CommandSecurityLevel.REQUIRES_APPROVAL,
        description: 'Copy files and directories',
      },
      {
        command: 'mkdir',
        securityLevel: CommandSecurityLevel.REQUIRES_APPROVAL,
        description: 'Create directories',
      },
      {
        command: 'touch',
        securityLevel: CommandSecurityLevel.REQUIRES_APPROVAL,
        description: 'Change file timestamps or create empty files',
      },
      {
        command: 'chmod',
        securityLevel: CommandSecurityLevel.REQUIRES_APPROVAL,
        description: 'Change file mode bits',
      },
      {
        command: 'chown',
        securityLevel: CommandSecurityLevel.REQUIRES_APPROVAL,
        description: 'Change file owner and group',
      },
    ];

    // Forbidden commands
    const forbiddenCommands: CommandWhitelistEntry[] = [
      {
        command: 'rm',
        securityLevel: CommandSecurityLevel.FORBIDDEN,
        description: 'Remove files or directories',
      },
      {
        command: 'sudo',
        securityLevel: CommandSecurityLevel.FORBIDDEN,
        description: 'Execute a command as another user',
      },
    ];

    // Add all commands to the whitelist
    [...safeCommands, ...approvalCommands, ...forbiddenCommands].forEach((entry) => {
      this.whitelist.set(entry.command, entry);
    });
  }

  /**
   * Add a command to the whitelist
   * @param entry The command whitelist entry
   */
  public addToWhitelist(entry: CommandWhitelistEntry): void {
    this.whitelist.set(entry.command, entry);
  }

  /**
   * Remove a command from the whitelist
   * @param command The command to remove
   */
  public removeFromWhitelist(command: string): void {
    this.whitelist.delete(command);
  }

  /**
   * Update a command's security level
   * @param command The command to update
   * @param securityLevel The new security level
   */
  public updateSecurityLevel(command: string, securityLevel: CommandSecurityLevel): void {
    const entry = this.whitelist.get(command);
    if (entry) {
      entry.securityLevel = securityLevel;
      this.whitelist.set(command, entry);
    }
  }

  /**
   * Get all whitelisted commands
   * @returns Array of command whitelist entries
   */
  public getWhitelist(): CommandWhitelistEntry[] {
    return Array.from(this.whitelist.values());
  }

  /**
   * Get all pending commands awaiting approval
   * @returns Array of pending commands
   */
  public getPendingCommands(): PendingCommand[] {
    return Array.from(this.pendingCommands.values());
  }

  /**
   * Validate if a command and its arguments are allowed
   * @param command The command to validate
   * @param args The command arguments
   * @returns The security level of the command or null if not whitelisted
   */
  private validateCommand(command: string, args: string[]): CommandSecurityLevel | null {
    // Extract the base command (without path)
    const baseCommand = command.split('/').pop() || command;

    // Check if the command is in the whitelist
    const entry = this.whitelist.get(baseCommand);
    if (!entry) {
      return null;
    }

    // If the command is forbidden, return immediately
    if (entry.securityLevel === CommandSecurityLevel.FORBIDDEN) {
      return CommandSecurityLevel.FORBIDDEN;
    }

    // If there are allowed arguments defined, validate them
    if (entry.allowedArgs && entry.allowedArgs.length > 0) {
      // Check if all arguments are allowed
      const allArgsValid = args.every((arg, index) => {
        // If we have more args than allowed patterns, reject
        if (index >= (entry.allowedArgs?.length || 0)) {
          return false;
        }

        const pattern = entry.allowedArgs?.[index];
        if (!pattern) {
          return false;
        }

        // Check if the argument matches the pattern
        if (typeof pattern === 'string') {
          return arg === pattern;
        } else {
          return pattern.test(arg);
        }
      });

      if (!allArgsValid) {
        return CommandSecurityLevel.REQUIRES_APPROVAL;
      }
    }

    return entry.securityLevel;
  }

  /**
   * Execute a shell command
   * @param command The command to execute
   * @param args Command arguments
   * @param options Additional options
   * @returns Promise resolving to command output
   */
  public async executeCommand(
    command: string,
    args: string[] = [],
    options: {
      timeout?: number;
      requestedBy?: string;
    } = {},
  ): Promise<CommandResult> {
    const securityLevel = this.validateCommand(command, args);

    // If command is not whitelisted, reject
    if (securityLevel === null) {
      throw new Error(`Command not whitelisted: ${command}`);
    }

    // If command is forbidden, reject
    if (securityLevel === CommandSecurityLevel.FORBIDDEN) {
      throw new Error(`Command is forbidden: ${command}`);
    }

    // If command requires approval, add to pending queue
    if (securityLevel === CommandSecurityLevel.REQUIRES_APPROVAL) {
      return this.queueCommandForApproval(command, args, options.requestedBy);
    }

    // For safe commands, execute immediately
    try {
      const timeout = options.timeout || this.defaultTimeout;
      const { stdout, stderr } = await execFileAsync(command, args, {
        timeout,
        shell: this.shell,
      });

      return { stdout, stderr };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Command execution failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Queue a command for approval
   * @param command The command to queue
   * @param args Command arguments
   * @param requestedBy Who requested the command
   * @returns Promise resolving when command is approved and executed
   */
  private queueCommandForApproval(
    command: string,
    args: string[] = [],
    requestedBy?: string,
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const pendingCommand: PendingCommand = {
        id,
        command,
        args,
        requestedAt: new Date(),
        requestedBy,
        resolve: (result: CommandResult) => resolve(result),
        reject: (error: Error) => reject(error),
      };

      this.pendingCommands.set(id, pendingCommand);

      // Emit event for pending command
      this.emit('command:pending', pendingCommand);
    });
  }

  /**
   * Approve a pending command
   * @param commandId ID of the command to approve
   * @returns Promise resolving to command output
   */
  public async approveCommand(commandId: string): Promise<CommandResult> {
    const pendingCommand = this.pendingCommands.get(commandId);
    if (!pendingCommand) {
      throw new Error(`No pending command with ID: ${commandId}`);
    }

    try {
      const { stdout, stderr } = await execFileAsync(pendingCommand.command, pendingCommand.args, {
        shell: this.shell,
      });

      // Remove from pending queue
      this.pendingCommands.delete(commandId);

      // Emit event for approved command
      this.emit('command:approved', { commandId, stdout, stderr });

      // Resolve the original promise
      pendingCommand.resolve({ stdout, stderr });

      return { stdout, stderr };
    } catch (error) {
      // Remove from pending queue
      this.pendingCommands.delete(commandId);

      // Emit event for failed command
      this.emit('command:failed', { commandId, error });

      if (error instanceof Error) {
        // Reject the original promise
        pendingCommand.reject(error);
        throw error;
      }

      const genericError = new Error('Command execution failed');
      pendingCommand.reject(genericError);
      throw genericError;
    }
  }

  /**
   * Deny a pending command
   * @param commandId ID of the command to deny
   * @param reason Reason for denial
   */
  public denyCommand(commandId: string, reason: string = 'Command denied'): void {
    const pendingCommand = this.pendingCommands.get(commandId);
    if (!pendingCommand) {
      throw new Error(`No pending command with ID: ${commandId}`);
    }

    // Remove from pending queue
    this.pendingCommands.delete(commandId);

    // Emit event for denied command
    this.emit('command:denied', { commandId, reason });

    // Reject the original promise
    pendingCommand.reject(new Error(reason));
  }
}
