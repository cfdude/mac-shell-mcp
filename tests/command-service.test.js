import { CommandService, CommandSecurityLevel } from '../build/services/command-service.js';

describe('CommandService', () => {
  let commandService;

  beforeEach(() => {
    // Create a new CommandService instance for each test
    commandService = new CommandService('/bin/zsh');
  });

  test('should initialize with default whitelist', () => {
    const whitelist = commandService.getWhitelist();
    expect(whitelist).toBeDefined();
    expect(whitelist.length).toBeGreaterThan(0);

    // Check if common commands are in the whitelist
    const lsCommand = whitelist.find((entry) => entry.command === 'ls');
    expect(lsCommand).toBeDefined();
    expect(lsCommand.securityLevel).toBe(CommandSecurityLevel.SAFE);

    const rmCommand = whitelist.find((entry) => entry.command === 'rm');
    expect(rmCommand).toBeDefined();
    expect(rmCommand.securityLevel).toBe(CommandSecurityLevel.FORBIDDEN);
  });

  test('should add command to whitelist', () => {
    const testCommand = {
      command: 'test-command',
      securityLevel: CommandSecurityLevel.SAFE,
      description: 'Test command',
    };

    commandService.addToWhitelist(testCommand);

    const whitelist = commandService.getWhitelist();
    const addedCommand = whitelist.find((entry) => entry.command === 'test-command');

    expect(addedCommand).toBeDefined();
    expect(addedCommand.securityLevel).toBe(CommandSecurityLevel.SAFE);
    expect(addedCommand.description).toBe('Test command');
  });

  test('should update command security level', () => {
    // First add a command
    const testCommand = {
      command: 'test-command',
      securityLevel: CommandSecurityLevel.SAFE,
      description: 'Test command',
    };

    commandService.addToWhitelist(testCommand);

    // Then update its security level
    commandService.updateSecurityLevel('test-command', CommandSecurityLevel.REQUIRES_APPROVAL);

    const whitelist = commandService.getWhitelist();
    const updatedCommand = whitelist.find((entry) => entry.command === 'test-command');

    expect(updatedCommand).toBeDefined();
    expect(updatedCommand.securityLevel).toBe(CommandSecurityLevel.REQUIRES_APPROVAL);
  });

  test('should remove command from whitelist', () => {
    // First add a command
    const testCommand = {
      command: 'test-command',
      securityLevel: CommandSecurityLevel.SAFE,
      description: 'Test command',
    };

    commandService.addToWhitelist(testCommand);

    // Then remove it
    commandService.removeFromWhitelist('test-command');

    const whitelist = commandService.getWhitelist();
    const removedCommand = whitelist.find((entry) => entry.command === 'test-command');

    expect(removedCommand).toBeUndefined();
  });

  test('should execute safe command', async () => {
    // Execute a safe command (echo)
    const result = await commandService.executeCommand('echo', ['test']);

    expect(result).toBeDefined();
    expect(result.stdout.trim()).toBe('test');
  });

  test('should reject forbidden command', async () => {
    // Try to execute a forbidden command (rm)
    await expect(commandService.executeCommand('rm', ['-rf', 'test'])).rejects.toThrow();
  });

  test('should queue command requiring approval', async () => {
    // Set up event listener to capture pending command
    let pendingCommandId = null;
    commandService.on('command:pending', (pendingCommand) => {
      pendingCommandId = pendingCommand.id;
    });

    // Execute a command that requires approval (mkdir)
    const executePromise = commandService.executeCommand('mkdir', ['test-dir']);

    // Wait a bit for the event to fire
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check if we got a pending command
    expect(pendingCommandId).not.toBeNull();

    // Get pending commands
    const pendingCommands = commandService.getPendingCommands();
    expect(pendingCommands.length).toBe(1);
    expect(pendingCommands[0].id).toBe(pendingCommandId);

    // Approve the command
    const approvePromise = commandService.approveCommand(pendingCommandId);

    // Wait for both promises to resolve
    await Promise.all([executePromise, approvePromise]);

    // Check that there are no more pending commands
    expect(commandService.getPendingCommands().length).toBe(0);

    // Clean up
    try {
      await commandService.executeCommand('rmdir', ['test-dir']);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should deny command requiring approval', async () => {
    // Set up event listener to capture pending command
    let pendingCommandId = null;
    commandService.on('command:pending', (pendingCommand) => {
      pendingCommandId = pendingCommand.id;
    });

    // Execute a command that requires approval (mkdir)
    const executePromise = commandService.executeCommand('mkdir', ['test-dir']);

    // Wait a bit for the event to fire
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check if we got a pending command
    expect(pendingCommandId).not.toBeNull();

    // Deny the command
    commandService.denyCommand(pendingCommandId, 'Test denial');

    // The execute promise should be rejected
    await expect(executePromise).rejects.toThrow('Test denial');

    // Check that there are no more pending commands
    expect(commandService.getPendingCommands().length).toBe(0);
  });
});
