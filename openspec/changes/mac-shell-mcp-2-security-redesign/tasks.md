## 1. Pre-apply gates

- [ ] 1.1 Run the release cross-spec review — this change carries 5 spec files (≥2), so dispatch fresh-context reviewers at the whole spec set and ask the six questions (contradiction, double ownership, unmeetable requirements, gaps against the proposal's Capabilities list, vocabulary forks, shared chokepoints); split findings into BLOCKS and POLISH, fix every BLOCK, and verify by recording `record-cross-spec-review mac-shell-mcp-2-security-redesign --verdict pass --reviewer "<identity>"`
- [ ] 1.2 Run Gate 1 spec review on the artifacts (file paths, not a SHA range) via a fresh-context subagent covering WHEN/THEN testability, cross-capability consistency, data-model correctness and task/TDD ordering; fix Critical and Important findings, re-run `openspec validate mac-shell-mcp-2-security-redesign --strict`, and verify by recording `record-gate-review mac-shell-mcp-2-security-redesign --gate 1 --verdict pass`

## 2. Toolchain and dependencies

- [ ] 2.1 Update dependencies to `@modelcontextprotocol/sdk@1.30`, `zod@4`, `eslint@10`, `jest@30`, `@types/node@26`, and `typescript@6.0.3` (NOT 7.x), and verify `npm ci && npm run build && npm run lint && npm test` all pass on the existing suite
- [ ] 2.2 Confirm `npm audit --omit=dev` is clean after the SDK bump and record the residual count, verifying the previously-reported transitive express-transport findings are gone. Baseline as of 2026-08-28, after merging PRs #15-#18 dropped alerts from 56 to **18**: 13 are development-scope (`js-yaml`, `minimatch`, `brace-expansion`, `picomatch`, `flatted`, `@babel/core`) reaching the tree only through jest/eslint and excluded from the published tarball by `files: ["build"]` (verified: `npm pack --dry-run` ships 9 files, 14.2 kB, `build/` only); the other 5 are runtime-scope express-stack (`path-to-regexp`, `qs`, `body-parser`) behind transports this server never imports. Expect the jest 30 / eslint 10 upgrades to clear the development set and the SDK 1.30 bump to clear the runtime set
- [ ] 2.3 Migrate any zod 3 → 4 breaking usages in existing schema code and verify the build and lint pass with no `any` escapes introduced
- [ ] 2.4 Re-run the reachability analysis across BOTH scanners — 42 Trivy alerts and 56 Dependabot alerts (19 high, 33 medium, 4 low) once the dependency graph was enabled 2026-08-28. Roughly 41 are runtime, every one in the SDK's HTTP-transport stack (`hono`, `@hono/node-server`, `fast-uri`, `qs`, `path-to-regexp`, `ip-address`, `body-parser`, `express-rate-limit`); the remaining ~15 are development-scope toolchain packages that `files: ["build"]` never ships. Confirm the server imports only `server/index.js`, `server/stdio.js` and `types.js`, and that `server/stdio.js` references neither `hono` nor `express`; verify by grepping the installed SDK and recording the result
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
- [ ] 9.5a Fix the suite's **single-use bug**, proven deterministically 2026-08-28: `should queue command requiring approval` runs `mkdir test-dir` but cleans up with `rmdir`, which is not in the whitelist, so cleanup throws, the `try/catch` swallows it, and `test-dir/` persists. Run 1 on a clean tree passes 8/8; runs 2 and 3 fail with zero code changes. CI never caught it because every CI run is a fresh checkout. Fix by giving each test a unique temporary directory outside the repo and cleaning up through the filesystem API rather than a whitelisted command; verify by running the suite three times consecutively and getting identical passes
- [ ] 9.5b Add `test-dir/` to `.gitignore` and delete any stray copy, so a poisoned local tree cannot silently persist between runs; verify `git status` is clean immediately after a test run
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

- [ ] 12.1 Run the full suite — `npm run build && npm run lint && npm run format:check && npm test` — and verify every check passes with zero failures, including tests not written as part of this change. Run the suite **three times consecutively** and require identical results, since the pre-existing single-use bug (9.5a) proved a single green run does not establish a green suite
- [ ] 12.2 Re-run every verified exploit from the design as a regression: the injection PoC sentinel, forbidden-command promotion, out-of-scope refusal, pipeline stage-2 denial, symlink escape, `find -exec`, `git clean -fdx`, `rm -rf`, the ignored-file warning, `grep` exit 1, and output truncation; verify all pass
- [ ] 12.3 Perform the call-site completeness sweep: for every guard this change introduces, enumerate ALL call sites mechanically with `rg` (never from memory), state where the guard holds and where it does not, and justify each omission — a guard applied at one call site while an identical sibling is left untouched is a finding, not a detail
- [ ] 12.4 Verify against the commits, not the working tree: for every task, run `git show --stat <that task's sha>` and assert each file the task claims to change appears in THAT commit; a task whose file is absent from its commit fails even if the working tree holds the edit
- [ ] 12.5 Run Gate 2 implementation review on the committed `BASE..HEAD` diff via a fresh-context subagent covering spec alignment, real tests passing, error and edge handling, and security; fix Critical and Important findings, then verify by recording `record-gate-review mac-shell-mcp-2-security-redesign --gate 2 --verdict pass --base-sha <base> --head-sha <head>`

## 13. Release and disclosure

- [ ] 13.1 Bump to `2.0.0`, update `CHANGELOG.md` naming every removed tool as breaking, and verify `npm pack --dry-run` ships `build/` plus the sample config and no stray files
- [ ] 13.2 Resolve the npm distribution blocker BEFORE publishing: the name `mac-shell-mcp` on npm is **not this project** — it is `1.0.4` published 2025-04-12 by `jensshum`, containing this repo's code and README with `author`/`repository`/`homepage`/`bugs` stripped, no LICENSE file, and both vulnerable sinks intact. Decide between claiming the name via npm's dispute process and publishing as `@cfdude/mac-shell-mcp`; verify by confirming `npm owner ls` lists the intended owner for whichever name is chosen
- [ ] 13.2a Publish `2.0.0` under the resolved name **before** any advisory is public, and verify the published version installs and starts cleanly from a clean directory
- [ ] 13.2b Send the direct-contact message. **The 2026-08-28 attempt is NOT confirmed delivered** — Gmail id `1a04ac76d8e3f3c8` is in Trash, absent from Sent, and matches neither its own `from:` nor `to:` search; no bounce was generated. Diagnose why before re-sending, then verify the message appears in Sent and only then start the three-business-day clock
- [ ] 13.2c File the npm dispute, DMCA, and security escalation (§6) covering license non-compliance, name confusion, and the unremediable vulnerability exposure; verify by recording the npm support ticket reference
- [ ] 13.2d Request deprecation of `mac-shell-mcp@1.0.4` pointing at this repository, as the fallback if neither transfer nor unpublication is granted; verify the deprecation notice appears on `npm view mac-shell-mcp`
- [ ] 13.3 Triage the four existing advisories, none of which has been triaged or assigned a CVE: consolidate the three duplicate CWE-78 reports (`GHSA-2h3j-235x-vx2q`/`hackwither` filed 2026-01-28, `GHSA-8qwq-gwp3-g5h7`/`infosec-traceforce`, `GHSA-h926-3g54-mr3v`/`bebold6133`) into ONE advisory crediting all three reporters in filing order, and close the other two as duplicates naming the survivor; verify no reporter loses credit and that this review is NOT credited with finding CWE-78
- [ ] 13.4 Finalize `GHSA-q7hh-g47q-hwqj` (CWE-862, `Taran-Douley`) from the reporter's supplied draft text, resolving the CVSS discrepancy between their 8.4 High and the 9.3 Critical the MITRE portal produced; verify the published score and vector agree with the description
- [ ] 13.5 Set affected `<= 1.1.0` and fixed `2.0.0` on both surviving advisories and request CVEs, and verify neither is published before 13.2 confirms `2.0.0` installs from npm
- [ ] 13.6 Publish both advisories and comment on issue #14 linking them, and verify the issue reflects the fixed version
- [ ] 13.6a Notify `@iflow-mcp` (`chatflowdev@gmail.com`) that `@iflow-mcp/mac-shell-mcp@1.1.0` ships the advisory-tracked vulnerabilities, so their mirror can be updated — they are an MIT-compliant redistributor, so this is coordination and not a dispute; verify the notice is sent once 2.0.0 is published
- [ ] 13.7 Reply to each of the three CWE-78 reporters on their advisory, acknowledging the delay — the oldest went 211 days without triage — and naming the fixed version; verify each advisory carries a maintainer response

## 14. Close out

- [ ] 14.1 Attribute every commit made during this change to the epic with `update-epic mac-shell-mcp-2-security-redesign --attribute-commit <sha>` at the moment each is made, and verify the recorded list matches `git log` for the range — excluding the archive commit itself, which must NOT be attributed
- [ ] 14.2 <!-- pm:lifecycle --> Archive the change with `/opsx:archive mac-shell-mcp-2-security-redesign`, then record the epic disposition with `update-epic mac-shell-mcp-2-security-redesign --status archived --outcome delivered --no-deferrals` (or name each deferral), and verify the archive gate accepts it — which requires the Gate 2 pass from 12.5 to be recorded and non-stale

## 15. Repository and disclosure-channel remediation

- [x] 15.1 Replace the vulnerability reporting contact at `SECURITY.md:15`, previously the unconfigured template placeholder `[security@your-email.com]` — the documented channel for four advisories that went untriaged, the oldest for 211 days. Done ahead of the build as a minimal detour (`be9c2ea`): now GitHub private vulnerability reporting plus `security@onvex.ai`
- [x] 15.1a Enable GitHub private vulnerability reporting — done 2026-08-28, verified `{"enabled":true}` via `repos/cfdude/mac-shell-mcp/private-vulnerability-reporting`
- [ ] 15.1b Verify `security@onvex.ai` actually delivers by sending a test report and confirming receipt, since an alias that silently drops mail reproduces the original failure
- [ ] 15.1c Confirm where private vulnerability reports actually land: GitHub routes them to repository admins' GitHub notification settings, NOT to the address in `SECURITY.md`. Verify the GitHub account's notification email is monitored, or add and verify `security@onvex.ai` on the account so both routes reach the same inbox
- [ ] 15.2 Triage the four open advisories and enable notifications so the queue is not silently ignored again; verify by confirming each advisory has a maintainer response
- [ ] 15.3 Finish correcting the false security claims. `SECURITY.md` and `README.md` were corrected in `be9c2ea`; `smithery.json` still describes "secure command whitelisting and approval mechanisms" and must be fixed with the rest of that file in 10.4. Verify no shipped file asserts a guarantee the code does not provide
- [ ] 15.4 Repair the permanently-red `security` job at `.github/workflows/ci.yml:60-67` — `npm audit --production` has failed on every commit since roughly mid-March, so no CI failure has been visible for months; wire it to the documented suppressions from 2.5 and verify CI goes green and a genuine new vulnerability still fails it
- [ ] 15.5 SHA-pin the reusable workflow references at `.github/workflows/security.yml:13,19`, currently `cfdude/.github/...@main` — a moving ref running with `security-events: write`; verify both are pinned to full commit SHAs, matching the pinning `ci.yml` already applies to its actions
- [x] 15.6 Enable the dependency graph and Dependabot security updates — done 2026-08-28, verified `dependabot_security_updates: enabled` and `vulnerability-alerts` returning 204
- [ ] 15.6a Enable branch protection on `main` — still absent: no required review, no required status checks, force-push unrestricted; verify by re-querying the branch protection endpoint
- [ ] 15.6b Add `.github/dependabot.yml` so update cadence and grouping are declared in-repo rather than left to defaults, and verify Dependabot opens grouped PRs rather than one per advisory across 56 alerts
- [ ] 15.7 Update `SECURITY.md:6-7`, whose Supported Versions table lists only `1.0.x` while the package is at `1.1.0`, to state supported versions as of `2.0.0`; verify the table matches the shipped version
- [ ] 15.8 Fix or remove `examples/client-example.js:3,11`, which imports `ChildProcessClientTransport` from `@modelcontextprotocol/sdk/client/child-process.js` — an export that does not exist, so the example cannot ever have run; verify the example executes against the shipped server or is deleted
- [ ] 15.9 Reconcile version drift — `smithery.json:7` says `1.0.4` while `package.json` says `1.1.0`, and `CHANGELOG.md` has been frozen at 1.1.0/2025-01-25 across roughly twenty commits; verify all three agree at `2.0.0` and the changelog covers the interim work
- [ ] 15.10 Respond to the neglected public issues: `#1` open 16 months unanswered, and `#13` (a security report from the `#14` reporter) closed same-day with no maintainer comment; verify each carries a maintainer reply and that `#13`'s relationship to `#14` is stated for the record
