import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  existsSync,
  linkSync,
  realpathSync,
  chmodSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { CommandService, DeniedError } from '../build/services/command-service.js';
import * as guard from '../build/path-guard.js';
import { DEFAULT_COMMANDS, EXCLUDED_BY_DEFAULT } from '../build/policy.js';

/**
 * Program directories for the fixture. The guard resolves each pinned program with
 * realpath and requires the result to sit inside a configured program directory. On
 * hosts where /bin/cat is a symlink into another tree (e.g. Ubuntu runners shipping
 * uutils coreutils at /usr/lib/cargo/bin/coreutils), the resolved path is legitimately
 * elsewhere. The fixture therefore adds the resolved directory of each pinned default
 * program. The production allowlist and the guard are unchanged.
 */
const PROGRAM_DIRECTORIES = [
  ...new Set([
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    ...Object.values(DEFAULT_COMMANDS).map((c) => dirname(realpathSync(c.program))),
  ]),
];

/** Build an isolated policy over a throwaway root. */
function makeService(overrides = {}) {
  const base = mkdtempSync(join(tmpdir(), 'msm-'));
  const root = join(base, 'root');
  mkdirSync(root, { recursive: true });
  const policy = {
    allowedRoots: [root],
    roots: [root],
    programDirectories: PROGRAM_DIRECTORIES,
    commands: DEFAULT_COMMANDS,
    deniedCommands: [],
    auditLogDir: join(base, 'audit'),
    maxOutputBytes: 64 * 1024,
    timeoutMs: 10_000,
    maxConcurrent: 4,
    maxAuditFiles: 5,
    maxAuditBytes: 1024 * 1024,
    source: 'test',
    interactive: false,
    ...overrides,
  };
  return { svc: new CommandService(policy), root, base, policy };
}

const cleanup = [];
afterAll(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('CWE-78 — command injection', () => {
  test('shell metacharacters in an argument are inert, and no second command runs', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    const sentinel = join(base, 'PWNED.txt');
    const payload = `hello; id > ${sentinel}`;

    const r = await svc.execute('execute_command', 'echo', [payload], { cwd: root });

    expect(r.stdout.trim()).toBe(payload);
    expect(existsSync(sentinel)).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  test('command substitution is not evaluated', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    const r = await svc.execute('execute_command', 'echo', ['$(whoami)'], { cwd: root });
    expect(r.stdout.trim()).toBe('$(whoami)');
  });

  test('no source file passes a shell option to execFile', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../src/services/command-service.ts', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/shell\s*:/);
  });
});

describe('CWE-862 — the agent cannot widen its own authority', () => {
  test('interpreters and exec-capable commands are absent from the default set', () => {
    for (const name of EXCLUDED_BY_DEFAULT) {
      expect(DEFAULT_COMMANDS[name]).toBeUndefined();
    }
  });

  test('a command outside the policy is refused, and the refusal names what is allowed', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    await expect(
      svc.execute('execute_command', 'bash', ['-c', 'id'], { cwd: root }),
    ).rejects.toThrow(/not permitted.*Allowed commands/s);
  });

  test('no default command can write', () => {
    for (const [, c] of Object.entries(DEFAULT_COMMANDS)) {
      expect(c.effect).toBe('read');
    }
  });
});

describe('scope confinement', () => {
  test('a path outside every root is refused and names the external tool', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    const outside = join(base, 'outside.txt');
    writeFileSync(outside, 'secret');
    await expect(svc.execute('execute_command', 'cat', [outside], { cwd: root })).rejects.toThrow(
      /outside the configured roots.*execute_external_command/s,
    );
  });

  test('a symlink inside a root resolving outside does not escape', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    const outside = join(base, 'target.txt');
    writeFileSync(outside, 'secret');
    const link = join(root, 'link.txt');
    symlinkSync(outside, link);
    await expect(svc.execute('execute_command', 'cat', [link], { cwd: root })).rejects.toThrow(
      /outside the configured roots/,
    );
  });

  test('a sibling directory sharing a prefix is not inside the root', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    const sibling = `${root}-sibling`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'f.txt'), 'x');
    await expect(
      svc.execute('execute_command', 'cat', [join(sibling, 'f.txt')], { cwd: root }),
    ).rejects.toThrow(/outside the configured roots/);
  });

  test('an attached flag value is scope-checked', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    await expect(
      svc.execute('execute_command', 'grep', ['-i', `--file=${join(base, 'x.txt')}`, 'p'], {
        cwd: root,
      }),
    ).rejects.toThrow();
  });

  test('cwd is a scope input: no path argument is NOT vacuously in scope', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    // `grep -r AKIA` with no operand reads the working directory.
    await expect(
      svc.execute('execute_command', 'grep', ['-r', 'AKIA'], { cwd: base }),
    ).rejects.toThrow(/working directory.*outside the configured roots/s);
  });

  test('a multiply-linked file is refused, and a directory never is', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    const a = join(root, 'a.txt');
    writeFileSync(a, 'x');
    linkSync(a, join(root, 'b.txt'));
    await expect(svc.execute('execute_command', 'cat', [a], { cwd: root })).rejects.toThrow(
      /hard links/,
    );

    // a directory operand must still work: every directory has nlink > 1
    mkdirSync(join(root, 'sub'), { recursive: true });
    const r = await svc.execute('execute_command', 'ls', [join(root, 'sub')], { cwd: root });
    expect(r.exitCode).toBe(0);
  });
});

describe('program authorization', () => {
  test('a program written into a root is not executable as a permitted command', async () => {
    const { root, base } = makeService();
    cleanup.push(base);
    const fake = join(root, 'ls');
    writeFileSync(fake, '#!/bin/sh\necho pwned\n', { mode: 0o755 });
    // the fake must sit in the root of the service under test, not in another fixture's
    const { svc, base: b2 } = makeService({
      commands: { ls: { ...DEFAULT_COMMANDS.ls, program: fake } },
      allowedRoots: [root],
      roots: [root],
    });
    cleanup.push(b2);
    await expect(svc.execute('execute_command', 'ls', [], { cwd: root })).rejects.toThrow(
      /inside a configured root|outside the configured program directories/,
    );
  });

  test('a command name containing a path is refused', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    await expect(svc.execute('execute_command', './ls', [], { cwd: root })).rejects.toThrow(
      /not permitted/,
    );
  });
});

describe('program directory safety', () => {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const SYSTEM_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

  /** A real (symlink-free) temp base: macOS tmpdir lives under the /var -> /private/var link. */
  function tempBase() {
    const b = realpathSync(mkdtempSync(join(tmpdir(), 'msm-pd-')));
    cleanup.push(b);
    return b;
  }

  function dirWithMode(parent, name, mode) {
    const d = join(parent, name);
    mkdirSync(d);
    chmodSync(d, mode); // explicit: mkdir's mode is masked by umask
    return d;
  }

  function executable(dir, name = 'tool') {
    const p = join(dir, name);
    writeFileSync(p, '#!/bin/sh\necho ran\n');
    chmodSync(p, 0o755);
    return p;
  }

  const onlyDirs = (dirs) => ({ roots: [], programDirectories: dirs });

  test('a world-writable program directory is refused, not merely reported', async () => {
    const base = tempBase();
    const dir = dirWithMode(base, 'ww', 0o777);
    const prog = executable(dir);

    expect(guard.programDirIsSafe(dir).reason).toContain(`${dir} is world-writable`);
    expect(() => guard.resolveProgram('tool', prog, onlyDirs([dir]))).toThrow(
      /unprivileged write path/,
    );

    const {
      svc,
      root,
      base: b2,
    } = makeService({
      programDirectories: [dir],
      commands: { tool: { program: prog, effect: 'read', allowedArgs: [], permission: 'allow' } },
    });
    cleanup.push(b2);
    await expect(svc.execute('execute_command', 'tool', [], { cwd: root })).rejects.toThrow(
      /unprivileged write path/,
    );
  });

  // Root owns what it creates, and root is the privileged owner, so this case cannot be
  // built when the suite runs as root.
  (isRoot ? test.skip : test)(
    'a program directory owned by an unprivileged user is refused (skipped as root: a root-created directory is privileged)',
    () => {
      const base = tempBase();
      const dir = dirWithMode(base, 'mine', 0o755);
      const prog = executable(dir);
      expect(guard.programDirIsSafe(dir).reason).toContain(`${dir} is owned by uid`);
      expect(() => guard.resolveProgram('tool', prog, onlyDirs([dir]))).toThrow(
        /unprivileged write path/,
      );
    },
  );

  test('a program directory whose ANCESTOR has an unprivileged write path is refused', () => {
    // The configured directory is a link, held in a temp dir, to a real system directory.
    // The target and its own ancestors are safe; only the directory holding the link is
    // not, and whoever can write there can retarget the link.
    const base = tempBase();
    const realHead = realpathSync(DEFAULT_COMMANDS.head.program);
    const target = dirname(realHead);
    const link = join(base, 'bin-link');
    symlinkSync(target, link);

    expect({ target, ...guard.programDirIsSafe(target) }).toEqual({ target, safe: true });
    const verdict = guard.programDirIsSafe(link);
    expect(verdict.safe).toBe(false);
    expect(verdict.reason).not.toContain(target);
    if (!isRoot) expect(verdict.reason).toContain(base);

    expect(() =>
      guard.resolveProgram('head', join(link, basename(realHead)), onlyDirs([link])),
    ).toThrow(/unprivileged write path/);
    // pinned by its real, safe path, it is still not resolved from the unsafe directory
    expect(() => guard.resolveProgram('head', realHead, onlyDirs([link]))).toThrow(
      new RegExp(`lies in program directory ${link}, which is not used: unprivileged write path`),
    );
  });

  test('a pinned program reached through a link in a writable directory is refused', () => {
    // Whoever can write the link's directory can point it at any other program.
    const base = tempBase();
    const pinned = join(base, 'head');
    symlinkSync(realpathSync(DEFAULT_COMMANDS.head.program), pinned);
    expect(() => guard.resolveProgram('head', pinned, onlyDirs(PROGRAM_DIRECTORIES))).toThrow(
      /unprivileged write path/,
    );
  });

  test('a program file with an unprivileged write path is refused', () => {
    const base = tempBase();
    const prog = executable(base);
    chmodSync(prog, 0o777);
    expect(() => guard.resolveProgram('tool', prog, onlyDirs([base]))).toThrow(
      new RegExp(`unprivileged write path: ${prog} is world-writable`),
    );
  });

  test('a relative link under a linked parent is judged where the kernel resolves it', () => {
    // base/L -> base/a/real, and base/a/real/rel -> ../t. The kernel resolves
    // base/L/rel to base/a/t; read against the parent as written it would be base/t.
    const base = tempBase();
    const a = join(base, 'a');
    mkdirSync(join(a, 'real'), { recursive: true });
    const t = dirWithMode(a, 't', 0o777);
    symlinkSync(join(a, 'real'), join(base, 'L'));
    symlinkSync('../t', join(a, 'real', 'rel'));
    expect(guard.programDirIsSafe(join(base, 'L', 'rel')).reason).toContain(
      `${t} is world-writable`,
    );
  });

  // Needs a root-owned directory with a safe chain, which only root can create.
  (isRoot ? test : test.skip)(
    'a program reached through a safe directory into an unsafe one is refused (root only: needs a root-owned directory)',
    () => {
      const safeDir = realpathSync(mkdtempSync(join(homedir(), 'msm-pd-')));
      cleanup.push(safeDir);
      chmodSync(safeDir, 0o755);
      expect({ safeDir, ...guard.programDirIsSafe(safeDir) }).toEqual({ safeDir, safe: true });
      // safeDir/L -> safeDir/deep/real; safeDir/deep/real/tool -> ../sub/tool, which the
      // kernel resolves to safeDir/deep/sub/tool, inside a world-writable directory.
      const deep = join(safeDir, 'deep');
      mkdirSync(join(deep, 'real'), { recursive: true });
      chmodSync(deep, 0o755);
      chmodSync(join(deep, 'real'), 0o755);
      const sub = dirWithMode(deep, 'sub', 0o777);
      const prog = executable(sub);
      symlinkSync(join(deep, 'real'), join(safeDir, 'L'));
      symlinkSync('../sub/tool', join(deep, 'real', 'tool'));
      const pinned = join(safeDir, 'L', 'tool');
      expect(() => guard.resolveProgram('tool', pinned, onlyDirs([safeDir]))).toThrow(
        new RegExp(`unprivileged write path: ${sub} is world-writable`),
      );
      // the same file pinned directly is refused too
      expect(() => guard.resolveProgram('tool', prog, onlyDirs([safeDir]))).toThrow(
        /unprivileged write path/,
      );
    },
  );

  test('a program pinned by a relative path is refused', () => {
    expect(() => guard.resolveProgram('ls', 'bin/ls', onlyDirs(PROGRAM_DIRECTORIES))).toThrow(
      /absolute/,
    );
  });

  test('the default program directories are safe and every default command resolves', () => {
    for (const dir of [...SYSTEM_DIRS, ...PROGRAM_DIRECTORIES]) {
      // the dir is in the expectation so a failure names it and its reason
      expect({ dir, ...guard.programDirIsSafe(dir) }).toEqual({ dir, safe: true });
    }
    for (const [name, c] of Object.entries(DEFAULT_COMMANDS)) {
      const { program } = guard.resolveProgram(name, c.program, onlyDirs(PROGRAM_DIRECTORIES));
      expect(program).toBe(realpathSync.native(c.program));
    }
    const { svc, base } = makeService();
    cleanup.push(base);
    expect(svc.unsafeProgramDirs()).toEqual([]);
    expect(guard.programDirWarnings(onlyDirs(PROGRAM_DIRECTORIES))).toEqual([]);
  });

  test('the startup warning names each refused directory with its true reason', () => {
    const base = tempBase();
    const ww = dirWithMode(base, 'ww', 0o777);
    const prog = executable(ww);
    const missing = join(base, 'missing');
    const policy = onlyDirs([...PROGRAM_DIRECTORIES, ww, missing]);

    const warnings = guard.programDirWarnings(policy);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain(ww);
    expect(warnings[0]).toMatch(/will not be used/);
    expect(warnings[0]).toMatch(/world-writable/);
    expect(warnings[1]).toContain(missing);
    expect(warnings[1]).toMatch(/does not exist/);
    expect(warnings[1]).not.toMatch(/write path/);

    // what the warning says will not be used is in fact not used
    expect(() => guard.resolveProgram('tool', prog, policy)).toThrow(/unprivileged write path/);

    const { svc, base: b2 } = makeService({ programDirectories: policy.programDirectories });
    cleanup.push(b2);
    expect(svc.unsafeProgramDirs()).toEqual([ww, missing]);
  });

  test('the server logs, at startup, the same verdict the guard enforces', async () => {
    const { spawn } = await import('node:child_process');
    const base = tempBase();
    const root = join(base, 'root');
    mkdirSync(root);
    const ww = dirWithMode(base, 'ww', 0o777);
    const programDirectories = [...PROGRAM_DIRECTORIES, ww];
    const config = join(base, 'config.json');
    writeFileSync(
      config,
      JSON.stringify({
        allowedRoots: [root],
        programDirectories,
        auditLogDir: join(base, 'audit'),
      }),
    );
    const server = new URL('../build/index.js', import.meta.url).pathname;
    const stderr = await new Promise((resolveOut, reject) => {
      const child = spawn(process.execPath, [server], {
        env: { ...process.env, MAC_SHELL_MCP_CONFIG: config },
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let err = '';
      const timer = setTimeout(() => child.kill(), 5000);
      child.stderr.on('data', (d) => {
        err += d;
        if (err.includes('running on stdio')) child.kill();
      });
      child.on('error', reject);
      child.on('close', () => {
        clearTimeout(timer);
        resolveOut(err);
      });
    });
    const expected = guard.programDirWarnings({ programDirectories });
    expect(expected).toHaveLength(1);
    expect(stderr).toContain(`[policy] ${expected[0]}`);
    expect(stderr.match(/will not be used/g)).toHaveLength(1);
  });
});

describe('argument allowlists', () => {
  test('grep -R and -S are not permitted (link-following traversal)', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    await expect(
      svc.execute('execute_command', 'grep', ['-R', 'x'], { cwd: root }),
    ).rejects.toThrow(/not permitted for/);
    await expect(
      svc.execute('execute_command', 'grep', ['-S', 'x'], { cwd: root }),
    ).rejects.toThrow(/not permitted for/);
  });

  test('a command declaring no argument shapes accepts no flags', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    await expect(svc.execute('execute_command', 'pwd', ['-L'], { cwd: root })).rejects.toThrow(
      /not permitted for/,
    );
  });
});

describe('fused short flags (2.0.1 regression)', () => {
  test('a fused flag group cannot smuggle a disallowed flag', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    const outside = join(base, 'out');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), 'AKIA-SECRET\n');
    symlinkSync(outside, join(root, 'lnk'));
    // -iS was read as flag -i carrying value "S"; -S follows symlinks out of the root
    await expect(
      svc.execute('execute_command', 'grep', ['-iS', '-r', 'AKIA'], { cwd: root }),
    ).rejects.toThrow(/not permitted for/);
    await expect(
      svc.execute('execute_command', 'grep', ['-iR', 'AKIA'], { cwd: root }),
    ).rejects.toThrow(/not permitted for/);
  });

  test('a fused group of allowed flags is accepted', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    writeFileSync(join(root, 'f.txt'), 'Hello\n');
    const r = await svc.execute('execute_command', 'grep', ['-in', 'hello', join(root, 'f.txt')], {
      cwd: root,
    });
    expect(r.stdout.trim()).toBe('1:Hello');
  });

  test('a value-taking flag accepts a fused numeric value only', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    writeFileSync(join(root, 'f.txt'), 'a\nb\nc\n');
    const r = await svc.execute('execute_command', 'head', ['-n2', join(root, 'f.txt')], {
      cwd: root,
    });
    expect(r.stdout.trim()).toBe('a\nb');
    await expect(
      svc.execute('execute_command', 'head', ['-nX', join(root, 'f.txt')], { cwd: root }),
    ).rejects.toThrow(/not permitted for/);
  });

  test('a command declaring no argument shapes accepts no operands either', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    await expect(
      svc.execute('execute_command', 'pwd', ['anything'], { cwd: root }),
    ).rejects.toThrow(/not permitted for/);
  });
});

describe('flag allowlist — the fused-flag class, enumerated', () => {
  test('ls -lRL cannot recurse or follow links (read as -l carrying value RL in 2.0.0)', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    await expect(svc.execute('execute_command', 'ls', ['-lRL'], { cwd: root })).rejects.toThrow(
      /not permitted for/,
    );
  });

  test('no disallowed letter passes in any position, for every default command', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    const letters = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];
    const valueFlags = { head: ['-n', '-c'], tail: ['-n', '-c'], grep: ['-A', '-B', '-C'] };
    let checked = 0;
    const leaks = [];
    for (const [cmd, entry] of Object.entries(DEFAULT_COMMANDS)) {
      const allowed = new Set(entry.allowedArgs);
      const vf = valueFlags[cmd] ?? [];
      const bools = [...allowed].filter((f) => /^-[A-Za-z]$/.test(f) && !vf.includes(f));
      const a = bools[0]?.[1];
      const b = bools[1]?.[1] ?? a;
      for (const c of letters) {
        if (allowed.has(`-${c}`)) continue;
        const shapes = [`-${c}`];
        if (a) shapes.push(`-${a}${c}`, `-${c}${a}`, `-${a}${c}${b}`);
        if (vf[0] && allowed.has(vf[0])) shapes.push(`${vf[0]}${c}`, `${vf[0]}5${c}`);
        for (const shape of shapes) {
          if (/^-[A-Za-z]\d+$/.test(shape) && vf.includes(shape.slice(0, 2))) continue; // legit -n5
          try {
            await svc.execute('execute_command', cmd, [shape], { cwd: root });
            leaks.push(`${cmd} ${shape}`);
          } catch (e) {
            if (!/not permitted for/.test(e.message)) leaks.push(`${cmd} ${shape}: ${e.message}`);
          }
          checked += 1;
        }
      }
    }
    expect(leaks).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('results', () => {
  test('a non-zero exit is a normal result, not an error', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    writeFileSync(join(root, 'f.txt'), 'hello\n');
    const r = await svc.execute('execute_command', 'grep', ['ZZZNOMATCH', join(root, 'f.txt')], {
      cwd: root,
    });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe('');
  });

  test('output beyond the cap truncates rather than failing', async () => {
    const { svc, root, base } = makeService({ maxOutputBytes: 256 });
    cleanup.push(base);
    const big = join(root, 'big.txt');
    writeFileSync(big, 'x'.repeat(20_000));
    const r = await svc.execute('execute_command', 'cat', [big], { cwd: root });
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(256);
  });
});

describe('pipelines', () => {
  test('a non-read stage refuses the whole pipeline and executes nothing', async () => {
    const { svc, root, base } = makeService({
      commands: {
        ...DEFAULT_COMMANDS,
        // allowedArgs non-empty so the read-effect rule, not the no-arguments rule, is what refuses
        tee: { program: '/usr/bin/tee', effect: 'write', allowedArgs: ['-a'], permission: 'allow' },
      },
    });
    cleanup.push(base);
    const marker = join(root, 'written.txt');
    await expect(
      svc.pipeline(
        [
          { command: 'echo', args: ['hi'] },
          { command: 'tee', args: [marker] },
        ],
        { cwd: root },
      ),
    ).rejects.toThrow(/read-effect/);
    expect(existsSync(marker)).toBe(false);
  });

  test('a read-only pipeline reaching outside the roots is refused', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    const outside = join(base, 'creds.txt');
    writeFileSync(outside, 'AKIA-secret');
    await expect(
      svc.pipeline(
        [
          { command: 'cat', args: [outside] },
          { command: 'wc', args: ['-l'] },
        ],
        { cwd: root },
      ),
    ).rejects.toThrow(/outside the configured roots/);
  });

  test('a read-only in-root pipeline runs and wires stdout to stdin', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    writeFileSync(join(root, 'f.txt'), 'a\nb\nc\n');
    const r = await svc.pipeline(
      [
        { command: 'cat', args: [join(root, 'f.txt')] },
        { command: 'wc', args: ['-l'] },
      ],
      {
        cwd: root,
      },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('3');
  });
});

describe('protected locations', () => {
  test('a write-effect command targeting a program directory is refused', async () => {
    const { root, base } = makeService();
    cleanup.push(base);
    const { svc } = makeService({
      commands: {
        ...DEFAULT_COMMANDS,
        cp: { program: '/bin/cp', effect: 'write', allowedArgs: [], permission: 'allow' },
      },
      allowedRoots: [root],
      roots: [root],
    });
    await expect(
      svc.execute('execute_command', 'cp', [join(root, 'x'), '/usr/bin/grep'], { cwd: root }),
    ).rejects.toThrow(/protected location|not permitted/);
  });
});

describe('the ask gate', () => {
  test('ask degrades to deny without an interactive client, never to allow', async () => {
    const { svc, root, base } = makeService({
      commands: { ...DEFAULT_COMMANDS, cat: { ...DEFAULT_COMMANDS.cat, permission: 'ask' } },
      interactive: false,
    });
    cleanup.push(base);
    writeFileSync(join(root, 'f.txt'), 'x');
    await expect(
      svc.execute('execute_command', 'cat', [join(root, 'f.txt')], { cwd: root }),
    ).rejects.toThrow(/requires approval.*elicitation/s);
  });
});

describe('working directory', () => {
  test('a request supplying no cwd runs in the first root, not the process cwd', async () => {
    const { svc, root, base } = makeService();
    cleanup.push(base);
    const r = await svc.execute('execute_command', 'pwd', []);
    // roots are realpath-resolved, so the reported cwd is the real path
    expect(r.stdout.trim()).toBe(realpathSync.native(root));
  });
});

describe('release hygiene', () => {
  test('every version string agrees', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')).version;
    const pkg = read('../package.json');
    expect(read('../smithery.json')).toBe(pkg);
    expect(read('../manifest.json')).toBe(pkg);
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(src).toContain(`const VERSION = '${pkg}'`);
  });

  test('the server is stdio-only, which is what makes the SDK HTTP advisories unreachable', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/server\/(streamableHttp|sse|express)\.js/);
  });

  test('the sample config parses through the real loader', async () => {
    const { readFileSync } = await import('node:fs');
    const { PolicyFile } = await import('../build/policy.js');
    const raw = JSON.parse(
      readFileSync(new URL('../.mac-shell-mcp.sample.json', import.meta.url), 'utf8'),
    );
    expect(PolicyFile.safeParse(raw).success).toBe(true);
  });
});
