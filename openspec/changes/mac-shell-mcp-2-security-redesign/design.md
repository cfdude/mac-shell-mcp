## Context

See `proposal.md` — Why, for motivation, and the capability specs for the behavior contract. The authoritative design discussion is `docs/superpowers/specs/2026-08-13-mac-shell-mcp-2.0-security-redesign.md`; this document records the technical decisions that implement it.

Constraints that shape the approach:

- The server is a stdio MCP process launched by a host. It has **no ambient working directory** under Claude Desktop, and no project context to infer roots from.
- Claude Desktop currently supports neither MCP `elicitation` nor `roots`, so neither can carry the security boundary.
- In MCP, a host's never/always/ask setting attaches to the **tool name**. The tool surface is therefore the permission surface.
- Existing tests import from `build/`, so `npm run build` gates the suite. `ts-jest` is not a dependency.
- This is a published npm package with a `bin`; existing installs are exposed until a fixed release lands.

## Goals / Non-Goals

**Goals:**

- Authorization that reflects blast radius, decided per call.
- A configuration model that works identically on every host.
- Self-protection that survives a hostile or misconfigured policy file.
- Results an agent can act on without guessing.

**Non-Goals:**

- Defending against a malicious *client*. Annotations are UI hints; the server-side policy is the boundary.
- Defending against another process running as the same user. That process can rewrite the policy file, and nothing inside this process can prevent it.
- Sandboxing or privilege reduction of the executed command itself.
- Interactive approval implemented by this server. The host's prompt is the human gate.

## Decisions

### Remove the shell rather than sanitize arguments

`execFile` is called without the `shell` option, so the argument vector reaches `execve` uninterpreted.

*Alternative rejected — a shell metacharacter blocklist*, which the current on-disk `SECURITY_REVIEW.md` recommends as its preferred fix. It rejects `My File (2).txt`, `report[final].pdf`, and every glob, while remaining a blocklist that can likely be evaded. Removing the shell is simultaneously safer and less restrictive: once nothing interprets `;` or `$()`, argument *content* stops being a security concern. That document is rewritten as part of this change so it stops recommending the worse option.

### Authorize on effect × scope, computed per call

Effect is a static per-command property (`read`/`write`/`delete`); scope is computed by resolving path-shaped arguments and testing them against configured roots.

*Alternative rejected — the existing command-name allowlist.* It cannot distinguish `grep ./src` from `grep ~/.aws/credentials`, which is the distinction that matters. A name-based tier is bypassable precisely because the name is not where the risk lives.

### Split tools by confinement, and annotate honestly

`execute_command` (confined, non-delete) and `execute_external_command` (reaches outside, or deletes). The confined tool is annotated `readOnlyHint: false` — it genuinely writes inside roots — and earns always-allow through `openWorldHint: false`.

The load-bearing annotation is `openWorldHint`, not `readOnlyHint`: `mkdir ./build` inside a chosen root is unremarkable, while *reading* `~/.aws/credentials` is not. Annotating the confined tool `readOnlyHint: true` would be a false claim to the client, and the model depends on these hints being truthful.

*Alternative rejected — a single `execute_command`.* It forces the human into approving every `ls` forever or setting always-allow and losing the gate. Everyone ends up at the second, which silently recreates the hole.

The split is only real if enforced: the confined tool **refuses** an out-of-scope or delete request rather than rerouting it, and pipelines authorize every stage independently. These are the primary test targets.

### Authorize the program, not only its arguments

The effect × scope model as first written authorized *arguments* and never the binary. That is a hole in the abstraction, not a missing rule: 1.x matches policy by basename (`src/services/command-service.ts:258`) and then executes the requested string verbatim (`:336`), so a file the agent writes into a root and names `ls` matches the permitted `ls` and runs.

Programs are therefore resolved to an absolute path, matched **by resolved path rather than basename**, resolved only from configured program directories, and refused outright when they resolve inside a configured root. Roots hold data; they are never a source of code. A command carrying no declared effect denies rather than defaulting.

### Deny exec-capable commands as a class, not by enumeration

The first draft denied `find -exec` and destructive `git` subcommands and considered the problem handled. It is not enumerable. Verified live during review:

```
git -c alias.pwn='!echo OWNED; id -un' pwn     → executes arbitrary shell
awk 'BEGIN{system("id -un")}'                  → awk supplies its own shell
```

Neither carries a path-shaped argument; both are read-effect and fully confined. `perl -e`, `python -c`, `osascript -e`, `tar --use-compress-program=`, `rsync -e`, `xargs`, `env` and `sed -i` are the same shape, and any list of them is a list of the ones someone happened to think of.

So the rule is a **class**: a command that can spawn a process, evaluate code, or invoke a shell is denied unless policy names it explicitly. The per-command argument rules remain, but they are now a second layer over commands already permitted, and the documentation states plainly that they cover only the commands they name.

`git` additionally loses `-c`, `--exec-path`, `-C` and configuration-writing subcommands, and its destructive-subcommand rule becomes order- and spelling-insensitive — `git clean -xdf` was accepted by the first draft's literal `-fdx` denial. `git gc --prune=now` and `git reflog expire` are denied too, because the delete-safety recoverability report would otherwise confidently report content that had just been destroyed.

### Protect by filesystem identity, and protect every discovery location

Path-string comparison fails three ways, two verified on this machine:

- **Case.** `realpathSync('./CFG.JSON')` returns the caller's casing on APFS; only `realpathSync.native` case-corrects. A string-compared denied set is bypassed by `~/.MAC-SHELL-MCP.JSON`.
- **Hard links.** `ln <config> <root>/cfg` makes the config reachable at an unprotected path, and writing through the link truncates the original inode.
- **Shadowing.** Protection covering only the *active* policy file lets the agent write a config into a working directory, which — being higher in the discovery order — wins outright on the next start. That is CWE-862 deferred by one restart.

Protection therefore compares `(st_dev, st_ino)`, covers **every** path in the discovery order plus the audit log, refuses link creation where either operand resolves to a protected inode, and extends to delete-effect commands as well as write — the first draft said "write-effect", while the model defines `delete` as a *separate* effect, so `rm <config>` escaped the guard the task list claimed to test.

A change in which source supplies policy is reported at startup and not adopted unattended.

### Deletion is a two-call contract, because there is nothing else to confirm with

The first draft required "confirmation" before a directory delete while the design simultaneously ruled out this server implementing approval, and the target host supports no elicitation. The only remaining carrier would have been a `confirm: true` parameter the agent sets itself — `approve_command` under a new name.

Instead the first call never deletes: it refuses and returns the enumeration and recoverability report. Deletion happens only on a separate subsequent call, which the host prompts for independently. Where no interactive client is present, deletes are refused outright.

### Path detection is heuristic and fails closed

An argument is path-shaped when it is not a flag and either contains a separator or `~`, or resolves to an existing entry. Relative paths resolve against the request's working directory; comparison happens after `realpath` on both sides and on whole segments.

This cannot be perfect — `grep -r pattern /dir` is separable, but a novel command's argument grammar may not be. **Ambiguity resolves to out-of-scope**, which over-prompts rather than under-protects. Documented as a limitation rather than presented as airtight.

### The config file is canonical; the extension manifest is one delivery mechanism

Discovery order is explicit path → working directory → home directory → host environment → built-in defaults, first match wins, **never merged**. Where a file and host environment both exist, the file wins and startup names the ignored source.

*Alternative rejected — intersection of all sources.* Strictly safer, but a command denied while one visible source permits it is very hard to debug. Predictability wins here because the failure mode of confusion is a human disabling protections wholesale.

*Alternative rejected — manifest-only configuration*, which is what an earlier draft assumed. It leaves Smithery, Docker, Claude Code and custom hosts with no configuration story at all.

### Self-protection is code, not file permissions

A non-configurable denied-path set covers the resolved policy file **and its parent directory**, applied to every write-effect command after `realpath`, and not overridable from policy.

Filesystem permissions cannot carry this: the server executes `chmod`, so it can unlock its own policy; and replacing a file requires write permission on the **parent directory**, not on the file, so `mv` bypasses a read-only file without touching its mode. The documented `chmod 444` step remains as an independent second layer — genuinely useful, but not load-bearing.

A policy file that exempts its own path is ignored, because a self-referential exemption is not protection.

### `ask` degrades to `deny` when nothing can prompt

*Alternative rejected — degrading to `allow`*, which would convert the most cautious setting into the least safe one in exactly the environment with the least oversight.

### Git state supplies recoverability, and `git` is therefore constrained

Deletion consults version-control state to report whether the target is genuinely recoverable. The subtle case is an **ignored file inside a repository**: it looks protected by being in a repo and is not.

Because this model relies on `git` as the recovery mechanism, `git` is permitted — but its destructive subcommands are denied (`clean -fdx`, `reset --hard`, `push --force`, `checkout -- .`). Without that, the deletion safeguards have a bypass sitting immediately beside them.

### Suggestion without application

`suggest_policy_config` reads the audit log and emits config in both forms. It cannot apply its own suggestion — the self-protection rule forbids writing the policy file.

*Alternative rejected — a `request_command_permission` tool.* A tool whose purpose is to grant the agent capability it lacks is agent-initiated escalation, which is the same reasoning that made `approve_command` look acceptable. The honest mechanism is elicitation, and no target host supports it yet.

### TypeScript 6.0.3, not 7.x

`@typescript-eslint/parser` declares `typescript: ">=4.8.4 <6.1.0"`, so TypeScript 7 breaks `npm run lint`, and the completion bar requires a green tree without `--no-verify`. `ts-jest`'s `<7` constraint does not apply — it is not a dependency, since Jest runs against compiled output. 6.0.3 takes the major bump while keeping lint working.

### Allowlists, and a default set small enough to prove

Two adversarial review rounds returned 32 blocks and four exploits verified live on the maintainer's machine:

```
git -c alias.pwn='!echo OWNED; id -un' pwn        → arbitrary shell
git --git-dir=<in-root bare repo> pwn             → arbitrary shell
awk 'BEGIN{system("id -un")}'                     → awk supplies its own shell
realpathSync('./CFG.JSON') !== realpath           → case defeats a path-string guard
```

The blocks were not converging: all eight round-2 coherence blocks traced to round-1 fixes, at roughly one new defect per fix. The cause was scope, not care. Every finding belonged to one of three unbounded families — a command doing more than its declared effect, a protected thing reachable by an unanticipated identity, and a confirmation with no trustworthy carrier — and the first family is fatal to a denylist model. `python <script inside a root>` is confined, read-effect, path-clean, and full code execution with every rule satisfied.

So the model inverts. Every command carries an **allowlist** of argument shapes, and a command earns a place in the shipped default set only where a bounded grammar can be stated under which it cannot name another program or script, and cannot reach an unchecked path. That test is the whole rule; the "exec-capable class" it replaced was unprovable — and, as written, vacuous, since only policy-named commands ever reached it.

*Alternative rejected — enumerate the dangerous flags.* That is what rounds 1 and 2 did. A denylist is a list of what someone thought of, and `--git-dir` was not on it.

### `git` keeps its place by controlling the environment, not the flags

`git` is the recovery mechanism and is worth keeping. But its danger is configuration, not any particular flag: aliases, pagers and hooks all execute, and `-c`, `--git-dir`, `--work-tree`, `--exec-path`, `--config-env` and `config --file` all reach them.

The server therefore controls the child environment — neutralising system, global and repository-directory configuration, forcing a non-interactive pager, disabling terminal prompting — and permits only read-only subcommands with allowlisted flags. That closes the family structurally rather than one flag at a time.

### Delete deferred rather than weakened

A delete needs a human to see what will be destroyed. Three candidate carriers, all rejected: an approval queue is the CWE-862 defect under a new name; a `confirm` parameter is one the agent sets itself; and the host's approval prompt renders the tool name and **the arguments the model chose**, so a report returned to the model never reaches a human.

Since `rm` is `FORBIDDEN` in 1.x, shipping no delete is zero regression, and it removes an entire capability plus most of the `.git` protection surface. The spec is preserved at `openspec/deferred/delete-safety-2.1.md`, to revisit when the host supports MCP `elicitation`.

### `elicitation` is the only capability that means a human

Interactivity was to be inferred from declared client capabilities. Of the three MCP offers, `roots` and `elicitation` are absent on the flagship host and `sampling` asserts that **a model** will answer — so inferring interactivity from capabilities generally would route the human gate to another model. Only `elicitation` counts; everything else means `ask` denies.

## Risks / Trade-offs

- **Path detection is heuristic** → fails closed to out-of-scope; documented in `SECURITY.md` as a known limit rather than hidden. Attached flag values (`--output=/etc/x`, `-o/etc/x`) are split and scope-checked, because a value fused to a flag is never "not a flag" and so never reached the heuristic at all.
- **The exec-capable class is a judgement, not a proof** → a command nobody classified as exec-capable, that turns out to be, defeats it. Mitigated by denying the class by default rather than permitting by default, and by stating the limit in `SECURITY.md` instead of implying completeness.
- **TOCTOU between resolution and execution** → the agent can race its own concurrent calls, swapping a symlink between the scope check and the exec. Distinct from the another-process non-goal above. Mitigated by resolving once and executing against the resolved path.
- **Over-prompting degrades into always-allow** — a human who is asked too often will disable the gate → mitigated by making the confined tier genuinely useful (reads and writes inside roots are free) so `ask` is rare in normal work, and by `suggest_policy_config` turning observed usage into config.
- **The policy file is a single point of trust** → self-protection stops *this server* writing it and `chmod 444` raises the bar for everything else, but a separate process running as the same user can still rewrite it. Inherent to file-based config; stated in the specs' non-goals rather than papered over.
- **`ask` is only as strong as the host** — a host set to always-allow converts every `ask` into `allow` → headless deployments degrade to `deny`; a misconfigured interactive host is outside our control and is documented.
- **Breaking change strands existing configurations** → major version, migration notes in README, and the removed tools are named explicitly so failures are legible.
- **`smithery.json` currently advertises the vulnerable tools** → rewritten in this change; left alone it would publish the removed surface as the documented API.

## Migration Plan

1. Ship as `2.0.0`. The removed tools are gone, not deprecated — a tool that exists to be self-approved cannot be safely soft-landed.
2. A fresh install has no roots and refuses everything, with each refusal naming the permitted commands and the configuration location, so the upgrade path is discoverable from the first failure rather than from release notes.
3. Publish to npm **before** the advisories, so users have a fixed version to move to. Four advisories already sit in `triage`, none with a CVE: three independent CWE-78 reports (`hackwither` 2026-01-28, `infosec-traceforce` 2026-07-13, `bebold6133` 2026-08-14) and one CWE-862 report (`Taran-Douley` 2026-08-20). Consolidate the three CWE-78 duplicates into a single advisory crediting all three reporters in order of filing, rather than opening a new one — this review rediscovered CWE-78 independently but was not first to it, and claiming an internal find would mis-credit three external reporters.
4. Rollback is `npm install mac-shell-mcp@1.1.0`, which reinstates both vulnerabilities and is therefore documented as unsupported.

## Open Questions

- The CVSS vector for CWE-78 is not yet fixed. For CWE-862 the reporter scored 8.4 High and notes the MITRE CVE portal rescaled it to 9.3 Critical; that discrepancy is resolved when the advisory is filed. Whether CWE-78 warrants `S:C` (escaping the command allowlist as a scope change) is the same kind of scoring judgment. Neither affects the specs, the approach, or the task breakdown.
