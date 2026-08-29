import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';

export interface AuditRecord {
  at: string;
  tool: string;
  command: string;
  args: string[];
  cwd: string;
  effect?: string;
  scope?: 'in-root' | 'out-of-root';
  decision: 'allowed' | 'refused';
  reason?: string;
  exitCode?: number;
  durationMs?: number;
  truncated?: boolean;
}

/**
 * Append-only within each file, bounded by rotation. The whole directory is a
 * protected location, so rotation cannot be used to age records out of reach.
 */
export class AuditLog {
  private readonly dir: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;

  constructor(dir: string, maxBytes: number, maxFiles: number) {
    this.dir = dir;
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
    mkdirSync(dir, { recursive: true });
  }

  private get active(): string {
    return join(this.dir, 'audit.jsonl');
  }

  append(rec: AuditRecord): void {
    // Newlines in argv would otherwise forge records in a line-delimited log.
    const line = JSON.stringify(rec) + '\n';
    this.rotateIfNeeded(line.length);
    appendFileSync(this.active, line, 'utf8');
  }

  private rotateIfNeeded(incoming: number): void {
    let size = 0;
    try {
      size = statSync(this.active).size;
    } catch {
      return;
    }
    if (size + incoming <= this.maxBytes / this.maxFiles) return;
    renameSync(this.active, join(this.dir, `audit-${Date.now()}.jsonl`));
    this.prune();
  }

  /** Bound the trail as a whole, not merely each file. */
  private prune(): void {
    const files = readdirSync(this.dir)
      .filter((f) => f.startsWith('audit-') && f.endsWith('.jsonl'))
      .sort();
    while (files.length > this.maxFiles - 1) {
      const oldest = files.shift();
      if (!oldest) break;
      try {
        unlinkSync(join(this.dir, oldest));
      } catch {
        /* already gone */
      }
    }
  }

  read(): AuditRecord[] {
    const out: AuditRecord[] = [];
    let names: string[];
    try {
      names = readdirSync(this.dir)
        .filter((f) => f.endsWith('.jsonl'))
        .sort();
    } catch {
      return out;
    }
    for (const n of names) {
      let text: string;
      try {
        text = readFileSync(join(this.dir, n), 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          out.push(JSON.parse(line) as AuditRecord);
        } catch {
          /* skip a partial record */
        }
      }
    }
    return out;
  }
}

export interface Suggestion {
  configFile: Record<string, unknown>;
  extensionField: string;
  notes: string[];
}

/**
 * Proposes only what a human can act on, from server-side data. Never a new
 * command, never a program directory, never text derived from arguments — a
 * suggestion must not be steerable by requesting something 500 times.
 */
export function suggest(records: AuditRecord[], permitted: string[]): Suggestion {
  const counts = new Map<string, { allowed: number; refused: number }>();
  for (const r of records) {
    if (!permitted.includes(r.command)) continue; // never-permitted commands cannot be suggested
    const c = counts.get(r.command) ?? { allowed: 0, refused: 0 };
    if (r.decision === 'allowed') c.allowed += 1;
    else c.refused += 1;
    counts.set(r.command, c);
  }
  const promotable = [...counts.entries()]
    .filter(([, c]) => c.allowed > 0 && c.refused === 0)
    .map(([name]) => name)
    .sort();

  return {
    configFile: {
      commands: Object.fromEntries(promotable.map((n) => [n, { permission: 'allow' }])),
    },
    extensionField: promotable.join(','),
    notes: [
      'Counts derive from agent-initiated requests; volume reflects what the agent chose to ask for.',
      'Suggestions never include a command that has never been permitted, nor any program directory.',
      'This server cannot apply its own suggestion: the policy file is a protected location.',
    ],
  };
}
