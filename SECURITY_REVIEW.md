# Security Review: mac-shell-mcp 2.0

## Allowlist and Root-Confinement Model, as Implemented in 2.0.1

**Date:** November 2, 2026
**Version reviewed:** 2.0.1 (`src/` at the head of `main`)
**Reviewer:** Claude Code
**Supersedes:** the February 20, 2026 review of 1.x, which recommended a shell-metacharacter blocklist
**Status:** Describes the shipped model. Where the code and the 2.0 specification disagree, this document follows the code and lists each difference under [Where the implementation differs from the specification](#where-the-implementation-differs-from-the-specification).

---

## Executive Summary

1.x was protected by a command-name tier list (`safe`, `requires approval`, `forbidden`) that the agent could edit and approve for itself, and every command ran through a shell. 2.0 replaced that with a deny-by-default model:

- **No shell.** Arguments go straight to `execve` and are never interpreted.
- **Allowlists only.** A command runs only if policy names it, pins it to a program path inside a configured program directory, and every argument matches that command's allowlist. A command with an empty allowlist accepts no arguments at all.
- **Root confinement.** The working directory and every path-shaped argument must resolve inside a configured root, after following symbolic links. Anything outside the roots goes through a separate tool, `execute_external_command`, which needs approval.
- **Policy the agent cannot touch.** Policy is read once at startup from a file. No tool changes it, and the server will not run a known writing command against its own configuration, program directories or audit log.
- **A small default set.** The default commands are `ls`, `pwd`, `echo`, `cat`, `head`, `tail`, `wc` and `grep`. None of them, with its allowed flags, can write a file or run another program.

The earlier version of this document recommended rejecting arguments that contain shell metacharacters. That advice was wrong and has been withdrawn (see [Why the blocklist recommendation was withdrawn](#why-the-blocklist-recommendation-was-withdrawn)).

Three vulnerability classes are covered under [Vulnerability history](#vulnerability-history): shell injection (CWE-78) and missing authorization (CWE-862) in 1.x, and an argument-allowlist bypass in 2.0.0 that 2.0.1 fixes. The supported release is 2.0.1. Do not run 1.x or 2.0.0.

This review also found places where the code does less than the specification says. Four of them matter: approval (`ask`) can never actually be granted; unsafe program directories are reported but still used; write protection is keyed on command names, not on the operation; and path arguments are checked and then executed by their original strings. Each is listed below with the behavior the code actually has.

---

## Threat Model

### What is being protected

- Files outside the configured roots, above all credentials (`~/.ssh`, `~/.aws`, tokens in dotfiles).
- The ability to run arbitrary code as the user who runs the server.
- The server's own trust anchors: the policy file and the directories it can be discovered in, the program directories, and the audit log.

### Who the adversary is

- **The agent driving the MCP client.** It may be prompt-injected by content it reads, such as a file inside a root, a web page or tool output, and it may call any exposed tool with any arguments, in any order, concurrently.
- **A hostile repository.** A directory the user configures as a root may contain attacker-written files, symbolic links, hard links and configuration files.

### What is trusted

- The human who writes the policy file and chooses the roots.
- The operating system, and the system program directories (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin` by default).
- The MCP host's own approval prompt, where one exists.

### Out of scope

- **A malicious or misconfigured client or host.** Tool annotations are hints for the host's UI. The server-side policy is the boundary. A host set to always-allow defeats any approval step the host owns.
- **Another process running as the same user.** It can rewrite the policy file, the program directories it can write to, or the audit log. Nothing inside this process can stop that.
- **Sandboxing the executed program.** A permitted command runs with the full permissions of the user. There is no seccomp, sandbox profile or privilege drop.
- **Running the server privileged.** Running it under `sudo`, or as root outside a container, is unsupported.
- **Network exposure.** The server speaks stdio only. CI fails if source or build output references an HTTP or SSE transport. That check matches text and can be evaded by an indirect reference. It is a tripwire, not a proof.

---

## Controls

Each control is described by what it does, what it stops, and what it does not stop. File references are to `src/` at 2.0.1.

### 1. Shell-free execution

**What it does:** `spawn()` in `services/command-service.ts` calls `execFile(program, args, …)` with no `shell` option. A test asserts that no source file passes one.

**Stops:** Argument content being read as shell syntax. Separators, redirections, command substitution, quotes and globs reach the program as literal bytes. Because nothing is sanitized, filenames with spaces, parentheses or brackets work normally.

**Does not stop:** A program that interprets its own arguments. An interpreter given inline code, or `find -exec`, runs code with no shell involved. That risk is handled by the allowlist and the default set (controls 3 and 5), not by this control.

### 2. Program authorization

**What it does:** `resolveProgram()` in `path-guard.ts`:

- refuses a command name that contains `/`;
- realpath-resolves the program path that policy pins for the command;
- requires the resolved program to lie inside a configured program directory and outside every configured root;
- requires the resolved program to be executable;
- executes the resolved absolute path. The command name is never looked up on `PATH`.

**Stops:** Running a file the agent wrote into a root under a permitted command's name. Matching by basename. A program directory symlink that points into a root.

**Does not stop:**

- **An unsafe program directory.** A directory with an unprivileged write path is reported at startup but still used (see difference 2).
- **A pinned path that is itself a symbolic link.** It is followed to its target and the target is run, provided the target is inside a program directory. The code does not refuse because the target differs from the pinned path (see difference 10).

### 3. Argument allowlists

**What it does:** `argPermitted()` checks every argument, wherever it appears:

- An argument listed exactly in `allowedArgs` passes.
- A long flag (`--…`) must match exactly.
- A fused short-flag group passes only if every letter in it is individually allowed.
- Only flags listed in `VALUE_FLAGS` for that command (`head`/`tail` `-n`/`-c`, `grep` `-A`/`-B`/`-C`) may carry a fused value, and the value must be numeric.
- An operand (anything not starting with `-`, or a bare `-`) passes this check and is scope-checked by control 6.
- A command whose `allowedArgs` is empty accepts nothing, operands included.

**Stops:** Any flag nobody thought to allow. No rule has to name a dangerous flag for it to be refused. This includes link-following recursion flags, which the default allowlists leave out (`grep -R`/`-S`, `ls -R`/`-L`).

**Does not stop:**

- **The behavior of a flag that is allowed.** An allowlist is only as good as the review of what it lists.
- **Flag meanings that differ between implementations.** The same flag can mean different things in different versions of a program, so allowlists are written for the pinned program path.
- **Arguments that name a program to execute.** The specification asks for these to be program-authorized. The code does nothing of the kind (see difference 4). If a human adds a command with such a flag, only the scope check applies to the value.

### 4. Constructed child environment

**What it does:** Every child gets exactly `{ PATH: '', LC_ALL: 'C' }`. Nothing is inherited from the server's environment.

**Stops:** Environment variables that load configuration or select a helper program from outside the argument vector, which no argument allowlist could see. It also stops `PATH` lookup inside the child.

**Does not stop:** Configuration a program reads from fixed file locations, such as a system-wide configuration file or a file in its working directory.

### 5. Default command set

**What it does:** `DEFAULT_COMMANDS` in `policy.ts` contains `ls`, `pwd`, `echo`, `cat`, `head`, `tail`, `wc` and `grep`, each pinned to a system path with a short flag allowlist. `EXCLUDED_BY_DEFAULT` lists the commands deliberately left out: `find`, `git`, `rm`, shells, interpreters, `env`, `xargs`, `open`, build tools, network tools, pagers, editors and archivers. If a policy file declares any commands, its list replaces the default set entirely. Host-environment configuration (`MAC_SHELL_COMMANDS`) can only select from the default set.

**Stops:** A fresh install offering anything that writes, executes another program or reads configuration through a flag.

**Does not stop:** Whatever a human adds. `find` has flags that write files. `git` runs commands from a repository's own configuration. Interpreters take code as arguments. Adding any of these is a deliberate widening of trust.

### 6. Scope confinement

**What it does:** `classifyScope()` in `path-guard.ts`:

- Refuses everything when no roots are configured.
- Requires the working directory, after realpath, to lie inside a root. A request that supplies no working directory runs in the first root, never in the server's own working directory. A request with no path argument is therefore judged by where it runs, rather than passing because it named nothing.
- Treats an argument as path-shaped when it contains `/` or starts with `~`, or when it names an entry that exists relative to the working directory. A value fused to a flag (`--opt=value`, `-ovalue`) is split off and checked the same way.
- Resolves each path-shaped argument to its nearest existing ancestor, following symbolic links and correcting case, and requires it to lie inside a root. Containment is compared on whole path segments.
- Refuses a named non-directory with a link count above one, because its content may be reachable from outside the roots.

**Stops:**

- Naming a path outside the roots, whether directly, through `~`, through `..`, or through a symbolic link inside a root.
- Shared-prefix siblings, such as `/tmp/foo` against `/tmp/foobar`.
- Laundering a file into a root through a hard link, when that file is named as an operand.

**Does not stop:**

- **Reads inside a root.** Everything inside a root is freely readable, so a root should be a project directory.
- **Arguments the heuristic does not see as paths.** An argument with no `/` or `~` that does not exist is treated as a non-path and is not scope-checked (see difference 6).
- **Hard-linked files found during recursion.** Files reached during a recursive search are not checked for hard links (see difference 13).
- **Races.** The arguments are checked, then passed to the program as their original strings, so a link swapped in between the check and the execution is not caught (see difference 9).

### 7. Tool split and permissions

**What it does:** There are three execution tools:

- `execute_command` refuses any request outside the roots and names the external tool in its refusal.
- `execute_pipeline` is confined the same way, and additionally refuses any stage whose effect is not `read`. Every stage is authorized before any stage runs.
- `execute_external_command` is the only route to paths outside the roots. Out-of-root requests resolve to `ask` at minimum, whatever the command's confined permission. Policy can raise this to `deny` but cannot lower it to `allow`.

`ask` is refused when the client is not interactive. `deny` and `deniedCommands` always refuse, even if the command is also permitted.

Annotations: `execute_command` declares `openWorldHint: false` and `readOnlyHint: false`; `execute_external_command` declares `openWorldHint: true`; `execute_pipeline` and the reporting tools declare `readOnlyHint: true`.

**Stops:** The confined tools ever reaching outside the roots. A later pipeline stage running because an earlier stage was acceptable.

**Does not stop:** Anything, in practice, through `ask`. The server hard-codes `interactive: false`, so every `ask` is refused and out-of-root work through `execute_external_command` cannot run (see difference 1). That is fail-closed. It means the external tool is inert, not that it is gated by a human.

### 8. Policy loading and immutability

**What it does:** `discover()` in `policy.ts` checks four sources in order and uses the first match without merging: `$MAC_SHELL_MCP_CONFIG`, then `~/.mac-shell-mcp/config.json`, then host environment variables, then built-in defaults. The working directory is never a source. Policy is validated with zod, read once at startup and never re-read. No tool adds, removes, re-classifies, approves or denies anything. The seven 1.x policy and approval tools are gone, not gated. `get_policy` always stays enabled, so a client can always learn what is permitted.

**Stops:** The agent widening its own authority at runtime. A cloned repository supplying the policy that governs the agent that opened it.

**Does not stop:** Anyone who can write the policy file outside this process. The policy file is a single point of trust. `chmod 444` raises the bar but is not the mechanism.

### 9. Protected locations

**What it does:** `ProtectedSet` in `path-guard.ts` records these locations by path, and by device and inode where they exist at startup:

- `~/.mac-shell-mcp/config.json` and `~/.mac-shell-mcp/`;
- the audit log directory;
- every program directory;
- the active policy file and its directory, when policy came from a file.

For any command named in `WRITE_OPERATIONS` (`mv`, `cp`, `rm`, `touch`, `chmod`, `chown`, `tee`, `ln`, `mkdir`, `rmdir`, `dd`, `truncate`), every path-shaped argument is refused if it is a protected location, lies inside one, or is an ancestor of one. Identity matching means a different-case path or a hard link to the same file is refused too. Reading protected locations is allowed.

**Stops:** A listed writing command modifying, replacing, re-linking or unlocking the policy, the program directories or the audit trail. It also stops renaming an ancestor directory out of the way. The default set contains no writing command, so none of this is reachable on a default install.

**Does not stop:** A writing program that is not in that name list. Examples are a writing binary added to policy under a different name, or a read-declared command with an output-file flag. Neither is checked against protected locations (see difference 3). Add a command that writes only if you trust everything it can write.

### 10. Root validation

**What it does:** At load time, `validateRoot()` refuses a root that resolves to exactly `/` or exactly the user's home directory, then realpath-resolves the root. The server warns at startup when a root contains `.ssh`, `.aws`, `.env`, `.npmrc` or `.git/config`.

**Stops:** The two most common over-broad roots.

**Does not stop:**

- **An ancestor of the home directory, or a symbolic link to it.** The home check runs before symbolic links are resolved, so either passes (see difference 11).
- **Credential files outside the warning list.** These are not warned about, and the warning does not refuse the root.

### 11. Audit log and suggestions

**What it does:** `AuditLog` appends one JSON line per decision. Serializing with JSON escapes newlines in arguments, so an argument cannot forge a record. When the active file passes its share of the size budget it is renamed. Older rotated files are pruned so the total file count and byte count stay bounded. The audit directory is a protected location (control 9).

`suggest_policy_config` reads the log and proposes `permission: allow` for already-permitted commands that were allowed and never refused, in both config-file and host-field form. It never proposes a new command, a program directory, or text taken from arguments. It cannot apply its own suggestion.

**Stops:** The agent rewriting or aging out its own trail with a listed writing command. Repeated refused requests manufacturing a suggestion.

**Does not stop:**

- **A full record of every request.** Some refusals and failures are never recorded (see difference 7).
- **A broken log.** Append errors are swallowed, so commands keep running when the log cannot be written.
- **Loss of history.** Pruning discards the oldest records by design.

### 12. Resource bounds

**What it does:**

- **Output cap.** Each of stdout and stderr is capped at `maxOutputBytes`. Past the cap, collection stops, the child is sent SIGTERM, and the result is marked truncated with the amount omitted.
- **Timeout.** Each command has one. A timeout is reported separately from a non-zero exit.
- **Concurrency.** Concurrent executions are capped at `maxConcurrent`. Excess requests are refused.
- **Exit codes.** A non-zero exit is a normal result. Only a failure to start is an error.

**Stops:** Large output exhausting the server's memory, including the output of intermediate pipeline stages. Unbounded parallel spawning.

**Does not stop:**

- **Long timeouts chosen by the caller.** A request may supply its own `timeoutMs`, and nothing caps it at the policy value (see difference 12).
- **Long pipelines.** Pipeline stages each get the full timeout, so a pipeline can run for as many timeouts as it has stages.
- **Byte-exact output limits.** The cap counts characters rather than bytes (see difference 14).

---

## Vulnerability History

Advisory credits are recorded in `CHANGELOG.md`. Classes are described here without reproduction steps.

### 1.x: OS command injection (CWE-78)

1.x passed a `shell` option to `execFile`, and that option was always set. Every command therefore ran through `/bin/zsh`, with its arguments joined into a command line and re-parsed. Any argument to any permitted command could carry further shell syntax, so every permitted command amounted to arbitrary code execution as the user.

The previous version of this document described the shell as "conditionally" enabled. It was unconditional.

**Fixed in 2.0.0** by removing the shell from every call site (control 1), not by filtering argument content.

### 1.x: Missing authorization (CWE-862)

1.x gave the agent the tools to approve its own queued requests, and tools that added commands to the whitelist or changed their security level at runtime. Adding a command overwrote a `forbidden` entry. With no human anywhere in the loop, any client could promote a forbidden command and run it. The approval tier and the forbidden tier offered no protection against the agent they were meant to constrain.

**Fixed in 2.0.0** by removing all seven policy and approval tools and making policy a file read once at startup (control 8).

### 2.0.0: Argument-allowlist bypass, fixed in 2.0.1

2.0.0 had two faults in its argument check:

- **Fused flag groups.** A fused short-flag group was read as one permitted flag carrying a value, not as a set of flags. Any disallowed flag letter could therefore ride behind a permitted one. That reached flags the allowlists deliberately leave out, including the link-following traversal flags, so a symbolic link inside a root could be used to read or list files outside the roots.
- **Empty allowlists.** A command whose allowlist was empty accepted every argument.

The result was a confinement bypass, not code execution. The default set still contained nothing that writes or executes.

**Fixed in 2.0.1:**

- Every letter in a fused group must be individually allowed.
- Only flags that take a value for that specific command may carry a fused value, and only a numeric one.
- An empty allowlist accepts nothing.
- A test enumerates every default command against every flag letter and fused shape.

---

## Where the Implementation Differs from the Specification

The specification is `openspec/changes/mac-shell-mcp-2-security-redesign/`, with its design record in `docs/superpowers/specs/2026-08-13-mac-shell-mcp-2.0-security-redesign.md`. Each entry below gives what the specification says and what 2.0.1 does. This document describes the second.

1. **`ask` is never approved.** The specification says a client that declares MCP `elicitation` is asked before an `ask` command runs. The code never reads client capabilities and never issues an elicitation request: `main()` in `index.ts` passes `interactive: false` unconditionally. Every `ask` is refused, and `execute_external_command` can never run out-of-root. If `interactive` were ever set to true, `authorize()` would let an `ask` command run with no prompt at all, because no prompting code exists.
2. **Unsafe program directories are still used.** The specification says programs are not resolved from a directory with an unprivileged write path. The code reports such a directory at startup as one that "will not be used", but `resolveProgram()` never calls `programDirIsSafe()`, so programs in it still resolve and run.
3. **Protection is keyed on a name list, not the operation.** The specification says protected locations are refused based on the operation a request performs, regardless of declared effect. The code checks protected locations only when the policy command name is in `WRITE_OPERATIONS`. A writing binary under another name, or a read-declared command with an output flag, is never checked. `README.md` was corrected for this in 2.0.1. `SECURITY.md` still describes operation-based protection.
4. **No program authorization for arguments that name a program.** The specification requires an argument naming a helper, pre-processor or script to pass program authorization, not just scope. The code has no such logic. It relies on the default allowlists not containing such flags.
5. **No glob expansion option.** The specification and design describe opt-in, scope-respecting glob expansion. The tool schemas have no such field, and the server never expands globs. This removes surface but does not match the specification.
6. **Unclassifiable arguments are not failed closed.** The specification (the `@responsefile` scenario) and `SECURITY.md` say ambiguous arguments are treated as out of scope. The code treats any argument without `/` or a leading `~` that does not exist as a non-path, and does not scope-check it.
7. **The audit log does not record every request.** The specification says every request, permitted or refused, is recorded with its effect and scope. The code falls short in several ways:
   - Refused records carry no effect or scope.
   - Allowed records always say `scope: "in-root"`.
   - Three cases are not recorded at all: the refusal raised when no working directory is given and no roots exist; tool-argument validation failures; and programs that fail to start.
   - Append errors are swallowed.
   - Rotation does not report where rotated records went.
8. **Suggestions are narrower than specified.** The specification allows proposing roots derived from admitted working directories, and including permitted and refused counts. The code proposes only `permission: allow` for commands allowed with zero refusals, with no counts and no roots.
9. **Only the program is executed by its resolved path.** The design says the race between resolution and execution is mitigated by executing against what was resolved. That is true for the program. The working directory and path arguments are passed to `execFile` as the caller supplied them.
10. **Pinned-path mismatch is never detected.** The specification says a command whose resolved path differs from the path policy pins is refused. The comparison in `resolveProgram()` compares the realpath of the pinned path with itself, so it always passes. A pinned path that is a symbolic link is followed silently.
11. **Root validation can be sidestepped.** The specification says the home directory is refused as a root. The check compares the root before resolving symbolic links, so a link to the home directory is accepted. Ancestors of the home directory are accepted too.
12. **The timeout can be overridden by the caller.** The specification says a configurable timeout applies to every command and pipeline. `execute_command` and `execute_external_command` accept a per-request `timeoutMs` with no upper bound. Pipelines apply the timeout per stage, not to the whole pipeline.
13. **Hard-link refusal applies only to named operands.** The hard-link scenarios do not distinguish operands from files a recursive search finds. The code checks link counts only on named path arguments.
14. **Smaller gaps:**
    - The credential warning list has no private-key files or `.env*` variants, which the tasks name.
    - The "environment configuration ignored" startup notice fires only when `MAC_SHELL_ROOTS` is set, not when only `MAC_SHELL_COMMANDS` is.
    - The output cap counts characters, not bytes.

Differences 1 and 2 are code defects that this document does not fix. Differences 3, 6 and, by implication, 1 also make `SECURITY.md` overstate the shipped behavior.

---

## Known Limits

These hold even where the code matches the specification:

- **Path detection is heuristic.** Deciding which arguments are paths cannot be perfect.
- **Everything inside a root is readable** by a single recursive search.
- **The policy file is a single point of trust** against any process other than this one.
- **`ask`, once approval exists, is only as strong as the host's prompt.** A host set to always-allow turns it into `allow`.
- **Flag semantics vary between implementations** of the same command name, so an allowlist is correct only for the program it was written for.
- **There is no sandbox.** Permitted commands run with the user's full permissions.
- **There is no delete capability.** `rm` is unavailable, as it was in 1.x. The deferred design is in `openspec/deferred/delete-safety-2.1.md`.
- **Adding a command is a trust decision.** That holds for `find`, `git`, an interpreter, or anything listed in `EXCLUDED_BY_DEFAULT`, and none of the controls above make it safe.

---

## Why the Blocklist Recommendation Was Withdrawn

The 1.x review recommended rejecting any argument containing shell metacharacters. It also floated disabling the shell as an alternative that "may break commands". 2.0 took the second option and rejected the first, for three reasons:

- **Once no shell runs, argument content cannot inject anything.** Filtering it adds no protection.
- **The blocklist would have broken ordinary use.** It would reject legitimate filenames with spaces, parentheses or brackets, and every glob pattern passed to a command that does its own matching.
- **A blocklist only covers the characters someone thought of.** The same reasoning applies to flags. 2.0 admits only allowlisted arguments and never relies on a list of forbidden ones.

Static analysis coverage is a separate question from the security model and is not covered by this review.

---

## References

- CWE-78: Improper Neutralization of Special Elements used in an OS Command
- CWE-862: Missing Authorization
- Node.js documentation: `child_process.execFile()` and the `shell` option
- `SECURITY.md`: reporting process and user-facing known limitations
- `CHANGELOG.md`: release notes and advisory credits for 2.0.0 and 2.0.1
- `openspec/changes/mac-shell-mcp-2-security-redesign/`: the 2.0 specification
