import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

/**
 * What a command does to the filesystem. A label, never a guarantee: protection
 * decisions key on the operation a request performs, not on this value.
 */
export const Effect = z.enum(['read', 'write']);
export type Effect = z.infer<typeof Effect>;

/** What may happen when a command is requested. */
export const Permission = z.enum(['allow', 'ask', 'deny']);
export type Permission = z.infer<typeof Permission>;

export const CommandPolicy = z.object({
  /** Absolute path this command is pinned to. Flag allowlists are authored for it. */
  program: z.string(),
  effect: Effect,
  /** Argument shapes accepted. Absent means the command accepts no arguments. */
  allowedArgs: z.array(z.string()).default([]),
  permission: Permission.default('allow'),
});
export type CommandPolicy = z.infer<typeof CommandPolicy>;

export const PolicyFile = z.object({
  allowedRoots: z.array(z.string()).default([]),
  programDirectories: z.array(z.string()).default(['/usr/bin', '/bin', '/usr/sbin', '/sbin']),
  commands: z.record(z.string(), CommandPolicy).default({}),
  deniedCommands: z.array(z.string()).default([]),
  enabledTools: z.array(z.string()).optional(),
  auditLogDir: z.string().optional(),
  maxOutputBytes: z
    .number()
    .int()
    .positive()
    .default(1024 * 1024),
  timeoutMs: z.number().int().positive().default(30_000),
  maxConcurrent: z.number().int().positive().default(4),
  maxAuditFiles: z.number().int().positive().default(10),
  maxAuditBytes: z
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
});
export type PolicyFile = z.infer<typeof PolicyFile>;

export interface Policy extends PolicyFile {
  /** Where the policy came from, for the startup report. */
  source: string;
  /** Resolved, existing roots. */
  roots: string[];
  auditLogDir: string;
  /** True only when the client declared MCP `elicitation`. */
  interactive: boolean;
}

/** Commands shipped by default: none can write, execute, or read configuration. */
export const DEFAULT_COMMANDS: Record<string, CommandPolicy> = {
  ls: {
    program: '/bin/ls',
    effect: 'read',
    allowedArgs: ['-l', '-a', '-h', '-t', '-r', '-1'],
    permission: 'allow',
  },
  pwd: { program: '/bin/pwd', effect: 'read', allowedArgs: [], permission: 'allow' },
  echo: { program: '/bin/echo', effect: 'read', allowedArgs: ['-n'], permission: 'allow' },
  cat: {
    program: '/bin/cat',
    effect: 'read',
    allowedArgs: ['-n', '-b', '-s'],
    permission: 'allow',
  },
  head: {
    program: '/usr/bin/head',
    effect: 'read',
    allowedArgs: ['-n', '-c'],
    permission: 'allow',
  },
  tail: {
    program: '/usr/bin/tail',
    effect: 'read',
    allowedArgs: ['-n', '-c'],
    permission: 'allow',
  },
  wc: {
    program: '/usr/bin/wc',
    effect: 'read',
    allowedArgs: ['-l', '-w', '-c', '-m'],
    permission: 'allow',
  },
  grep: {
    program: '/usr/bin/grep',
    effect: 'read',
    // -R and -S are excluded: both follow symbolic links during traversal on at
    // least one implementation, reaching outside a configured root. -r does not.
    allowedArgs: ['-i', '-n', '-v', '-c', '-l', '-w', '-x', '-E', '-F', '-r', '-A', '-B', '-C'],
    permission: 'allow',
  },
};

/**
 * Commands that can execute another program, evaluate code, or write via a flag.
 * Absent from the default set; a human may add one deliberately.
 */
export const EXCLUDED_BY_DEFAULT = [
  'find',
  'git',
  'rm',
  'sh',
  'bash',
  'zsh',
  'awk',
  'perl',
  'python',
  'python3',
  'ruby',
  'node',
  'osascript',
  'env',
  'xargs',
  'open',
  'make',
  'npm',
  'npx',
  'ssh',
  'scp',
  'rsync',
  'sqlite3',
  'less',
  'more',
  'vi',
  'vim',
  'tar',
  'zip',
];

/** Well-known credential locations reported when a root contains one. */
export const CREDENTIAL_MARKERS = ['.ssh', '.aws', '.env', '.npmrc', '.git/config'];

export class PolicyError extends Error {}

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

/** Default directory holding the home config file and the audit log. */
export function configHome(): string {
  return join(homedir(), '.mac-shell-mcp');
}

/**
 * Discovery order: explicit path, home file, host environment, built-in defaults.
 *
 * The working directory is deliberately NOT a source. A cloned repository must
 * not be able to supply the policy governing the agent that opens it.
 */
export function discover(env: NodeJS.ProcessEnv = process.env): { raw: unknown; source: string } {
  const explicit = env.MAC_SHELL_MCP_CONFIG;
  if (explicit) {
    const p = resolve(expandHome(explicit));
    return { raw: JSON.parse(readFileSync(p, 'utf8')), source: p };
  }

  const home = join(configHome(), 'config.json');
  try {
    const raw = JSON.parse(readFileSync(home, 'utf8'));
    return { raw, source: home };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }

  const fromEnv = envPolicy(env);
  if (fromEnv) return { raw: fromEnv, source: 'host environment' };

  return { raw: {}, source: 'built-in defaults' };
}

function envPolicy(env: NodeJS.ProcessEnv): Record<string, unknown> | null {
  const roots = env.MAC_SHELL_ROOTS;
  const commands = env.MAC_SHELL_COMMANDS;
  if (!roots && !commands) return null;
  const out: Record<string, unknown> = {};
  if (roots)
    out.allowedRoots = roots
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  if (commands) {
    const names = commands
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    out.commands = Object.fromEntries(
      names.filter((n) => n in DEFAULT_COMMANDS).map((n) => [n, DEFAULT_COMMANDS[n]]),
    );
  }
  if (env.MAC_SHELL_AUDIT_DIR) out.auditLogDir = env.MAC_SHELL_AUDIT_DIR;
  return out;
}

/**
 * A root must be a bounded working location. Home and `/` are refused outright:
 * confinement makes everything inside a root freely readable.
 */
function validateRoot(r: string): string {
  const resolved = resolve(expandHome(r));
  if (resolved === '/' || resolved === homedir()) {
    throw new PolicyError(
      `Refusing '${resolved}' as a root: confinement makes everything inside a root freely readable, ` +
        `so a root must be a project or working directory rather than the home directory or filesystem root.`,
    );
  }
  if (!isAbsolute(resolved)) throw new PolicyError(`Root must be absolute: ${r}`);
  // Roots must be realpath-resolved: scope comparison resolves the candidate,
  // and on macOS /var is a symlink to /private/var, so an unresolved root would
  // never match a resolved path beneath it.
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/** Load and validate policy. Immutable for the lifetime of the process. */
export function loadPolicy(opts: { env?: NodeJS.ProcessEnv; interactive?: boolean } = {}): {
  policy: Policy;
  warnings: string[];
} {
  const env = opts.env ?? process.env;
  const warnings: string[] = [];
  const { raw, source } = discover(env);

  const parsed = PolicyFile.safeParse(raw);
  if (!parsed.success) {
    throw new PolicyError(
      `Invalid policy in ${source}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  const file = parsed.data;

  if (source !== 'built-in defaults' && env.MAC_SHELL_ROOTS) {
    warnings.push(`Ignoring host environment configuration; policy came from ${source}.`);
  }

  const roots = file.allowedRoots.map(validateRoot);
  for (const root of roots) {
    for (const marker of CREDENTIAL_MARKERS) {
      try {
        statSync(join(root, marker));
        warnings.push(
          `Root ${root} contains ${marker}: everything inside a root is freely readable by a single recursive search.`,
        );
      } catch {
        /* absent */
      }
    }
  }

  const commands = Object.keys(file.commands).length > 0 ? file.commands : DEFAULT_COMMANDS;
  const interactive = opts.interactive ?? false;
  if (!interactive) {
    const asks = Object.entries(commands).filter(([, c]) => c.permission === 'ask');
    if (asks.length > 0) {
      warnings.push(
        `No interactive client (MCP 'elicitation' not declared): 'ask' degrades to 'deny' for ${asks.map(([n]) => n).join(', ')}.`,
      );
    }
  }

  return {
    policy: {
      ...file,
      commands,
      source,
      roots,
      auditLogDir: expandHome(file.auditLogDir ?? join(configHome(), 'audit')),
      interactive,
    },
    warnings,
  };
}

/** Denial messages name what IS allowed and where configuration lives. */
export function refusalSuffix(policy: Policy): string {
  const names = Object.keys(policy.commands).sort().join(', ');
  const where =
    policy.source === 'built-in defaults' ? join(configHome(), 'config.json') : policy.source;
  return ` Allowed commands: ${names}. Configuration: ${where}.`;
}
