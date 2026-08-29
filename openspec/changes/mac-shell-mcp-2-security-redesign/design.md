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

### Protect by filesystem identity, and protect every discovery location

Path-string comparison fails three ways, two verified on this machine:

- **Case.** `realpathSync('./CFG.JSON')` returns the caller's casing on APFS; only `realpathSync.native` case-corrects. A string-compared denied set is bypassed by `~/.MAC-SHELL-MCP.JSON`.
- **Hard links.** `ln <config> <root>/cfg` makes the config reachable at an unprotected path, and writing through the link truncates the original inode.
- **Shadowing.** Protection covering only the *active* policy file lets the agent write a config into a working directory, which — being higher in the discovery order — wins outright on the next start. That is CWE-862 deferred by one restart.

Protection therefore compares `(st_dev, st_ino)` captured at startup and also matches by path, covers **every** path in the discovery order plus their ancestors, the program directories, and the whole audit log directory, and refuses link creation where either operand resolves to a protected location.

Crucially it is judged by **the operation a request performs, not the command's declared effect**. An earlier draft keyed on "write-effect command", which `find -fprintf` — declared `read`, and an arbitrary-content write — walked straight through.

A change in which source supplies policy is reported at startup and not adopted unattended.

### `elicitation` is the only capability that means a human

Interactivity was to be inferred from declared client capabilities. Of the three MCP offers, `roots` and `elicitation` are absent on the flagship host and `sampling` asserts that **a model** will answer — so inferring interactivity from capabilities generally would route the human gate to another model. Only `elicitation` counts; everything else means `ask` denies.

## Risks / Trade-offs

- **Path detection is heuristic** → fails closed to out-of-scope; documented in `SECURITY.md` as a known limit rather than hidden. Attached flag values (`--output=/etc/x`, `-o/etc/x`) are split and scope-checked, because a value fused to a flag is never "not a flag" and so never reached the heuristic at all.
- **The admission test is a judgement, not a proof** → a default-set command with a facility nobody noticed defeats it, exactly as `find -fprintf` did. Mitigated by keeping the default set small enough to audit by hand, constructing the child environment rather than inheriting it, keying protection on operations rather than labels, and stating the limit in `SECURITY.md` rather than implying completeness.
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
