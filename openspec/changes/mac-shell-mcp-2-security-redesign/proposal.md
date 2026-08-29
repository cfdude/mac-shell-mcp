## Why

Two verified vulnerabilities make the current security model decorative rather than real.

**CWE-862 (reported as [#14](https://github.com/cfdude/mac-shell-mcp/issues/14), Taran / Shroud Labs, 8.4 High):** the approval workflow is self-serve. The agent holds `execute_command`, `get_pending_commands` and `approve_command`, so it approves its own requests with no human involved. Worse, `addToWhitelist` is a plain `Map.set` that overwrites `FORBIDDEN` entries — `add_to_whitelist("bash","safe")` followed by `execute_command("bash",["-c",…])` is unrestricted code execution.

**CWE-78 (independently reported three times before this review — see below):** `execFile` is called with `shell: this.shell`, which is always `/bin/zsh` and therefore always truthy. Every command runs through a shell with arguments concatenated rather than escaped. Verified live — `echo` with the argument `hello; id > /tmp/PWNED.txt` executed `id` and wrote the file. Any whitelisted command yields arbitrary code execution.

Underneath both sits a design error: a static command-name allowlist cannot express the real risk. `grep` is nominally read-only and `grep -r AKIA ~/.aws` exfiltrates credentials, while `mkdir ./build` is nominally destructive and harmless. The command name does not predict blast radius.

**Three separate reporters filed CWE-78 before this review began**, and all three advisories are still in `triage` with no CVE:

| Advisory | Reporter | Filed | Age |
|---|---|---|---|
| `GHSA-2h3j-235x-vx2q` | `hackwither` | 2026-01-28 | **211 days** |
| `GHSA-8qwq-gwp3-g5h7` | `infosec-traceforce` | 2026-07-13 | 46 days |
| `GHSA-h926-3g54-mr3v` | `bebold6133` | 2026-08-14 | 14 days |

This review rediscovered the same defect independently, but it did not find it first and must not be credited as such. `GHSA-q7hh-g47q-hwqj` (`Taran-Douley`, 2026-08-20) carries the CWE-862 advisory draft.

This is a published npm package with a `bin`, so existing installs are exposed until a fixed version ships — and the oldest report has been outstanding for seven months.

## What Changes

- **BREAKING** — remove **seven** tools: `add_to_whitelist`, `update_security_level`, `remove_from_whitelist`, `approve_command`, `deny_command`, `get_pending_commands`, and `get_whitelist` (superseded by `get_policy`, which reports a policy object the old tool's shape no longer describes). No MCP tool mutates policy; these are absent, not gated. This also disposes of a promise in `queueCommandForApproval` that never times out, and an `approveCommand` path that re-executes without re-validating.
- **BREAKING** — `execFile` is never called with the `shell` option. Argument content stops being dangerous once argv reaches `execve` unmodified, so no metacharacter sanitizing is added (and the blocklist recommended by the current on-disk `SECURITY_REVIEW.md` is explicitly rejected — it breaks `My File (2).txt` and every glob while remaining evadable).
- **BREAKING** — authorization admits only commands with a **bounded argument allowlist**, and authorizes the **program** as well as the arguments: resolved to an absolute path, matched by that path rather than basename, drawn only from configured program directories, and refused if it resolves inside a root. Denylists are abandoned — two review rounds defeated them with `git -c alias`, `git --git-dir`, and `awk system()`, each verified executing arbitrary shell.
- **BREAKING** — tools split by confinement so a host's never/always/ask setting is meaningful: `execute_command` (inside roots) and `execute_external_command` (outside roots, or deleting), plus `execute_pipeline`, `get_policy`, `suggest_policy_config`. All carry MCP tool annotations, currently unset.
- Canonical **config file** with a documented discovery order, superseding the MCPB manifest as the configuration model so Smithery, Docker, Claude Code and custom hosts are configurable at all.
- **Hard-coded self-protection**: the server cannot modify its own config file or that file's parent directory, non-overridable from config.
- **No delete capability in 2.0.** `rm` is `FORBIDDEN` in 1.x, so this is zero regression. The git-aware recoverability ladder is written and deferred to `openspec/deferred/delete-safety-2.1.md`: a delete needs a human to see what will be destroyed, and MCP offers no channel that carries that report to a human today — the host's prompt renders only the tool name and the arguments the *model* chose.
- **Audit log** and `suggest_policy_config`, which reads it and proposes config the human applies.
- Result correctness: exit codes preserved (a `grep` no-match currently surfaces as a crash), explicit output cap with graceful truncation, structured output, plus `cwd`, `stdin` and opt-in glob expansion.
- Dependency updates including `@modelcontextprotocol/sdk` 1.30, `zod` 4, `eslint` 10, `jest` 30. TypeScript goes to **6.0.3, not 7.x** — verified that `@typescript-eslint/parser` declares `typescript: ">=4.8.4 <6.1.0"`, so 7 breaks lint.
- MCPB manifest + signed bundle, and rewrites of `smithery.json` (which currently advertises the removed vulnerable tools as the documented API) and `Dockerfile`.

## Capabilities

### New Capabilities

- `command-authorization`: program authorization (resolved path, program directories, no programs inside roots), bounded per-command **argument allowlists**, the effect × scope decision for confined tools, the external tool as the sole out-of-root route, an enumerated default command set that excludes `find`, `git` and every interpreter, a child environment constructed from an allowlist rather than inherited, path-shape detection and root confinement, and the tool annotations.
- `command-execution`: shell-free execution, structured results carrying exit codes, output caps and truncation, `cwd`/`stdin`/opt-in globs, and in-process pipelines.
- `policy-configuration`: config discovery order and precedence, schema, config self-protection, `ask`→`deny` degradation without an interactive client, first-run posture, and the MCPB `user_config` mapping.
- `audit-and-suggestion`: the append-only audit log and `suggest_policy_config`.

### Modified Capabilities

None — `openspec/specs/` is empty; this is the repository's first spec set.

## Impact

- **Code:** `src/index.ts` (tool surface, annotations, structured output) and `src/services/command-service.ts` (execution, validation) are substantially rewritten. New modules: `policy.ts`, `path-guard.ts`, `git-context.ts`, `audit-log.ts`.
- **Tests:** `tests/command-service.test.js` currently *asserts `addToWhitelist` works* — it encodes the vulnerability as intended behavior and changes meaning here.
- **Public API:** breaking. Ships as `2.0.0`.
- **Packaging/docs:** `smithery.json`, `Dockerfile`, `manifest.json` (new), `.mac-shell-mcp.sample.json` (new), `README.md`, `SECURITY.md`, `SECURITY_REVIEW.md` (whose current recommendation is wrong).
- **Disclosure:** four advisories already exist in `triage`. Consolidate the three CWE-78 duplicates into one crediting all three reporters, keep the CWE-862 advisory crediting `Taran-Douley`, and publish only after `2.0.0` is on npm so existing users are not 0-dayed.
- **Authoritative design:** `docs/superpowers/specs/2026-08-13-mac-shell-mcp-2.0-security-redesign.md`.
