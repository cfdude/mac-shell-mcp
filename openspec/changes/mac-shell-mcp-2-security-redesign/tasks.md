## 1. Pre-apply gates

- [ ] 1.1 Run the release cross-spec review — this change carries 5 spec files (≥2), so dispatch fresh-context reviewers at the whole spec set and ask the six questions (contradiction, double ownership, unmeetable requirements, gaps against the proposal's Capabilities list, vocabulary forks, shared chokepoints); split findings into BLOCKS and POLISH, fix every BLOCK, and verify by recording `record-cross-spec-review mac-shell-mcp-2-security-redesign --verdict pass --reviewer "<identity>"`
- [ ] 1.2 Run Gate 1 spec review on the artifacts (file paths, not a SHA range) via a fresh-context subagent covering WHEN/THEN testability, cross-capability consistency, data-model correctness and task/TDD ordering; fix Critical and Important findings, re-run `openspec validate mac-shell-mcp-2-security-redesign --strict`, and verify by recording `record-gate-review mac-shell-mcp-2-security-redesign --gate 1 --verdict pass`

## 2. Toolchain and dependencies

- [ ] 2.1 Update dependencies to `@modelcontextprotocol/sdk@1.30`, `zod@4`, `eslint@10`, `jest@30`, `@types/node@26`, and `typescript@6.0.3` (NOT 7.x), and verify `npm ci && npm run build && npm run lint && npm test` all pass on the existing suite
- [ ] 2.2 Confirm `npm audit --omit=dev` is clean after the SDK bump and record the residual count, verifying the previously-reported transitive express-transport findings are gone
- [ ] 2.3 Migrate any zod 3 → 4 breaking usages in existing schema code and verify the build and lint pass with no `any` escapes introduced
- [ ] 2.4 Re-run the reachability analysis behind the 42 open Trivy alerts (all on `package-lock.json`, none in `src/`): confirm the server imports only `server/index.js`, `server/stdio.js` and `types.js`, and that `server/stdio.js` references neither `hono` nor `express`; verify by grepping the installed SDK and recording the result
- [ ] 2.5 Add a reviewed `.trivyignore` (or equivalent suppression) covering only CVEs proven unreachable in 2.4, each entry carrying the CVE id, the package, and the one-line reachability justification; verify no reachable CVE is suppressed and that removing an entry makes the alert reappear
- [ ] 2.6 Add a CI guard that fails the build if the server ever imports an HTTP or SSE transport while suppressions are active, so the suppressions cannot silently outlive their justification; verify by adding such an import in a scratch branch and confirming CI fails

## 3. Policy loading (spec: policy-configuration)

- [ ] 3.1 Write failing tests for the discovery order (explicit path → cwd file → home file → host env → built-in defaults), first-match-wins, and no merging; verify they fail for the right reason before implementing
- [ ] 3.2 Implement policy loading with zod validation and verify 3.1's tests pass
- [ ] 3.3 Write failing tests asserting a config file supersedes host env config and that startup names both the winning source and the ignored one; implement, and verify the tests pass
- [ ] 3.4 Implement `ask` → `deny` degradation when no interactive client is present, and verify a test proves it never degrades to `allow` and that the downgrade is reported at startup
- [ ] 3.5 Implement the first-run posture (read-only command set, zero roots) and verify a test asserts every request is refused with a message naming the permitted commands and the configuration location
- [ ] 3.6 Add `.mac-shell-mcp.sample.json` and verify it loads cleanly through the real loader in a test rather than being sample text nothing parses

## 4. Path guard and config self-protection (specs: command-authorization, policy-configuration)

- [ ] 4.1 Write failing tests for path-shape detection covering `grep -r pattern /dir` (only `/dir` is a path), `~` expansion, relative resolution against cwd, and ambiguous arguments failing closed to out-of-scope; verify they fail first
- [ ] 4.2 Implement path-shape detection and verify 4.1's tests pass
- [ ] 4.3 Write failing tests for root confinement covering `realpath` resolution, a symlink inside a root pointing outside it, and segment-aware prefix matching (`/tmp/foo` must not match `/tmp/foobar`); implement, and verify they pass
- [ ] 4.4 Write failing tests for config self-protection — `chmod` against the policy file, `mv`/`cp` **into** it, `rm`/`touch`/`tee` against it, any write against its **parent directory**, a symlink resolving to it, and a policy file attempting to exempt its own path — each denied even when the file sits inside an allowed root and the command is otherwise permitted; verify all fail first
- [ ] 4.5 Implement config self-protection as a non-configurable denied-path set checked after `realpath`, and verify 4.4's tests pass and that reading the policy file is still permitted

## 5. Shell-free execution (spec: command-execution)

- [ ] 5.1 Write the CWE-78 regression test first: execute `echo` with the single argument `hello; id > <sentinel>` and assert the output is that literal string AND the sentinel file is **not** created; verify it fails against the current implementation
- [ ] 5.2 Remove the `shell` option from every `execFile` call site and verify 5.1 passes and no call site passes `shell` (grep the source to confirm zero occurrences)
- [ ] 5.3 Write failing tests asserting a non-zero exit is a normal result — `grep` with no match reports `exitCode: 1`, is not flagged as an error, and preserves stdout — and that a failure to spawn IS flagged as an error; implement, and verify they pass
- [ ] 5.4 Implement an explicit output cap with graceful truncation and verify a test asserts oversized output returns partial content marked truncated with the omitted byte count, rather than throwing
- [ ] 5.5 Return structured content with an output schema carrying stdout, stderr, exit code, truncation and duration, and verify a test asserts no empty text block is emitted when stderr is empty
- [ ] 5.6 Implement `cwd` (validated against roots), `stdin`, and opt-in `expandGlobs` defaulting to false; verify tests assert `find . -name "*.ts"` receives `*.ts` literally when expansion is not requested, and that requested expansion excludes matches outside roots

## 6. Authorization (spec: command-authorization)

- [ ] 6.1 Write failing tests for the effect × scope matrix — read/write inside roots permitted, read/write outside refused, delete handled per delete-safety — and verify they fail first
- [ ] 6.2 Implement effect classification and the scope decision, and verify 6.1's tests pass
- [ ] 6.3 Write failing tests asserting `execute_command` **refuses** rather than reroutes an out-of-scope or delete request, and that the refusal names `execute_external_command`; implement, and verify they pass
- [ ] 6.4 Write failing tests asserting `execute_pipeline` authorizes every stage independently — a permitted read followed by a delete refuses the whole pipeline and executes no stage — then implement in-process stdout→stdin wiring and verify they pass
- [ ] 6.5 Implement per-command argument rules and verify tests assert `find -exec`/`-execdir`/`-ok`/`-okdir`/`-delete`/`-fprintf` are refused, and that `git clean -fdx`, `git reset --hard`, `git push --force`, `git push --force-with-lease` and `git checkout -- .` are refused while other `git` subcommands still run
- [ ] 6.6 Correct `allowedArgs` to set semantics (every argument matches at least one pattern, position-independent) that **rejects** on mismatch rather than downgrading, and verify a test covers `ls -l somefile` being permitted where the old positional logic refused it

## 7. Delete safety (spec: delete-safety)

- [ ] 7.1 Write failing tests asserting deletion is denied by default, denied outside roots regardless of policy, and that `-rf`/`-fr`/`-r -f`/`--recursive --force` and `--no-preserve-root` are refused in every spelling regardless of policy or target; verify they fail first
- [ ] 7.2 Implement the structural delete rules and verify 7.1's tests pass
- [ ] 7.3 Implement the git recoverability ladder over the six states (tracked+clean+pushed, tracked+clean+unpushed, tracked+modified, untracked, ignored, no repository) and verify tests assert each yields its distinct message — especially that an **ignored file inside a repository** is reported unrecoverable
- [ ] 7.4 Implement directory-deletion enumeration (file count, total size, content sample) before confirmation, and verify a test asserts the counts are reported prior to any deletion

## 8. Audit log and suggestion (spec: audit-and-suggestion)

- [ ] 8.1 Implement append-only JSONL recording of every permitted and refused request with the fields the spec names, and verify tests assert prior records are never rewritten and that a refusal records its reason
- [ ] 8.2 Implement the size bound and verify a test asserts the limit is enforced while recording continues
- [ ] 8.3 Implement `suggest_policy_config` emitting both the config-file fragment and the host-extension field value, and verify tests assert it reflects observed counts, grants nothing, and does not write the policy file

## 9. Tool surface (specs: command-authorization, policy-configuration)

- [ ] 9.1 Write a failing test asserting `ListTools` contains none of `add_to_whitelist`, `update_security_level`, `remove_from_whitelist`, `approve_command`, `deny_command`, `get_pending_commands`; verify it fails first
- [ ] 9.2 Remove those six handlers, their schemas, and the pending-approval queue (disposing of the never-timing-out promise and the re-execution path that skipped re-validation), and verify 9.1 passes
- [ ] 9.3 Add MCP annotations to every tool and verify a test asserts `execute_command` reports `readOnlyHint: false` with `openWorldHint: false`, `execute_external_command` reports `destructiveHint: true` with `openWorldHint: true`, and `execute_pipeline` reports `readOnlyHint: true`
- [ ] 9.4 Implement `enabledTools` so an omitted tool is absent from `ListTools`, and verify a test covers it
- [ ] 9.5 Rewrite the existing `tests/command-service.test.js` — it currently asserts `addToWhitelist` works and therefore encodes the vulnerability as intended behavior — and verify the replaced assertions test the new contract
- [ ] 9.6 Fix the server version string in `src/index.ts` to match `package.json` and verify they agree programmatically in a test

## 10. Packaging and distribution

- [ ] 10.1 Author `manifest.json` for MCPB with `user_config` fields for roots (`directory`, `multiple: true`), commands, rm policy, audit log path, output cap and timeout; verify with `mcpb validate manifest.json`
- [ ] 10.2 Set `required: false` on every `user_config` field carrying a default so Claude Desktop auto-enables the connector without manual form entry, and verify by installing the built bundle and confirming it enables with no user interaction
- [ ] 10.3 Build and sign the bundle with `mcpb pack` and `mcpb sign`, and verify with `mcpb verify` and `mcpb info`
- [ ] 10.4 Rewrite `smithery.json`, which currently advertises the six removed tools as the documented API and references `MAC_SHELL_SAFE_MODE` and `MAC_SHELL_APPROVAL_TIMEOUT` that no longer exist; verify no removed tool name remains anywhere in the file
- [ ] 10.5 Update the `Dockerfile` to ship or mount a config file and set `$MAC_SHELL_MCP_CONFIG`, drop the misleading `EXPOSE 3000` (stdio binds no port), and collapse the redundant double `npm ci`; verify the image builds and the server starts with a non-default policy

## 11. Documentation

- [ ] 11.1 Rewrite `SECURITY_REVIEW.md`, whose current "Option 1 (Recommended)" metacharacter blocklist is the wrong fix and whose description of the shell issue as conditional is inaccurate; verify it now documents the shipped model and no longer recommends sanitizing
- [ ] 11.2 Update `README.md` and `SECURITY.md`, both of which describe the approval workflow as a real control; document the copy → edit → `chmod 444` setup flow, and verify no removed tool is still documented as available
- [ ] 11.3 Document the known limits — heuristic path detection, the policy file as a single point of trust, and `ask` being only as strong as the host — and verify each appears in `SECURITY.md`

## 12. Verification and Gate 2

- [ ] 12.1 Run the full suite — `npm run build && npm run lint && npm run format:check && npm test` — and verify every check passes with zero failures, including tests not written as part of this change
- [ ] 12.2 Re-run every verified exploit from the design as a regression: the injection PoC sentinel, forbidden-command promotion, out-of-scope refusal, pipeline stage-2 denial, symlink escape, `find -exec`, `git clean -fdx`, `rm -rf`, the ignored-file warning, `grep` exit 1, and output truncation; verify all pass
- [ ] 12.3 Perform the call-site completeness sweep: for every guard this change introduces, enumerate ALL call sites mechanically with `rg` (never from memory), state where the guard holds and where it does not, and justify each omission — a guard applied at one call site while an identical sibling is left untouched is a finding, not a detail
- [ ] 12.4 Verify against the commits, not the working tree: for every task, run `git show --stat <that task's sha>` and assert each file the task claims to change appears in THAT commit; a task whose file is absent from its commit fails even if the working tree holds the edit
- [ ] 12.5 Run Gate 2 implementation review on the committed `BASE..HEAD` diff via a fresh-context subagent covering spec alignment, real tests passing, error and edge handling, and security; fix Critical and Important findings, then verify by recording `record-gate-review mac-shell-mcp-2-security-redesign --gate 2 --verdict pass --base-sha <base> --head-sha <head>`

## 13. Release and disclosure

- [ ] 13.1 Bump to `2.0.0`, update `CHANGELOG.md` naming every removed tool as breaking, and verify `npm pack --dry-run` ships `build/` plus the sample config and no stray files
- [ ] 13.2 Publish `2.0.0` to npm **before** any advisory is public, and verify the published version installs and starts cleanly from a clean directory
- [ ] 13.3 Draft two private GHSA advisories — CWE-862 crediting Taran / Shroud Labs, CWE-78 as an internal find — each naming `2.0.0` fixed and `<= 1.1.0` affected; share the CWE-862 draft with the reporter for review, and verify both are drafted privately with CVEs requested and neither is published before 13.2 completes
- [ ] 13.4 Publish both advisories and comment on issue #14 linking them, and verify the issue reflects the fixed version

## 14. Close out

- [ ] 14.1 Attribute every commit made during this change to the epic with `update-epic mac-shell-mcp-2-security-redesign --attribute-commit <sha>` at the moment each is made, and verify the recorded list matches `git log` for the range — excluding the archive commit itself, which must NOT be attributed
- [ ] 14.2 <!-- pm:lifecycle --> Archive the change with `/opsx:archive mac-shell-mcp-2-security-redesign`, then record the epic disposition with `update-epic mac-shell-mcp-2-security-redesign --status archived --outcome delivered --no-deferrals` (or name each deferral), and verify the archive gate accepts it — which requires the Gate 2 pass from 12.5 to be recorded and non-stale
