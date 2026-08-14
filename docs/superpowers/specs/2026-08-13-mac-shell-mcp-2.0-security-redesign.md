# mac-shell-mcp 2.0 — Security Redesign

**Date:** 2026-08-13
**Status:** Design — awaiting approval
**Drives:** [issue #14](https://github.com/cfdude/mac-shell-mcp/issues/14) (CWE-862), plus CWE-78 found during review
**Breaking:** yes — tools removed and renamed. Ships as `2.0.0`.

---

## 1. Problem

Two distinct vulnerabilities. Both verified empirically, not inferred.

### 1.1 CWE-78 — command injection (not in the original report)

`src/services/command-service.ts:336` and `:393`:

```ts
await execFileAsync(command, args, { timeout, shell: this.shell });
```

`this.shell` is always `/bin/zsh` — always truthy — so **every command runs through a shell** and
arguments are concatenated, not escaped. Node emits `DEP0190` warning about exactly this.

Verified with the production call shape:

```
execFileAsync('echo', ['hello; id > /tmp/PWNED.txt'], { timeout: 5000, shell: '/bin/zsh' })
  → stdout: "hello\n"
  → /tmp/PWNED.txt contains: uid=501(robsherman) gid=20(staff) …
```

Any whitelisted command yields arbitrary code execution. The on-disk `SECURITY_REVIEW.md` describes
this as conditional ("*could* conditionally enable shell processing"). It is unconditional.

### 1.2 CWE-862 — missing authorization (the reported issue)

The approval workflow is decorative. The agent holds every tool needed to approve its own request:

```
execute_command("chmod", …)   → queued, REQUIRES_APPROVAL
get_pending_commands()        → returns the id
approve_command(id)           → executes
```

No human is involved at any point. Worse, `addToWhitelist` is a plain `Map.set` that **overwrites
FORBIDDEN entries**, so the tier system self-destructs:

```
add_to_whitelist("bash", "safe")  →  execute_command("bash", ["-c", "<anything>"])
```

`FORBIDDEN` is not immutable, and `update_security_level` provides the same escalation.

### 1.3 Correcting the on-disk review

`SECURITY_REVIEW.md` recommends a shell-metacharacter blocklist as "Option 1 (Recommended)". **That
recommendation is wrong and this design rejects it.** A blocklist over ``[;&|`$()<>'"*?[]]`` rejects
`My File (2).txt`, `report[final].pdf`, and every glob — while remaining a blocklist that can likely
be evaded.

**Once the shell is gone, argument content stops being dangerous.** `execFile` without `shell` passes
argv straight to `execve`; nothing interprets `;` or `$()`. Removing the shell is both *safer* and
*less restrictive* than sanitizing. That file gets rewritten as part of this work.

---

## 2. Design principles

1. **The agent cannot widen its own authority.** No MCP tool mutates policy. Not gated — absent.
2. **Blast radius is determined by location, not command name.** See §3.
3. **The tool surface is the permission surface.** In MCP, never/always/ask attaches to the *tool
   name*, so tools are split along the axis a human would actually set differently.
4. **Fail closed.** Ambiguity resolves toward denial-with-explanation.
5. **A denial must teach.** Every rejection names what *is* allowed and how to change it.

---

## 3. The core model: effect × scope

A command-name allowlist cannot express the real risk. `grep` is "read-only" and
`grep -r AKIA ~/.aws` exfiltrates credentials; `mkdir ./build` is "destructive" and harmless.
**The command name does not predict blast radius.**

Two inputs, only one static:

- **Effect** — does the command mutate the filesystem? Static, small, stable: `read` / `write` /
  `delete`. This is what a command name genuinely tells you.
- **Scope** — where do the resolved arguments land? Computed per call: `realpath()` every
  path-shaped argument and test against configured roots.

| | inside roots | outside roots |
|---|---|---|
| **read** | allow | ask |
| **write** | allow | ask |
| **delete** | see §6 | **deny** |

`grep` inside a root is free; the same `grep` against `~/.aws` is gated. Same command, different
tier, decided by the argument — which the old whitelist could not express.

### 3.1 Path detection — a known, accepted limit

Deciding which arguments are paths is heuristic: an argument is path-shaped if it is not a flag and
either contains `/` or `~`, or resolves to an existing entry (relative paths resolved against `cwd`).
`grep -r pattern /dir` correctly identifies `/dir` and not `pattern`.

This cannot be perfect. **Ambiguous arguments are treated as external**, which errs toward prompting
too often — the survivable direction. Documented as a limitation in `SECURITY.md` rather than
presented as airtight.

### 3.2 Confinement

Roots are compared after `realpath()` on both sides, so a symlink inside a root pointing outside it
does not escape. Prefix comparison is path-segment-aware (`/tmp/foo` must not match `/tmp/foobar`).

---

## 4. Tool surface

**Removed:** `add_to_whitelist`, `update_security_level`, `remove_from_whitelist`,
`approve_command`, `deny_command`, `get_pending_commands`.

Removing the approval trio also disposes of two latent defects: `queueCommandForApproval` creates a
promise that never times out (leak + permanently hung agent), and `approveCommand` re-executes
without re-validating the whitelist.

| Tool | `readOnly` | `destructive` | `openWorld` | Purpose |
|---|---|---|---|---|
| `execute_command` | `false` | `false` | **`false`** | Reads **and writes**, everything resolved **inside** roots, non-delete. Safe to set always-allow. |
| `execute_external_command` | `false` | **`true`** | **`true`** | Anything reaching outside roots, or deleting. Set always-ask. |
| `execute_pipeline` | **`true`** | `false` | `false` | stdout→stdin in-process, replacing `\|`. Stages restricted to read-effect commands (§4.1). |
| `get_policy` | **`true`** | `false` | `false` | Agent discovers what's permitted without guessing. |
| `suggest_policy_config` | **`true`** | `false` | `false` | §7. |

Annotations (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`) are supported
in SDK 1.26 and used by clients to shape approval UI. The current server sets none.

**The load-bearing annotation is `openWorldHint`, not `readOnlyHint`.** The human-meaningful
distinction in this design is *confinement*, not read-vs-write: `mkdir ./build` inside a chosen root
is unremarkable, while *reading* `~/.aws/credentials` is not. So `execute_command` is annotated
`readOnlyHint: false` — it genuinely writes — and earns always-allow through
`openWorldHint: false` instead. Annotating it `readOnlyHint: true` would be a false claim to the
client, and the design depends on these hints being truthful.

`execute_pipeline` is the one execution tool that is honestly `readOnlyHint: true`, because its
stages are restricted to read-effect commands — which is also what stops it being a laundering path.

### 4.1 The constraint that makes the split real

The split is cosmetic unless enforced. Two rules, and they are the primary test targets:

1. `execute_command` **rejects** an out-of-scope or delete call outright. It never silently routes to
   the privileged path. The error names `execute_external_command` as the correct tool.
2. `execute_pipeline` allowlist-checks **every stage independently**, denylist first. `[{ls},{rm}]`
   must not pass on stage 1's acceptability.

Without these, `execute_command` set to always-allow could be argued into touching `~/.ssh`, and the
whole model collapses.

### 4.2 Command-level argument rules

Scope confinement is not sufficient for commands that can spawn processes or delete without being
classified as such:

- **`find`** — deny `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, `-fprintf`. `find . -exec sh -c
  '…' \;` is arbitrary execution with no shell involved.
- **`git`** — always-allowed as the recovery mechanism (§6), but with a destructive-subcommand
  denylist: `clean -fdx` (deletes untracked **and ignored** files — the unrecoverable category),
  `reset --hard`, `push --force` / `--force-with-lease` (destroys the remote history the model relies
  on), `checkout -- .`. Without this, the `rm` safeguards have a bypass sitting next to them.

`allowedArgs` semantics are also corrected. The current `index >= allowedArgs.length` logic makes it
**positional**, so `allowedArgs: [/^-l$/]` permits `ls -l` but not `ls -l foo` — contradicting the
doc comment. It becomes "every argument matches at least one pattern," and a mismatch **rejects**.
Today it downgrades to `REQUIRES_APPROVAL`, which under the current design is a no-op.

---

## 5. Configuration

**The config file is canonical. The MCPB manifest is one delivery mechanism, not the model.** An
earlier draft of this spec treated the file as a fallback; that was wrong. Smithery, Docker, Claude
Code, and any custom host have no manifest and no config form, so a design that depends on
`user_config` has no configuration story at all outside Claude Desktop.

Every load path produces the same internal `Policy` object. **Never mutated at runtime.**

### 5.1 Discovery order

| | Path | Case |
|---|---|---|
| 1 | `$MAC_SHELL_MCP_CONFIG` | explicit override |
| 2 | `./.mac-shell-mcp.json` | cwd — container, cloud, repo-scoped |
| 3 | `~/.mac-shell-mcp/config.json` | normal desktop install |
| 4 | MCPB/env `user_config` | Claude Desktop with no file present |
| 5 | built-in defaults | §5.5 |

First match wins; there is **no merging**. When a file is found *and* env config is also present, the
file wins and the server logs which source won and what it ignored. One source of truth at a time,
and it is always discoverable which one:

```
found ~/.mac-shell-mcp/config.json
⚠ ignoring MCPB env config (MAC_SHELL_ROOTS, MAC_SHELL_COMMANDS)
policy source: config file
mode: ask→deny (no interactive client)
```

Rejected alternative: intersection/most-restrictive merge. Strictly safer, but a command denied while
one source visibly permits it is very hard to debug.

### 5.2 Schema

Ships as `.mac-shell-mcp.sample.json`. Documented flow: **copy → edit → `chmod 444`**.

```jsonc
{
  "allowedRoots": ["/Users/you/Servers"],
  "allowedCommands": ["ls", "cat", "grep", "rg", "fd", "git"],
  "deniedCommands": ["curl", "ssh", "nc"],            // always beats allowedCommands
  "enabledTools": ["execute_command", "get_policy"],   // tool-level on/off
  "permissions": { "rm": "deny", "chmod": "ask", "git": "allow" },
  "auditLogPath": "~/.mac-shell-mcp/audit.log",
  "maxOutputBytes": 1048576,
  "timeoutMs": 30000
}
```

`permissions` generalizes the tri-state specified for `rm` (§6) to every command. `enabledTools`
lets a deployment remove a tool entirely — e.g. a headless deployment disabling
`execute_external_command`.

### 5.3 Self-protection — the server must not be usable against its own config

**`chmod 444` is defense-in-depth, not the mechanism.** This server executes `chmod`, `mv`, and `cp`,
so it can unlock or replace its own configuration:

```
chmod +w ~/.mac-shell-mcp/config.json          # server unlocks its own policy
mv /tmp/evil.json ~/.mac-shell-mcp/config.json # replacement needs no write bit on the file at all
```

Replacing a file requires write permission on the **parent directory**, not on the file — so a
read-only file is bypassed by `mv` without touching `chmod`. And because the file is owned by the
user the server runs as, that user can always revert the mode.

The enforcement is therefore **hard-coded in `path-guard.ts`**:

- a non-configurable denied-path set: the resolved config file **and its parent directory**
- applied to every write-effect command (`mv`, `cp`, `rm`, `chmod`, `chown`, `touch`, `tee`),
  regardless of roots and regardless of policy
- **not overridable from the config file** — a self-referential exemption is not protection
- checked after `realpath()`, so symlinks to the config cannot launder access
- **writes blocked, reads allowed.** `cat config.json` exposes nothing `get_policy` does not already
  return, and blocking reads breaks legitimate "show me my setup" workflows

`chmod 444` remains in the documented setup flow as an independent second layer.

### 5.4 `ask` requires an interactive client

`ask` resolves to the host's approval prompt. Headless deployments have no human and Claude Desktop
does not support elicitation, so there is nothing to prompt.

**When no interactive client is detected, `ask` degrades to `deny`,** and the server logs the
downgrade at startup. Degrading to `allow` would silently convert the most cautious setting into the
least safe one in exactly the environment with the least oversight.

### 5.5 First-run posture

Ships with a read-only command set (`ls, cat, grep, rg, fd, find, head, tail, wc, pwd, echo, git`)
and **zero roots**. Every call is therefore denied — but the denial names the allowed commands and
points at the config file or extension settings. The first failure teaches setup rather than
stonewalling.

### 5.6 MCPB specifics

Verified against the installed `@anthropic-ai/mcpb@2.1.2`, manifest schema 0.4:

- field types are `string | number | boolean | directory | file`
- `sensitive` is a boolean **modifier**, not a type
- `multiple: true` is supported; `default` accepts `string[]`
- `mcp_config` carries `command`, `args`, `env`, `platform_overrides`

| `user_config` field | Type | Default |
|---|---|---|
| `allowed_roots` | `directory`, `multiple: true` | *empty* |
| `allowed_commands` | `string` (comma-delimited) | read-only set |
| `rm_policy` | `string` (`denied`/`ask`/`allowed`) | `denied` |
| `audit_log_path` | `file` | `~/.mac-shell-mcp/audit.log` |
| `max_output_bytes` | `number` | 1 MiB |
| `timeout_ms` | `number` | 30000 |

⚠️ **Every field carrying a `default` must be `required: false`.** Claude Desktop (≥1.12603.x) will
otherwise install the connector disabled with "missing required configuration", and renders the
settings form pristine so Save stays greyed out even though the defaults are visibly populated —
leaving users stuck unless they discover that dirtying a field re-enables Save. With
`required: false`, install → auto-enable → connected is a single click. The server's own loader still
errors clearly on a genuinely missing value, so runtime strictness is unchanged.

MCP `roots` and `elicitation` are **not currently supported by Claude Desktop**, so neither can carry
the security boundary. If `roots` support lands, it may only *narrow* within `allowedRoots`, never
widen.

### 5.7 Deployment targets

| Target | Config source | Notes |
|---|---|---|
| Claude Desktop | MCPB form, or file if present | primary target |
| Claude Code | config file | Bash already exists here; low value, but must not break |
| Docker / Smithery | `./.mac-shell-mcp.json` baked in, or `$MAC_SHELL_MCP_CONFIG` | `ask`→`deny` (§5.4) |
| Custom host | any of the above | |

**Positioning caveat for hosted Smithery:** the server executes inside an ephemeral Linux container,
not on the user's Mac. It is not "remote access to your terminal," and macOS-specific commands do not
exist there — the current `Dockerfile` already concedes this. Support it as a deployment target;
do not describe it as remote Mac access.

---

## 6. Delete (`rm`)

Tri-state `rm_policy`, defaulting to `denied`. When `allowed` or `ask`, it is **inside roots only** —
outside roots is denied with no toggle.

### 6.1 Structural rules — independent of git state

- recursive (`-r`/`-R`/`--recursive`) **combined with** force (`-f`/`--force`) → **denied always**,
  including fused short flags (`-rf`, `-fr`)
- `--no-preserve-root` → denied always
- directory removal (`-r` alone) → ask, **with contents enumerated first**: file count, total size,
  and a sample, so the consequence is concrete
- single file inside a root → ask

### 6.2 Recoverability ladder

Computed per target before prompting, and surfaced in the prompt as context:

| Git state | Recoverable | Message |
|---|---|---|
| tracked, clean, pushed | fully | committed and pushed; `git restore` recovers it |
| tracked, clean, not pushed | local only | the remote does not have this yet |
| tracked, modified/staged | committed version only | **N uncommitted changes will be lost** |
| untracked, not ignored | **no** | permanent |
| **ignored** | **no** | **in a repo but gitignored — git will NOT bring it back** |
| not a repo | **no** | permanent unless separately backed up |

The gitignored case is the subtle one: the file *looks* protected because it sits inside a
repository, and it is not.

Plumbing (all verified working): `git rev-parse --show-toplevel`, `git check-ignore -q`,
`git ls-files --error-unmatch`, `git status --porcelain`, `git rev-list --count @{u}..HEAD`.

---

## 7. Audit log and self-suggestion

**Audit log** — append-only JSONL: timestamp, tool, command, args, resolved cwd, tier, exit code,
duration, allow/deny verdict. On by default with a configurable path and size cap. This is the answer
to *"what did Claude actually do?"* and it is what makes handing over a terminal reasonable.

**`suggest_policy_config`** — reads the audit log and emits copy-pasteable config in **both** shapes,
since the target depends on how the server was configured (§5.1): a JSON fragment for the config file
and a comma-delimited string for the MCPB form field.

> You've approved `rg` against `~/Servers` 14 times and denied it 0 times.
>
> Config file — `allowedCommands`:
> ```json
> ["ls", "cat", "rg", "fd", "grep", "head", "tail", "wc", "git"]
> ```
> MCPB field — `allowed_commands`:
> `ls,cat,rg,fd,grep,head,tail,wc,git`

It only *suggests*. The server cannot apply it — §5.3 specifically forbids it from writing the config
file — so a human copies, pastes, and restarts the server. This
closes the loop between observed usage and configuration, which is what makes a restrictive default
tolerable rather than infuriating. It is explicitly **not** a privilege-escalation path, because the
server has no way to act on its own suggestion.

### 7.1 Rejected: `request_command_permission`

An agent-callable tool that grants capability the agent did not have is agent-initiated privilege
escalation, regardless of host prompting — the same reasoning that made `approve_command` look
acceptable. The honest mechanism is elicitation (server-initiated, human-answered), and Claude
Desktop does not support it today. Documented as a future path; not built.

---

## 8. Result correctness

Two defects that make the server hard for an agent to use. Both verified.

**Exit codes are destroyed.** `grep` exiting 1 means *no match* — a normal result. Today:

```
grep ZZZNOMATCH /etc/hosts
  → THREW. code=1 | stdout kept? "" | msg: Command failed: grep …
```

The agent cannot distinguish "found nothing" from "crashed," and stdout is discarded. Fix: return
`{stdout, stderr, exitCode, truncated, durationMs}` and stop throwing on nonzero. Only a **spawn**
failure sets `isError`.

**`maxBuffer` is unset** → 1 MiB default → opaque failure:

```
head -c 2000000 /dev/zero
  → BIG THREW: stdout maxBuffer length exceeded | code=ERR_CHILD_PROCESS_STDIO_MAXBUFFER
```

Fix: explicit cap, graceful truncation, `truncated: true` plus bytes omitted in the payload.

Both returned via `structuredContent` + `outputSchema` (SDK 1.26+) rather than stringly-typed text
blobs. The current handler emits an empty text block when stderr is empty.

**Also:** `cwd` parameter (validated against roots), `stdin` parameter, opt-in `expandGlobs`
(**default false** — `find . -name "*.ts"` requires `*.ts` to arrive literally; auto-expansion would
break `find` and `grep`), and per-session `cwd` so agents stop re-threading it. The `cd` whitelist
entry is a no-op and is dropped.

---

## 9. Module layout

| Module | Responsibility |
|---|---|
| `policy.ts` | Discovery order (§5.1), load + validate config (zod), `ask`→`deny` degradation (§5.4). Immutable after startup. |
| `path-guard.ts` | Path-shape detection, `realpath` resolution, root confinement, **hard-coded config self-protection (§5.3)**. |
| `git-context.ts` | Recoverability ladder (§6.2). |
| `audit-log.ts` | Append-only JSONL + suggestion aggregation. |
| `command-service.ts` | Execution. No shell. Effect/scope classification, pipelines. |
| `index.ts` | MCP surface, annotations, structured output. |

---

## 10. Dependencies

All to latest — the repo is touched rarely, so majors are taken now rather than deferred.

| Package | From | To | Note |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.26.0 | 1.30.0 | annotations, structuredContent |
| `zod` | 3.24 | 4.4.3 | SDK 1.30 declares `^3.25 \|\| ^4.0` — verified compatible |
| `typescript` | 5.8 | 7.0.2 | ⚠️ native port. Verify ts-eslint + ts-node before committing; fall back to 5.9 and say so if the toolchain is not ready |
| `eslint` | 9 | 10.8.1 | flat config already present |
| `jest` | 29 | 30.4.2 | watch ESM config |
| `@types/node` | 20 | 26.2.0 | |

**Audit findings:** 8 (6 high) — `path-to-regexp`, `qs`, `ip-address`. **All transitive via the SDK's
express/HTTP transports, which this server never instantiates** (stdio only), so none are reachable.
The SDK bump clears them regardless. Reported honestly rather than as "6 high severity."

Note: `4055d8b fix(security): resolve production dependency vulnerabilities` is the most recent
commit, yet `npm audit` is still dirty — that fix did not hold.

---

## 11. Testing

TDD. Tests import from `build/`, so `npm run build` gates every run.

**⚠️ The existing tests assert `addToWhitelist` works — they currently encode the vulnerability as
intended behavior.** They change meaning in this pass.

Regression tests, derived from the verified exploits:

1. Injection PoC — assert the sentinel file is **not** created
2. Forbidden command cannot be promoted (mutation tools absent from `ListTools`)
3. `execute_command` rejects an out-of-root path (no silent routing)
4. `execute_pipeline` rejects a privileged stage 2
5. Symlink-out-of-root escape blocked
6. `find -exec` rejected; `git clean -fdx` rejected
7. `rm -rf` denied regardless of policy; `rm` of a gitignored file yields the unrecoverable warning
8. `grep` no-match returns `exitCode: 1` with `isError` unset
9. Output over cap truncates rather than throwing
10. **Config self-protection (§5.3)** — each must be denied even when the config path sits inside an
    allowed root and its command is otherwise permitted:
    - `chmod +w <config>` denied
    - `mv <anything> <config>` denied (the read-only-file bypass)
    - `cp`/`rm`/`touch`/`tee` against `<config>` denied
    - writes to the config's **parent directory** denied
    - a symlink resolving to `<config>` denied
    - `cat <config>` **allowed** (reads permitted by design)
    - a config file attempting to exempt its own path has no effect
11. `ask` degrades to `deny` when no interactive client is present (§5.4) — never to `allow`
12. Precedence (§5.1): file beats env; the ignored source is named in the startup log

---

## 12. Release

- `2.0.0` — breaking (tools removed/renamed)
- MCPB manifest + **signed** bundle (`mcpb pack` / `mcpb sign`) as a 2.0.0 deliverable — without it
  the config screen does not exist and the security model has no UI
- GHSA advisory crediting Taran / Shroud Labs. Reported 2026-08-09, proposed disclosure 2026-11-07
  (dates read DD/MM)
- `SECURITY_REVIEW.md` rewritten (§1.3); `README.md` and `SECURITY.md` corrected — both currently
  describe the approval workflow as a real control
- Fix `index.ts:30` version string (`1.0.0` vs package.json `1.1.0`)
- **`smithery.json` rewritten** — it currently advertises the removed tools (`add_to_whitelist`,
  `update_security_level`, `remove_from_whitelist`, `approve_command`, `deny_command`,
  `get_pending_commands`) and stale `environment` keys (`MAC_SHELL_SAFE_MODE`,
  `MAC_SHELL_APPROVAL_TIMEOUT`) that no longer exist. Left as-is it would publish the vulnerable
  surface as the documented API.
- **`Dockerfile` updated** — must ship/mount a config file and set `$MAC_SHELL_MCP_CONFIG`, otherwise
  a container starts with built-in defaults and zero roots. Also drop the misleading `EXPOSE 3000`
  (the stdio transport binds no port), and collapse the redundant
  `npm ci --only=production && npm ci --only=development` — verified that the second call installs
  both prod and dev dependencies, so the first is wasted work rather than a correctness bug. Both
  flags are deprecated in favour of `--omit=dev`.
- `.mac-shell-mcp.sample.json` added, with the copy → edit → `chmod 444` flow documented in README

---

## 13. Open risks

1. **Path detection is heuristic** (§3.1). Mitigated by failing closed; documented, not hidden.
2. **TypeScript 7** toolchain compatibility unverified (§10).
3. **`allowed_commands` as a comma-delimited string** is a weak config surface — MCPB has no
   list-of-strings type. Acceptable, and `suggest_policy_config` exists to generate it.
4. **No enforcement against a malicious client.** A client that ignores annotations gets whatever
   `allowedCommands` + `allowedRoots` permit. The server-side policy is the real boundary;
   annotations are UI hints only.
5. **The config file is a single point of trust.** Anyone who can write it owns the server's
   authority. §5.3 stops *this server* from being the one to write it, and `chmod 444` raises the bar
   for everything else — but a separate process running as the same user can still rewrite it. That
   is inherent to file-based config and is not solvable from inside this process.
6. **`ask` is only as strong as the host.** It resolves to the client's approval prompt, so a host
   configured to always-allow silently converts every `ask` into `allow`. Headless deployments
   degrade to `deny` (§5.4), but a *misconfigured interactive* host is outside our control.
