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

## Risks / Trade-offs

- **Path detection is heuristic** → fails closed to out-of-scope; documented in `SECURITY.md` as a known limit rather than hidden.
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
