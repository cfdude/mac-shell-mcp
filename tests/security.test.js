import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  existsSync,
  linkSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandService, DeniedError } from '../build/services/command-service.js';
import { DEFAULT_COMMANDS, EXCLUDED_BY_DEFAULT } from '../build/policy.js';

/** Build an isolated policy over a throwaway root. */
function makeService(overrides = {}) {
  const base = mkdtempSync(join(tmpdir(), 'msm-'));
  const root = join(base, 'root');
  mkdirSync(root, { recursive: true });
  const policy = {
    allowedRoots: [root],
    roots: [root],
    programDirectories: ['/usr/bin', '/bin', '/usr/sbin', '/sbin'],
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
    const { svc } = makeService({ commands: { ls: { ...DEFAULT_COMMANDS.ls, program: fake } } });
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
        tee: { program: '/usr/bin/tee', effect: 'write', allowedArgs: [], permission: 'allow' },
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
