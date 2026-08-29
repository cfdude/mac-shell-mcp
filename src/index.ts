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
import { suggest } from './audit-log.js';
import { AuditLog } from './audit-log.js';
import { PolicyError, loadPolicy, type Policy } from './policy.js';
import { CommandService, DeniedError } from './services/command-service.js';

const VERSION = '2.0.0';

const ExecuteSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  stdin: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const PipelineSchema = z.object({
  stages: z.array(z.object({ command: z.string(), args: z.array(z.string()).optional() })).min(1),
  cwd: z.string().optional(),
  stdin: z.string().optional(),
});

/** get_policy is exempt from enabledTools: a client unable to discover the policy cannot use the server. */
const ALWAYS_ENABLED = new Set(['get_policy']);

class MacShellMcpServer {
  private readonly server: Server;
  private readonly service: CommandService;
  private readonly policy: Policy;
  private readonly audit: AuditLog;

  constructor(policy: Policy, warnings: string[]) {
    this.policy = policy;
    this.audit = new AuditLog(policy.auditLogDir, policy.maxAuditBytes, policy.maxAuditFiles);
    this.service = new CommandService(policy, this.audit);

    for (const w of warnings) console.error(`[policy] ${w}`);
    console.error(
      `[policy] source: ${policy.source}; roots: ${policy.roots.join(', ') || '(none)'}`,
    );
    for (const d of this.service.unsafeProgramDirs()) {
      console.error(
        `[policy] program directory ${d} has an unprivileged write path and will not be used.`,
      );
    }

    this.server = new Server(
      { name: 'mac-shell-mcp', version: VERSION },
      { capabilities: { tools: {} } },
    );
    this.setup();
    this.server.onerror = (e) => console.error('[MCP Error]', e);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private enabled(name: string): boolean {
    if (ALWAYS_ENABLED.has(name)) return true;
    return this.policy.enabledTools ? this.policy.enabledTools.includes(name) : true;
  }

  private tools() {
    const execProps = {
      command: { type: 'string', description: 'Permitted command name. See get_policy.' },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments, each matching a permitted shape.',
      },
      cwd: {
        type: 'string',
        description: 'Working directory. Defaults to the first configured root.',
      },
      stdin: { type: 'string', description: 'Text supplied to standard input.' },
    };
    const all = [
      {
        name: 'execute_command',
        description:
          'Run a permitted command confined to the configured roots. Reads and writes inside a root; refuses anything reaching outside.',
        inputSchema: { type: 'object', properties: execProps, required: ['command'] },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      {
        name: 'execute_external_command',
        description:
          'Run a permitted command against paths OUTSIDE the configured roots. Requires interactive approval; refused where the client cannot ask a human.',
        inputSchema: { type: 'object', properties: execProps, required: ['command'] },
        annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
      },
      {
        name: 'execute_pipeline',
        description:
          'Compose read-only commands, wiring stdout to stdin in process. Every stage is authorized independently and confined to the roots.',
        inputSchema: {
          type: 'object',
          properties: {
            stages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  command: { type: 'string' },
                  args: { type: 'array', items: { type: 'string' } },
                },
                required: ['command'],
              },
            },
            cwd: { type: 'string' },
            stdin: { type: 'string' },
          },
          required: ['stages'],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: 'get_policy',
        description:
          'Report the effective policy: permitted commands with effects, permissions and argument shapes, plus the configured roots.',
        inputSchema: { type: 'object', properties: {} },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: 'suggest_policy_config',
        description:
          'Summarize recorded usage into configuration a human may apply. Cannot apply it; the policy file is protected.',
        inputSchema: { type: 'object', properties: {} },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ];
    return all.filter((t) => this.enabled(t.name));
  }

  private setup(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.tools() }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: rawArgs } = request.params;
      if (!this.enabled(name))
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);

      try {
        switch (name) {
          case 'execute_command':
          case 'execute_external_command': {
            const a = ExecuteSchema.parse(rawArgs);
            const r = await this.service.execute(name, a.command, a.args ?? [], {
              cwd: a.cwd,
              stdin: a.stdin,
              timeoutMs: a.timeoutMs,
            });
            return this.result(r);
          }
          case 'execute_pipeline': {
            const a = PipelineSchema.parse(rawArgs);
            const r = await this.service.pipeline(a.stages, { cwd: a.cwd, stdin: a.stdin });
            return this.result(r);
          }
          case 'get_policy':
            return this.json(this.service.getPolicy());
          case 'suggest_policy_config':
            return this.json(suggest(this.audit.read(), Object.keys(this.policy.commands)));
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (e) {
        if (e instanceof McpError) throw e;
        // A refusal is a result the agent must act on, not a protocol error.
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    });
  }

  /** A non-zero exit is a normal result; only a failure to start is an error. */
  private result(r: {
    stdout: string;
    stderr: string;
    exitCode: number;
    truncated: boolean;
    omittedBytes: number;
    durationMs: number;
    timedOut: boolean;
  }) {
    const summary =
      (r.truncated ? `[output truncated; ${r.omittedBytes} bytes omitted]\n` : '') +
      (r.timedOut ? '[command timed out]\n' : '') +
      r.stdout +
      (r.stderr ? `\n[stderr]\n${r.stderr}` : '');
    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        stdout: r.stdout,
        stderr: r.stderr,
        exitCode: r.exitCode,
        truncated: r.truncated,
        omittedBytes: r.omittedBytes,
        durationMs: r.durationMs,
        timedOut: r.timedOut,
      },
    };
  }

  private json(value: unknown) {
    return {
      content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      structuredContent: value as Record<string, unknown>,
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`mac-shell-mcp ${VERSION} running on stdio`);
  }
}

async function main(): Promise<void> {
  try {
    // Interactivity is asserted only by the MCP `elicitation` capability, which
    // is the sole capability meaning a human can be asked. `sampling` means a
    // model would answer, which is not a human gate.
    const { policy, warnings } = loadPolicy({ interactive: false });
    const server = new MacShellMcpServer(policy, warnings);
    await server.run();
  } catch (e) {
    if (e instanceof PolicyError) {
      console.error(`[policy] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export { MacShellMcpServer, CommandService, DeniedError };
