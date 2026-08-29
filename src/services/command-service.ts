import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { AuditLog, type AuditRecord } from '../audit-log.js';
import {
  GuardError,
  ProtectedSet,
  classifyScope,
  pathCandidates,
  nearestExisting,
  programDirIsSafe,
  resolveProgram,
} from '../path-guard.js';
import { type Policy, refusalSuffix } from '../policy.js';

export class DeniedError extends Error {}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  omittedBytes: number;
  durationMs: number;
  timedOut: boolean;
}

export type Tool = 'execute_command' | 'execute_external_command' | 'execute_pipeline';

export interface ExecuteOptions {
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
}

/** Commands that write, judged by operation rather than a declared effect. */
const WRITE_OPERATIONS = new Set([
  'mv',
  'cp',
  'rm',
  'touch',
  'chmod',
  'chown',
  'tee',
  'ln',
  'mkdir',
  'rmdir',
  'dd',
  'truncate',
]);

export class CommandService {
  private readonly policy: Policy;
  private readonly protectedSet: ProtectedSet;
  private readonly audit: AuditLog;
  private running = 0;

  constructor(policy: Policy, audit?: AuditLog) {
    // Normalize roots defensively: a caller-supplied policy may carry
    // unresolved paths, and scope comparison always resolves the candidate.
    this.policy = { ...policy, roots: policy.roots.map((r) => nearestExisting(r)) };
    policy = this.policy;
    this.protectedSet = new ProtectedSet(policy);
    this.audit =
      audit ?? new AuditLog(policy.auditLogDir, policy.maxAuditBytes, policy.maxAuditFiles);
  }

  getPolicy(): Record<string, unknown> {
    return {
      source: this.policy.source,
      roots: this.policy.roots,
      programDirectories: this.policy.programDirectories,
      interactive: this.policy.interactive,
      commands: Object.fromEntries(
        Object.entries(this.policy.commands).map(([name, c]) => [
          name,
          {
            effect: c.effect,
            permission: c.permission,
            allowedArgs: c.allowedArgs,
            program: c.program,
          },
        ]),
      ),
    };
  }

  /** A request supplying no cwd runs in the first root, never the process cwd. */
  private resolveCwd(given?: string): string {
    if (given) return resolve(given);
    if (this.policy.roots.length > 0) return this.policy.roots[0];
    throw new DeniedError(`No configured roots.${refusalSuffix(this.policy)}`);
  }

  private record(rec: AuditRecord): void {
    try {
      this.audit.append(rec);
    } catch {
      /* recording must never break execution */
    }
  }

  private deny(tool: Tool, command: string, args: string[], cwd: string, reason: string): never {
    this.record({
      at: new Date().toISOString(),
      tool,
      command,
      args,
      cwd,
      decision: 'refused',
      reason,
    });
    throw new DeniedError(reason);
  }

  /**
   * Authorize a request. Every rule that can refuse lives here, so the three
   * execution tools cannot diverge.
   */
  private authorize(
    tool: Tool,
    command: string,
    args: string[],
    cwd: string,
  ): { program: string; effect: string } {
    const policy = this.policy;

    if (policy.deniedCommands.includes(command)) {
      this.deny(tool, command, args, cwd, `Command '${command}' is denied by policy.`);
    }

    const entry = policy.commands[command];
    if (!entry) {
      this.deny(
        tool,
        command,
        args,
        cwd,
        `Command '${command}' is not permitted.${refusalSuffix(policy)}`,
      );
    }

    // Every supplied argument must match at least one permitted shape,
    // independent of position. A command declaring none accepts none.
    for (const arg of args) {
      if (!this.argPermitted(arg, entry.allowedArgs, args, cwd)) {
        this.deny(
          tool,
          command,
          args,
          cwd,
          `Argument '${arg}' is not permitted for '${command}'. Permitted: ${entry.allowedArgs.join(', ') || '(none)'}.`,
        );
      }
    }

    // Protection is judged by the operation, not by the declared effect.
    if (WRITE_OPERATIONS.has(command)) {
      for (const cand of pathCandidates(args, cwd)) {
        if (this.protectedSet.covers(resolve(cwd, cand))) {
          this.deny(tool, command, args, cwd, `Refusing to modify a protected location: ${cand}`);
        }
      }
    }

    let program: string;
    try {
      program = resolveProgram(command, entry.program, policy).program;
    } catch (e) {
      this.deny(tool, command, args, cwd, e instanceof GuardError ? e.message : String(e));
    }

    const scope = classifyScope(args, cwd, policy);

    if (tool === 'execute_command' || tool === 'execute_pipeline') {
      if (!scope.inScope) {
        this.deny(
          tool,
          command,
          args,
          cwd,
          `Refused: ${scope.reason}. Use execute_external_command for work outside the configured roots.`,
        );
      }
      if (tool === 'execute_pipeline' && entry.effect !== 'read') {
        this.deny(
          tool,
          command,
          args,
          cwd,
          `Pipeline stages must be read-effect; '${command}' is ${entry.effect}.`,
        );
      }
    }

    // Out-of-root resolves to `ask` at minimum, whatever the confined permission.
    const effective =
      !scope.inScope && tool === 'execute_external_command'
        ? entry.permission === 'deny'
          ? 'deny'
          : 'ask'
        : entry.permission;

    if (effective === 'deny') {
      this.deny(tool, command, args, cwd, `Command '${command}' is set to deny.`);
    }
    if (effective === 'ask' && !policy.interactive) {
      this.deny(
        tool,
        command,
        args,
        cwd,
        `Command '${command}' requires approval, and this client declared no MCP 'elicitation' capability, so approval cannot be requested. Refusing.`,
      );
    }

    return { program, effect: entry.effect };
  }

  private argPermitted(arg: string, allowed: string[], allArgs: string[], cwd: string): boolean {
    if (allowed.includes(arg)) return true;
    // a value belonging to a preceding option, or a path operand
    if (!arg.startsWith('-')) {
      return pathCandidates([arg], cwd).length > 0 || /^\d+$/.test(arg) || allArgs.length > 0;
    }
    // -n5 style
    const m = /^(-[A-Za-z])(.+)$/.exec(arg);
    if (m && allowed.includes(m[1])) return true;
    return false;
  }

  async execute(
    tool: Tool,
    command: string,
    args: string[] = [],
    opts: ExecuteOptions = {},
  ): Promise<CommandResult> {
    const cwd = this.resolveCwd(opts.cwd);
    const { program, effect } = this.authorize(tool, command, args, cwd);

    if (this.running >= this.policy.maxConcurrent) {
      this.deny(
        tool,
        command,
        args,
        cwd,
        `Too many commands running (limit ${this.policy.maxConcurrent}).`,
      );
    }

    const started = Date.now();
    this.running += 1;
    try {
      const result = await this.spawn(program, args, cwd, opts);
      this.record({
        at: new Date().toISOString(),
        tool,
        command,
        args,
        cwd,
        effect,
        scope: 'in-root',
        decision: 'allowed',
        exitCode: result.exitCode,
        durationMs: Date.now() - started,
        truncated: result.truncated,
      });
      return result;
    } finally {
      this.running -= 1;
    }
  }

  /**
   * No shell, ever. The argument vector reaches execve uninterpreted, and the
   * environment is constructed rather than inherited.
   */
  private spawn(
    program: string,
    args: string[],
    cwd: string,
    opts: ExecuteOptions,
  ): Promise<CommandResult> {
    const started = Date.now();
    const cap = this.policy.maxOutputBytes;
    return new Promise((resolvePromise, reject) => {
      const child = execFile(
        program,
        args,
        {
          cwd,
          timeout: opts.timeoutMs ?? this.policy.timeoutMs,
          maxBuffer: cap,
          env: { PATH: '', LC_ALL: 'C' },
          encoding: 'utf8',
        },
        () => {
          /* handled via events below */
        },
      );

      let stdout = '';
      let stderr = '';
      let omitted = 0;
      let truncated = false;
      let timedOut = false;

      const collect = (buf: string, into: 'out' | 'err') => {
        const current = into === 'out' ? stdout : stderr;
        const room = cap - current.length;
        if (room <= 0) {
          omitted += buf.length;
          if (!truncated) {
            truncated = true;
            child.kill('SIGTERM'); // stop collection rather than buffer then trim
          }
          return;
        }
        const slice = buf.slice(0, room);
        if (slice.length < buf.length) {
          omitted += buf.length - slice.length;
          truncated = true;
          child.kill('SIGTERM');
        }
        if (into === 'out') stdout += slice;
        else stderr += slice;
      };

      child.stdout?.on('data', (d: Buffer | string) => collect(String(d), 'out'));
      child.stderr?.on('data', (d: Buffer | string) => collect(String(d), 'err'));

      if (opts.stdin !== undefined) {
        child.stdin?.end(opts.stdin);
      } else {
        child.stdin?.end();
      }

      child.on('error', (e) => reject(new Error(`Failed to start ${program}: ${e.message}`)));
      child.on('close', (code, signal) => {
        if (signal === 'SIGTERM' && !truncated) timedOut = true;
        resolvePromise({
          stdout,
          stderr,
          exitCode: code ?? (timedOut ? 124 : 1),
          truncated,
          omittedBytes: omitted,
          durationMs: Date.now() - started,
          timedOut,
        });
      });
    });
  }

  /** Stages are wired in process. Every stage is authorized completely. */
  async pipeline(
    stages: { command: string; args?: string[] }[],
    opts: ExecuteOptions = {},
  ): Promise<CommandResult> {
    const cwd = this.resolveCwd(opts.cwd);
    // Authorize every stage BEFORE executing any, so no stage runs on refusal.
    for (const s of stages) {
      this.authorize('execute_pipeline', s.command, s.args ?? [], cwd);
    }
    let carry = opts.stdin;
    let last: CommandResult | null = null;
    for (const s of stages) {
      last = await this.execute('execute_pipeline', s.command, s.args ?? [], {
        ...opts,
        cwd,
        stdin: carry,
      });
      if (last.truncated) break; // bound memory across the pipeline, not only at its end
      carry = last.stdout;
    }
    if (!last) throw new DeniedError('A pipeline requires at least one stage.');
    return last;
  }

  /** Program directories are reported unsafe rather than silently trusted. */
  unsafeProgramDirs(): string[] {
    return this.policy.programDirectories.filter((d) => !programDirIsSafe(d).safe);
  }

  resolveCwdForTest(given?: string): string {
    return this.resolveCwd(given);
  }

  nearestExistingForTest(p: string): string {
    return nearestExisting(p);
  }
}
