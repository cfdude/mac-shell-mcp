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

## 5. Draft — direct contact (step D)

> Subject: mac-shell-mcp on npm — attribution and maintenance
>
> Hello,
>
> I'm the author of `mac-shell-mcp` at github.com/cfdude/mac-shell-mcp, first committed 2025-03-12.
> The npm package `mac-shell-mcp@1.0.4` that you published on 2025-04-12 contains that project's
> code and a byte-identical copy of its README.
>
> The project is MIT licensed, so redistribution is welcome — but MIT requires that the copyright and
> permission notice travel with the code. The published tarball has no LICENSE file, and the
> `author`, `repository`, `homepage`, and `bugs` fields have been removed while `"license": "MIT"` is
> retained.
>
> There is also a security problem. That version contains two vulnerabilities now recorded as
> advisories on the repository, and because I'm not a maintainer of the npm package I can't publish a
> fix or deprecate it. Anyone installing it today gets vulnerable code with no upgrade path.
>
> Could you either transfer the package name to me, or unpublish/deprecate it and point users at the
> repository? I'd much rather resolve this directly than through npm support.
>
> Thanks,
> Rob Sherman — security@onvex.ai

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
> I attempted direct contact with the publisher on <DATE> before filing.

## 7. Before filing

- [ ] Send §5 and wait three business days (the disputes policy expects a good-faith attempt)
- [ ] Fill `<DATE>` in §6 with the date §5 was actually sent
- [ ] Publish `@cfdude/mac-shell-mcp@2.0.0` (step E) so a fixed version exists to point users to
- [ ] Keep a local copy of `mac-shell-mcp-1.0.4.tgz` as evidence — an unpublish would remove it
