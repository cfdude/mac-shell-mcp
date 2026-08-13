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

| Tool | Annotation | Purpose |
|---|---|---|
| `execute_command` | `readOnlyHint: true` | Everything resolves **inside** roots, non-delete. Safe to set always-allow. |
| `execute_external_command` | `destructiveHint: true` | Anything reaching outside roots, or deleting. Set always-ask. |
| `execute_pipeline` | `readOnlyHint: true` | stdout→stdin in-process, replacing `\|`. |
| `get_policy` | `readOnlyHint: true` | Agent discovers what's permitted without guessing. |
| `suggest_policy_config` | `readOnlyHint: true` | §7. |

Annotations (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`) are supported
in SDK 1.26 and used by clients to shape approval UI. The current server sets none.

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

Claude Desktop has **no ambient working directory** — it launches the server as a bare process with
no project context. There is no "current repo" to infer, so roots must be explicitly configured.

Policy is read at startup from the MCPB `user_config` (env/args) with a local JSON file
(`~/.mac-shell-mcp/policy.json`) as fallback for non-Desktop clients. **Never mutated at runtime.**

Verified against the installed `@anthropic-ai/mcpb@2.1.2`, manifest schema 0.4:

- field types are `string | number | boolean | directory | file`
- `sensitive` is a boolean **modifier**, not a type
- `multiple: true` is supported; `default` accepts `string[]`
- `mcp_config` carries `command`, `args`, `env`, `platform_overrides`

| Config field | Type | Default |
|---|---|---|
| `allowed_roots` | `directory`, `multiple: true` | *empty* |
| `allowed_commands` | `string` (comma-delimited) | read-only set |
| `rm_policy` | `string` (`denied`/`ask`/`allowed`) | `denied` |
| `audit_log_path` | `file` | `~/.mac-shell-mcp/audit.log` |
| `max_output_bytes` | `number` | 1 MiB |
| `timeout_ms` | `number` | 30000 |

MCP `roots` and `elicitation` are **not currently supported by Claude Desktop**, so neither can carry
the security boundary. If `roots` support lands, it may only *narrow* within `allowed_roots`, never
widen.

### 5.1 First-install posture

Ships with a read-only command set (`ls, cat, grep, rg, fd, find, head, tail, wc, pwd, echo, git`)
and **zero roots**. Every call is therefore denied — but the denial names the allowed commands and
directs the user to the extension's settings. The first failure teaches setup rather than stonewalling.

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

**`suggest_policy_config`** — reads the audit log and emits a copy-pasteable value for the Desktop
config field:

> You've approved `rg` against `~/Servers` 14 times and denied it 0 times.
> Suggested `allowed_commands`: `ls,cat,rg,fd,grep,head,tail,wc,git`

It only *suggests*. The server cannot apply it; a human copies, pastes, and restarts the server. This
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
| `policy.ts` | Load + validate config (zod). Immutable after startup. |
| `path-guard.ts` | Path-shape detection, `realpath` resolution, root confinement. |
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

---

## 13. Open risks

1. **Path detection is heuristic** (§3.1). Mitigated by failing closed; documented, not hidden.
2. **TypeScript 7** toolchain compatibility unverified (§10).
3. **`allowed_commands` as a comma-delimited string** is a weak config surface — MCPB has no
   list-of-strings type. Acceptable, and `suggest_policy_config` exists to generate it.
4. **No enforcement against a malicious client.** A client that ignores annotations gets whatever
   `allowed_commands` + `allowed_roots` permit. The server-side policy is the real boundary;
   annotations are UI hints only.
