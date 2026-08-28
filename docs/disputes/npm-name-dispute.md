# npm package dispute — `mac-shell-mcp`

**Prepared:** 2026-08-28 · **Status:** ready to file · **Owner:** Rob Sherman

> Not legal advice. Facts below were verified directly against the npm registry tarball and this
> repository's git history; each is reproducible with the commands shown.

---

## 1. Summary

The npm package `mac-shell-mcp` is not published by, and is not under the control of, this project.
It contains this repository's source and documentation with the author, repository, homepage, and
bug-tracker fields removed and no license text included, and it ships two known-vulnerable code
paths that the original author has no ability to fix.

| | This repository | npm `mac-shell-mcp@1.0.4` |
|---|---|---|
| Author | Rob Sherman | *(blank)* |
| `repository` | `github.com/cfdude/mac-shell-mcp` | *(absent)* |
| `homepage` / `bugs` | present | *(absent)* |
| LICENSE file | MIT, present | **not shipped** |
| First commit / publish | **2025-03-12** | 2025-04-12 |
| Publisher | — | `jensshum <jensshum@gmail.com>` |
| Versions published | — | `1.0.4` only, never updated |

## 1a. Scope — this dispute targets ONE package, not both

A second npm package also redistributes this project: `@iflow-mcp/mac-shell-mcp@1.1.0`, published
2025-11-19 by `chatflowdev` / `qystart`, part of a scope mirroring roughly twenty MCP servers.
**It is MIT-compliant and is NOT part of this dispute.**

| | `mac-shell-mcp` (`jensshum`) | `@iflow-mcp/mac-shell-mcp` |
|---|---|---|
| LICENSE file | ✗ omitted | ✓ included |
| `author` | ✗ blank | ✓ `Rob Sherman` |
| `repository` / `homepage` / `bugs` | ✗ removed | ✓ point to this repo |
| Name | bare — occupies the project's own name | scoped — no name conflict |
| **Verdict** | **MIT violation** | **compliant redistribution** |

MIT permits exactly what `@iflow-mcp` did: redistribute, keeping the notice and attribution. They
require no action beyond a courtesy notice.

**Both ship the vulnerable code**, however — `@iflow-mcp/mac-shell-mcp@1.1.0` carries the same two
sinks at lines 262 and 309. So there are two npm distribution channels for the vulnerable version
and this project controls neither. That is a disclosure-coordination problem for `@iflow-mcp`, and a
legal one only for the unscoped package.

## 2. Evidence

**The published README is byte-identical to this repository's README as it stood one month before
the package was published.**

```bash
npm pack mac-shell-mcp                     # 1.0.4, published 2025-04-12
git show 67bc6f3:README.md > repo.md       # this repo, committed 2025-03-12
diff repo.md package/README.md             # no differences — 346/346 lines
```

The compiled JavaScript likewise retains this project's distinctive strings, including
`Command not whitelisted`, `queueCommandForApproval`, `No pending command with ID`,
`Change file mode bits`, and the `command:pending` event name.

**Priority is unambiguous.** First commit `47d36fe` is dated 2025-03-12; the GitHub repository was
created 2025-03-13; the npm package was first published 2025-04-12, roughly one month later.

## 3. Grounds

1. **License non-compliance.** The work is MIT licensed. MIT permits redistribution but requires
   that the copyright notice and permission notice be included in all copies. The published tarball
   contains no `LICENSE` file and no attribution: `author` is empty and `repository`, `homepage`,
   and `bugs` have been removed, while `"license": "MIT"` is retained — asserting the license while
   omitting the notice it requires.
2. **Package-name confusion.** The package name, description, and README are those of this project,
   so users installing `mac-shell-mcp` reasonably believe they are installing this project's
   software. The repository is the only public home for this code (24 stars, 15 forks).
3. **Unremediable security exposure.** The published artifact contains both vulnerabilities recorded
   in this repository's security advisories, at lines 262 and 308 of
   `build/services/command-service.js`. It has not been updated since 2025-04-12 and only ever had
   one version. Because the original author is not a maintainer, **there is no route by which the
   published package can be patched or deprecated by the people who can fix it.** Users are exposed
   with no upgrade path.

## 4. Actions to file, in parallel

| # | Action | Route | Purpose |
|---|---|---|---|
| A | Package name dispute | npm support, per the [npm disputes policy](https://docs.npmjs.com/policies/disputes) | Transfer or release the name |
| B | Copyright / license complaint | npm DMCA process | Attribution stripped, license text omitted |
| C | Security escalation | npm security | Unmaintained package shipping known-vulnerable code with no maintainer able to fix it |
| D | Direct contact | `jensshum@gmail.com` | The disputes policy expects a good-faith attempt first; give three business days |
| E | Ship under a scoped name | `@cfdude/mac-shell-mcp` | Unblocks the 2.0.0 release regardless of how A–D resolve |

**Do E now.** It is the only step fully under this project's control, and the 2.0.0 release should
not be gated on a dispute outcome. A previous informal dispute attempt did not progress; the
material difference this time is the byte-identical README evidence, the license-text omission, and
the unremediable-vulnerability angle.

## 5. Direct contact (step D) — FINAL, send-ready

**To:** `jensshum@gmail.com` · **From:** `rsherman@onvex.ai` · **Cc:** `security@onvex.ai`
**Subject:** mac-shell-mcp on npm — attribution, and a security issue I can't fix
**Status:** ✅ **SENT 2026-08-28** from `rsherman@velocityinteractive.com` (Gmail message id `1a04ac76d8e3f3c8`), cc `security@onvex.ai`.
**Escalate if no reply by Thursday 2026-09-03** — three business days (Mon 8/31, Tue 9/1, Wed 9/2).

```
Hello,

I'm the author of mac-shell-mcp (github.com/cfdude/mac-shell-mcp), first committed on
2025-03-12. The npm package `mac-shell-mcp@1.0.4` that you published on 2025-04-12 contains
that project's code, and its README is a byte-identical copy of mine as it stood at the time
— 346 of 346 lines.

I want to start by saying I'm not looking for a fight, and redistribution itself is fine by
me. The project is MIT licensed precisely so people can use and republish it.

There are two things I'd like to sort out.

**Attribution.** MIT permits redistribution, but it asks that the copyright and permission
notice travel with the code. The published tarball has no LICENSE file, and the `author`,
`repository`, `homepage`, and `bugs` fields have been removed from package.json, while
`"license": "MIT"` is still declared. The practical effect is that someone installing it has
no way to find the project, report a bug, or know who wrote it.

**Security — this is the part I actually care about.** Version 1.0.4 contains two
vulnerabilities that are now filed as security advisories on my repository. One allows
arbitrary command execution that bypasses the tool's own safety model. They were reported to
me by four independent security researchers, and I'm currently shipping a 2.0.0 that fixes
them.

The problem is that I'm not a maintainer of your npm package, so I can't publish a fix or
mark it deprecated. Anyone running `npm install mac-shell-mcp` today gets vulnerable code
with no upgrade path, and I have no way to reach them. That's what I'd most like to solve.

Any one of these would work for me, in order of preference:

1. Transfer the package name to me (npm account: cfdude), and I'll publish the fixed 2.0.0
   under it.
2. Unpublish 1.0.4.
3. Deprecate 1.0.4 with a message pointing at github.com/cfdude/mac-shell-mcp, so at least
   people are warned.

If it's easier, I'm happy to walk through the npm transfer process with you — it's a couple
of commands on your end.

For what it's worth, another group (@iflow-mcp) also republished this project, and they kept
the LICENSE and the attribution intact. That's the shape I'd have been glad to see here, and
it's genuinely all I'm asking for.

I'd much rather resolve this directly than go through npm support, so I wanted to reach out
first. Happy to talk it through if any of this is unclear or if I've misread the situation.

Thanks,

Rob Sherman
security@onvex.ai
github.com/cfdude
```

## 6. Draft — npm support (steps A–C)

> **Package:** `mac-shell-mcp` · **Publisher:** `jensshum` · **Version:** 1.0.4 (2025-04-12)
> **Claimant:** Rob Sherman, github.com/cfdude — author of github.com/cfdude/mac-shell-mcp
>
> I am the author of the software published under this package name. I am not a maintainer of the
> package and did not publish it.
>
> **Priority.** The source was first committed to my repository on 2025-03-12 (commit `47d36fe`);
> the repository was created 2025-03-13. The package was first published 2025-04-12.
>
> **Identity of the work.** The published README is byte-identical to my repository's README as of
> 2025-03-12 (commit `67bc6f3`) — 346 of 346 lines. The compiled output retains distinctive strings
> from my source, including `Command not whitelisted`, `queueCommandForApproval`, and
> `No pending command with ID`. Reproducible with `npm pack mac-shell-mcp` and
> `git show 67bc6f3:README.md`.
>
> **License non-compliance.** The work is MIT licensed. The published tarball ships no LICENSE file
> and no attribution — `author` is empty, and `repository`, `homepage`, and `bugs` have been removed
> — while still declaring `"license": "MIT"`. That omits the notice the license requires.
>
> **Unremediable security exposure.** The published artifact contains two vulnerabilities recorded as
> security advisories on my repository, at lines 262 and 308 of
> `build/services/command-service.js`. The package has had one version since 2025-04-12. Because I am
> not a maintainer, no one able to fix it can publish a patch or mark it deprecated, so users have no
> upgrade path. This is my primary concern.
>
> **Requested:** transfer of the package name, or unpublication. Failing either, please deprecate
> 1.0.4 with a pointer to github.com/cfdude/mac-shell-mcp so users are warned.
>
> I attempted direct contact with the publisher on 2026-08-28 before filing, and received no response.

## 7. Before filing

- [x] Send §5 — sent 2026-08-28; wait three business days per the disputes policy
- [x] Fill `<DATE>` in §6 — set to 2026-08-28
- [ ] Publish `@cfdude/mac-shell-mcp@2.0.0` (step E) so a fixed version exists to point users to
- [ ] Keep a local copy of `mac-shell-mcp-1.0.4.tgz` as evidence — an unpublish would remove it
- [ ] Separately, notify `@iflow-mcp` (`chatflowdev@gmail.com`) when 2.0.0 ships so their mirror can
      be updated — a courtesy to a compliant redistributor, not a dispute
