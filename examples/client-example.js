#!/usr/bin/env node
import { McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { ChildProcessClientTransport } from '@modelcontextprotocol/sdk/client/child-process.js';

/**
 * Example client for the Mac Shell MCP Server
 * This demonstrates how to connect to the server and use its tools
 */
async function main() {
  // Create a client transport that connects to the server
  const transport = new ChildProcessClientTransport({
    command: 'node',
    args: ['../build/index.js'],
  });

  // Create the MCP client
  const client = new McpClient();
  
  try {
    // Connect to the server
    await client.connect(transport);
    console.log('Connected to Mac Shell MCP Server');

    // List available tools
    const tools = await client.listTools();
    console.log('Available tools:');
    tools.forEach(tool => {
      console.log(`- ${tool.name}: ${tool.description}`);
    });

    // Get the whitelist
    console.log('\nWhitelisted commands:');
    const whitelist = await client.callTool('get_whitelist', {});
    console.log(whitelist.content[0].text);

    // Execute a safe command
    console.log('\nExecuting a safe command (ls -la):');
    const lsResult = await client.callTool('execute_command', {
      command: 'ls',
      args: ['-la'],
    });
    console.log(lsResult.content[0].text);

    // Add a command to the whitelist
    console.log('\nAdding a command to the whitelist:');
    const addResult = await client.callTool('add_to_whitelist', {
      command: 'node',
      securityLevel: 'safe',
      description: 'Execute Node.js scripts',
    });
    console.log(addResult.content[0].text);

    // Try executing a command that requires approval
    console.log('\nExecuting a command that requires approval (mkdir test-dir):');
    try {
      const mkdirResult = await client.callTool('execute_command', {
        command: 'mkdir',
        args: ['test-dir'],
      });
      console.log(mkdirResult.content[0].text);
    } catch (error) {
      console.log('Command requires approval. Getting pending commands...');
      
      // Get pending commands
      const pendingCommands = await client.callTool('get_pending_commands', {});
      const pendingCommandsObj = JSON.parse(pendingCommands.content[0].text);
      
      if (pendingCommandsObj.length > 0) {
        const commandId = pendingCommandsObj[0].id;
        console.log(`Approving command with ID: ${commandId}`);
        
        // Approve the command
        const approveResult = await client.callTool('approve_command', {
          commandId,
        });
        console.log(approveResult.content[0].text);
      }
    }

    // Clean up - remove the test directory
    console.log('\nCleaning up:');
    try {
      // This will fail because 'rm' is forbidden
      const rmResult = await client.callTool('execute_command', {
        command: 'rm',
        args: ['-rf', 'test-dir'],
      });
      console.log(rmResult.content[0].text);
    } catch (error) {
      console.log(`Clean-up failed: ${error.message}`);
      console.log('Note: This is expected because "rm" is a forbidden command');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Disconnect from the server
    await client.disconnect();
    console.log('\nDisconnected from Mac Shell MCP Server');
  }
}

main().catch(console.error);