import {
  type Stats,
  accessSync,
  constants,
  lstatSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { Policy } from './policy.js';
import { configHome } from './policy.js';

/** A filesystem identity. Path strings are defeated by case and by links. */
export interface Identity {
  dev: number;
  ino: number;
}

export class GuardError extends Error {}

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

/**
 * Case-correcting, symlink-following resolution. `realpathSync.native` corrects
 * case on case-insensitive volumes, where the plain form preserves the caller's.
 */
export function realpathNative(p: string): string {
  return realpathSync.native(p);
}

/** Resolve as far as the path exists, returning the deepest existing ancestor. */
export function nearestExisting(p: string): string {
  let cur = resolve(p);
  for (;;) {
    try {
      return realpathNative(cur);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return cur;
      cur = parent;
    }
  }
}

export function identityOf(p: string): Identity | null {
  try {
    const s = statSync(p);
    return { dev: s.dev, ino: s.ino };
  } catch {
    return null;
  }
}

/** Segment-aware containment: /tmp/foo must not match /tmp/foobar. */
export function within(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * An argument is path-shaped when it is not a flag and either carries a
 * separator or `~`, or names an existing entry. A value attached to a flag
 * (`--out=/x`, `-o/x`) is split and its value treated as a candidate.
 */
export function pathCandidates(args: string[], cwd: string): string[] {
  const out: string[] = [];
  for (const arg of args) {
    if (arg === '-') continue; // stdin, not a path
    if (arg.startsWith('-')) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        const value = arg.slice(eq + 1);
        if (looksLikePath(value, cwd)) out.push(value);
      } else {
        // -o/path : short flag with a joined value
        const joined = arg.slice(2);
        if (joined && looksLikePath(joined, cwd)) out.push(joined);
      }
      continue;
    }
    if (looksLikePath(arg, cwd)) out.push(arg);
  }
  return out;
}

function looksLikePath(v: string, cwd: string): boolean {
  if (v.length === 0) return false;
  if (v.includes('/') || v.startsWith('~')) return true;
  try {
    statSync(resolve(cwd, v));
    return true;
  } catch {
    return false;
  }
}

export interface ScopeResult {
  inScope: boolean;
  reason?: string;
}

/**
 * Scope is the working directory AND every path-shaped argument resolving
 * inside a configured root. A request carrying no path-shaped argument is
 * classified by its working directory — never vacuously in scope.
 */
export function classifyScope(args: string[], cwd: string, policy: Policy): ScopeResult {
  if (policy.roots.length === 0) {
    return { inScope: false, reason: 'no roots are configured' };
  }

  const cwdReal = nearestExisting(cwd);
  if (!policy.roots.some((r) => within(cwdReal, r))) {
    return {
      inScope: false,
      reason: `working directory ${cwdReal} lies outside the configured roots`,
    };
  }

  for (const cand of pathCandidates(args, cwd)) {
    const abs = isAbsolute(expandHome(cand)) ? expandHome(cand) : resolve(cwd, cand);
    const real = nearestExisting(abs);
    if (!policy.roots.some((r) => within(real, r))) {
      return {
        inScope: false,
        reason: `${cand} resolves to ${real}, outside the configured roots`,
      };
    }
    // A multiply-linked FILE may be reachable outside; directories always have
    // a link count above one and the platform forbids user hard links to them.
    try {
      const st = lstatSync(real);
      if (!st.isDirectory() && st.nlink > 1) {
        return {
          inScope: false,
          reason: `${cand} has ${st.nlink} hard links, so the same content is reachable elsewhere`,
        };
      }
    } catch {
      /* does not exist yet */
    }
  }
  return { inScope: true };
}

/**
 * Locations the server may never write, judged by the operation performed rather
 * than a command's declared effect. Captured at startup by identity AND matched
 * by path, so a location holding no file yet is still protected.
 */
export class ProtectedSet {
  private readonly paths: string[] = [];
  private readonly ids: Identity[] = [];

  constructor(policy: Policy) {
    const candidates = [
      join(configHome(), 'config.json'),
      configHome(),
      policy.auditLogDir,
      ...policy.programDirectories.map(expandHome),
    ];
    if (policy.source !== 'built-in defaults' && policy.source !== 'host environment') {
      candidates.push(policy.source, dirname(policy.source));
    }
    for (const c of candidates) {
      const abs = resolve(expandHome(c));
      this.paths.push(abs);
      const id = identityOf(abs);
      if (id) this.ids.push(id);
    }
  }

  /** True where the target is, or lies within, a protected location. */
  covers(target: string): boolean {
    const abs = resolve(expandHome(target));
    const real = nearestExisting(abs);
    for (const p of this.paths) {
      if (within(real, p) || within(abs, p)) return true;
      // an ancestor of a protected path may not be renamed or removed
      if (within(p, real)) return true;
    }
    const id = identityOf(real);
    if (id && this.ids.some((k) => k.dev === id.dev && k.ino === id.ino)) return true;
    return false;
  }
}

/**
 * Why `st`, at path `p`, gives an unprivileged user a way to write, or null.
 * The privileged owner is root (uid 0) and the privileged group is gid 0. World
 * write is always a write path; group write is one unless the group is gid 0;
 * ownership by any other uid is one, since an owner can always change the mode.
 * Judged by ownership and mode rather than "writable by me", which would refuse
 * every system directory when the server runs privileged, as in a container.
 */
function unprivilegedWriter(st: Stats, p: string): string | null {
  if ((st.mode & 0o002) !== 0) return `${p} is world-writable`;
  if (st.uid !== 0) return `${p} is owned by uid ${st.uid}, not root`;
  if ((st.mode & 0o020) !== 0 && st.gid !== 0) {
    return `${p} is group-writable by gid ${st.gid}, not a privileged group`;
  }
  return null;
}

/**
 * The first entry on the way to `p` that an unprivileged user could change, or
 * null. Covers `p` itself, every ancestor, and — for each symbolic link met on
 * the way — the link's target and the target's ancestors, since whoever can
 * write the directory holding a link, or any directory it passes through, can
 * redirect it.
 */
function firstWritePath(p: string, seen: Set<string> = new Set()): string | null {
  let cur = p;
  for (;;) {
    if (!seen.has(cur)) {
      seen.add(cur);
      let st: Stats;
      try {
        st = lstatSync(cur);
      } catch {
        return `${cur} does not exist`;
      }
      // A link's own mode is never consulted; it is replaced through its
      // parent, which this walk reaches next, and what it names is followed here.
      const why = st.isSymbolicLink()
        ? firstWritePath(resolve(dirname(cur), readlinkSync(cur)), seen)
        : unprivilegedWriter(st, cur);
      if (why) return why;
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** A program directory is safe only where no unprivileged write path reaches it. */
export function programDirIsSafe(dir: string): { safe: boolean; reason?: string } {
  const abs = resolve(expandHome(dir));
  let st: Stats;
  try {
    st = statSync(abs);
  } catch {
    return { safe: false, reason: `${abs} does not exist` };
  }
  if (!st.isDirectory()) return { safe: false, reason: `${abs} is not a directory` };
  const why = firstWritePath(abs);
  return why ? { safe: false, reason: `unprivileged write path: ${why}` } : { safe: true };
}

export interface ProgramDirSafety {
  /** Resolved paths of the directories programs may be resolved from. */
  safe: string[];
  /** Configured directories that are not used, with why. */
  unsafe: { dir: string; reason: string; real?: string }[];
}

/**
 * The single verdict on the configured program directories. Both the startup
 * report and every resolution read it, so the two cannot disagree.
 */
export function programDirSafety(policy: Pick<Policy, 'programDirectories'>): ProgramDirSafety {
  const out: ProgramDirSafety = { safe: [], unsafe: [] };
  for (const dir of policy.programDirectories) {
    const verdict = programDirIsSafe(dir);
    let real: string | undefined;
    try {
      real = realpathNative(resolve(expandHome(dir)));
    } catch {
      real = undefined;
    }
    if (verdict.safe && real) out.safe.push(real);
    else out.unsafe.push({ dir, reason: verdict.reason ?? `${dir} does not resolve`, real });
  }
  return out;
}

/** The startup report: one line per configured program directory that is not used. */
export function programDirWarnings(policy: Pick<Policy, 'programDirectories'>): string[] {
  return programDirSafety(policy).unsafe.map(
    (u) => `program directory ${u.dir} will not be used: ${u.reason}`,
  );
}

/** Resolve a command to a pinned, safe program. Never matched by basename. */
export function resolveProgram(
  name: string,
  pinned: string,
  policy: Pick<Policy, 'programDirectories' | 'roots'>,
): { program: string } {
  if (name.includes('/')) {
    throw new GuardError(`Command must be a bare name, not a path: ${name}`);
  }
  // A relative pin would resolve against whatever the process cwd happens to be.
  if (!isAbsolute(pinned)) {
    throw new GuardError(`Program for '${name}' must be pinned by absolute path, not ${pinned}`);
  }
  let real: string;
  try {
    real = realpathNative(pinned);
  } catch {
    throw new GuardError(`Program for '${name}' is not present at ${pinned}`);
  }
  if (policy.roots.some((r) => within(real, r))) {
    throw new GuardError(
      `Program ${real} resolves inside a configured root; roots hold data, never code`,
    );
  }
  // The pinned path, every link it passes through, and the file itself.
  const why = firstWritePath(pinned);
  if (why) {
    throw new GuardError(`Program for '${name}' has an unprivileged write path: ${why}`);
  }
  // Confinement is tested on the RESOLVED path, against safe directories only.
  const { safe, unsafe } = programDirSafety(policy);
  if (!safe.some((d) => within(real, d))) {
    const blocked = unsafe.find((u) => u.real !== undefined && within(real, u.real));
    if (blocked) {
      throw new GuardError(
        `Program ${real} lies in program directory ${blocked.dir}, which is not used: ${blocked.reason}`,
      );
    }
    throw new GuardError(`Program ${real} is outside the configured program directories`);
  }
  try {
    accessSync(real, constants.X_OK);
  } catch {
    throw new GuardError(`Program ${real} is not executable`);
  }
  return { program: real };
}
