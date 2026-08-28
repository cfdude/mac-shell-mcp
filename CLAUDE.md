# CLAUDE.md

<!-- BEGIN pm-conductor rules (managed by pm — safe to delete this block) -->
## PM Conductor — operating rules

This repo is managed by the `pm` plugin. The conductor sits ABOVE OpenSpec and Superpowers.
Epics are **lane-agnostic** (openspec | superpowers | claude-code | decision | external);
OpenSpec is one lane. Stories come from each epic's source (OpenSpec `tasks.md`, a Superpowers
plan, or a manual list). Follow these rules:

1. **Detours** — when something blocks the active epic, CLASSIFY before fixing:
   - *Minimal* (small, self-contained, no design ambiguity): fix → test → commit → push,
     then run `/pm:detour --minimal "<what>"` so it is recorded in `.conductor/detours.log`.
     Then resume.
   - *Substantial* (own design / changes shared behavior / multi-step): run `/pm:detour`.
     It becomes its own epic in the appropriate lane (OpenSpec proposal, Superpowers plan,
     etc.); PUSH the current epic onto the detour stack in `.conductor/state.json` with a
     concrete reason and `reconcileOnResume`.
2. **State of record is `.conductor/state.json`.** After any change to epics, status,
   priority, or the detour stack, re-render with `/pm:status`. Never hand-edit `PROJECT.md`.
3. **Resuming after a detour** — use `/pm:resume`. If the popped frame had
   `reconcileOnResume`, run the reconcile gate (reconciler agent) BEFORE writing code,
   then write its verdict back durably with `record-reconcile <id> --detour <id>
   --verdict valid|invalidated [--amendments "<a>;<b>"]` — this attaches
   `{verdict, amendments, reconciledAt}` to the paused epic's link to the detour and
   clears `reconcileNeeded`, instead of the judgment only ever living in conversation.
4. **Honcho** — on every PUSH and POP, also write a one-line memory to Honcho
   ("paused X for Y" / "resumed X, reconciled vs Y") so the relationship survives outside
   this repo.
5. **Keep `tasks.md` checkboxes truthful** — they are the source of truth for story progress.
6. **Roadmap as backlog** — work you intend to do but haven't proposed yet can be
   registered now with `/pm:epic add … --status planned` (any lane). Planned epics show
   as ordered backlog in `PROJECT.md` and a `planned: N` count in the briefing, without a
   "no change on disk" warning; `/pm:sync` flips an openspec planned epic to untriaged once
   its change is proposed. Have a roadmap doc? Read it in-session and load each item this way.

## The gate procedure — required task items

Every item below is a NUMBERED REQUIRED TASK ITEM in the change's own task list, carried
into both gates. They are not review guidance and must not be restated as prose bullets:
measured across one audited repository, a rule carried by a mandatory task section reached
14/14 subsequent changes, while the same rule written as a prose bullet reached 3/15.

1. **Call-site completeness sweep.** For every rule, guard or invariant this change introduces
   or modifies, enumerate ALL call sites of the thing being guarded — derived mechanically
   (`rg` for the callers), never a list typed from memory, which goes stale the moment a
   caller is added. Then state where the rule holds and where it does not, and
   justify each omission. A guard added at one call site while an identical sibling site is
   left untouched is a FINDING, not a detail: raise it even though the unedited site never
   appears in the diff. Both gates are diff-scoped and structurally cannot see an edit that
   is absent from a file the diff never touched — the dominant defect class in this
   repository's own audit, ~38 instances in one shard.
   A DATA reference is a call site too: for every field the change adds that holds another
   record's id, enumerate the places that write it, read it and REMOVE it. A deletion path
   that strips one holder and not its siblings leaves a dangling reference — the record
   rendering a pointer to something that no longer exists — and it is invisible to both
   gates for the same diff-scoped reason.
2. **Verify against the commit, not the working tree.** The commit is the unit of verification.
   Reading a file in the working tree is NOT verification. For every task, run
   `git show --stat <that task's sha>` and assert that
   every file the task claims to change appears in THAT commit. A task whose claimed file is
   absent from its commit FAILS, even though the working tree holds the intended edit, the
   suite passes and both gates are green. Audited here: two commits each claimed to remove a
   file's code and neither staged it, because a `git add` with an explicit path list aborted
   on an already-removed path — all four verification layers were reading the working tree,
   so nothing caught it, and it recurred after being written down in a commit message in the
   same epic.
3. **Declare lifecycle bookkeeping.** A task that is bookkeeping about the change's own
   lifecycle rather than its work — above all the task that ARCHIVES THE CHANGE ITSELF, which
   always qualifies — carries the literal marker `<!-- pm:lifecycle -->` ON THE TASK LINE.
   The engine infers this from nothing else: not the wording, not the commands the text
   names, not the position in the file. Mark it at the moment the task source is AUTHORED
   OR AMENDED — a source written before this capability existed gets the marker the first
   time you touch it, or its archive task counts as outstanding work forever.
4. **Attribute every commit to its epic.** At the moment each commit is made, record it:
   `update-epic <id> --attribute-commit <sha>`. The engine infers attribution from NOTHING —
   not the files a commit touches, not an epic id in a message — so an unrecorded commit is
   a commit the epic's Gate 2 cannot be checked against. The per-task conventional commit of
   an OpenSpec apply loop always qualifies. Work already in flight is covered too, but ONLY
   BEFORE the first attribution: catch up in the order the commits landed, then keep
   attributing forward. The array is append-only — the engine neither reorders nor
   de-duplicates it — so catching up AFTER attributing forward leaves an ancestor as the
   last entry, and the LAST entry is the endpoint a recorded Gate 2 `headSha` is compared
   against. If forward attribution has already begun, attribute forward only and say so;
   a wrong endpoint reads as a stale verdict and refuses the archive.
   ONE EXCLUSION, and it is not a judgment call: the commit that moves
   `openspec/changes/<id>/` under `archive/`, and any commit that only relocates or deletes a
   change's artifacts rather than implementing its work, is lifecycle bookkeeping and
   MUST NOT be attributed. That move lands after the reviewed range by construction, so
   attributing it
   makes the epic's own Gate 2 stale at the instant the archive gate reads it.
5. **Review a release's specs against each other.** Gate 1 and Gate 2 each take ONE CHANGE
   as their unit, so nothing above them asks whether a release's specs AGREE. Before
   `/opsx:apply` on any release holding two or more spec files — counted FLAT across its
   member changes, so one change carrying six specs qualifies — and again after any round
   of concurrent amendment, dispatch FRESH-CONTEXT reviewers at the release's whole spec
   set (one under `standard`, two with different lenses under `thorough`) and ask the six
   questions: contradiction, double ownership, unmeetable requirements, gaps against the
   proposal's Resolves list, vocabulary forks, and shared chokepoints. Split every finding
   into BLOCKS and POLISH, fix the BLOCKS, decline most POLISH and say why — a review of a
   large document always returns something, so "no findings" is not a stopping condition.
   A contradiction is never POLISH. Then record the verdict:
   `record-cross-spec-review <releaseId> --verdict pass|fail --reviewer "<identity>"`.
   The engine enumerates the spec set from disk and hashes it, so a spec ADDED to the
   release afterwards — or a reviewed spec amended — marks the verdict stale on every
   surface; a set you assert instead would go stale in exactly the way this gate exists to
   catch. Measured here: this pass returned 5 Critical and 10 Important against six specs
   that had each passed `openspec validate --strict` and would each have passed Gate 1
   alone, including a flagship scenario that was unreachable.
6. **End work by recording a disposition.** An epic, a story, a deferral or a release
   exclusion ENDS by recording a terminal disposition carrying its required reason, and
   never by removing the record. The archive verb takes TWO halves in ONE invocation — the
   disposition AND a deferral assertion — because the gate refuses either half alone:
   `update-epic <id> --status archived --outcome delivered|killed|superseded|abandoned|declined --reason "<why>" --no-deferrals`
   (every outcome except `delivered` requires the reason). `--no-deferrals` is the explicit
   "there are none" and is a claim, not a default — swap it for `--deferral
   "<epicId>:<artifact section>"` where work is now held by a registered epic, or
   `--declined-deferral "<what>:<why not>"` where you are deliberately not doing it; both
   repeat, and the engine will not read your artifacts to guess.
   Deletion removes the record of projected work, which is
   precisely what a disposition exists to preserve. `remove-epic` stays available and
   ungated for what it is for: an epic registered in error, a duplicate, a mistake made a
   minute ago — where there is no disposition to record because there was no work.

## Intake — triage an ask against the whole backlog BEFORE registering it

The ask is the ONLY moment the whole backlog is cheap to consider: after registration nothing
ever re-reads it as a set, so an ask that duplicates existing work in another shape becomes a
permanent second epic. The dedup that already exists is IDENTITY-based — same id, or the same
`externalUrl` — which catches a re-run of sync and nothing else. Measured in this plugin's own
repository: four live pairs are one change registered twice under different lanes and
different names, and identity dedup found none of them.

1. **Get the candidate set mechanically.** Before any `add-epic`, run
   `/pm:triage "<the ask, in its own words>"`. It returns the existing epics that share
   distinctive vocabulary with the ask (each with the shared tokens that put it there), the
   lane this repo's routing picks, and the backlog's current shape. It returns
   `verdict: null` and that is not a placeholder: the engine computes what is WORTH READING
   and never decides. Nothing about a lexical overlap is a claim that two asks are the same.
2. **READ the candidates — do not skim the scores.** Open each one that could plausibly be
   the same work. A high score with unrelated intent is a miss; a low score on an epic whose
   description turns out to cover the ask is a hit. This is the judgment the surface exists
   to make cheap, and it is yours.
3. **Record the relationship you found**, rather than leaving it in the conversation:
   `add-epic … --link "relates-to:<id>:<why>"` where the two asks inform each other;
   `--link "supersedes:<id>:<why>"` where this ask REPLACES an existing epic — then end the
   superseded one with its own disposition (`--outcome superseded --reason "<what replaced
   it>"`), because a consolidation that leaves both epics open has consolidated nothing.
   A candidate `triage` marks `superseded: true` is already dead — do not consolidate into it.
4. **Say no out loud when the answer is no.** Not every ask should be taken on, and declining
   by never registering it destroys the record that anybody considered it. Register it, then
   `update-epic <id> --status archived --outcome declined --reason "<why not>" --no-deferrals`.
   Two commands, deliberately: creating an epic directly at `archived` stamps an engine record
   carrying no reason, which is the silence this step removes.

**This is not a substitute for the identity dedup in the sync procedures below, and they are
not a substitute for it.** A URL match answers "have I already mirrored THIS item"; triage
answers "is this ask already in the backlog under another name". Run both.

## Epic-level autonomy

An epic's `autonomy` block (`.conductor/state.json`) can grant it broad execution trust —
`level: "off"` by default (today's behavior, unchanged). Setting `level: "autonomous"`
removes the need to ask before each phase transition, but NEVER removes a genuine safety stop.
This is development-time only — it never covers actions with irreversible EXTERNAL side
effects (sending email/Slack, deploying to production, third-party API calls, pushing to a
shared branch); those are out of scope regardless of autonomy level.

1. **Preflight before flipping the switch** — see the `conductor` skill's
   "Epic-level autonomy — the preflight scan" section for the full process. In short: read
   the epic's full source, produce a short batch of destructive-risk-points +
   genuine-unknowns questions, get the user's answers, THEN record them:
   `set-autonomy <id> --preauthorize "<action>:<reason>"` / `--context "<note>"`, and only
   then `set-autonomy <id> --level autonomous`. For routine, repeated categories of action
   instead of enumerating each one, use the shorthand
   `--preauthorize "category:<filesystem|network|schema|external-api>:<reason>"` — see the
   `conductor` skill's "Epic-level autonomy" section for the exact keyword heuristic each
   category matches at decision-rule time.
2. **Execution-time decision rule** — check every destructive action against these, in
   order, before treating it as a stop:
   a. Already pre-authorized in the preflight — either an exact `action` match or the
      action falls under a granted `category` (per the category heuristic)? → proceed,
      record via `--notify`.
   b. No backup/restore path exists? → STOP regardless of autonomy level.
   c. Destructive but restorable (backed up first)? → WARN — `--notify` it immediately, proceed.
   d. No context to act on? → STOP — a real gap, not a false stall.
   e. Consequential and not yet notified? → `--notify` it immediately, then proceed.
3. **Notify incrementally, not at the end** — `--notify` writes durably to `state.json`'s
   `notifications[]` the moment a WARN-class (c) or consequential (e) decision is made. Do this
   AS EACH DECISION HAPPENS, not batched — a session can be compacted or interrupted mid-epic,
   and anything not yet `--notify`'d is lost when that happens.
4. **End-of-epic report** — on completion, read back the accumulated `notifications[]` and
   report what was asked, what was done, and the decisions made in the user's absence (drawn
   from that log, not from memory), with an explicit "are you OK with these?" checkpoint, THEN
   run tests. Leave room to iterate — including rewriting code — if the user is not satisfied.

## Review mode

Review intensity is a bounded dial, not a free-form call each time — set via
`set-review-mode --mode <off|standard|thorough>` (default: `standard` if never set).

| Mode | Reviewer budget | Trigger |
|------|-----------------|---------|
| `off` | none — self-review only | tiny, low-risk, single-file claude-code tweaks |
| `standard` | one fresh-context reviewer per gate | the default: OpenSpec Gate 1/Gate 2, a Superpowers task review |
| `thorough` | two independent fresh-context reviewers per gate; adjudicate any disagreement yourself | schema/migration changes, security-sensitive work, or anything explicitly flagged high-stakes |

Current mode: **standard**.

## Feedback — don't let friction stay silent

If you hit a bug, a missing CLI verb, an unexpected limitation, or repeated friction
working with this plugin — in this repo or any repo using it — don't just work around it
and move on. File it: `/pm:feedback [bug|feature] "<summary>"` against `cfdude/pm`, or ask
the user "want me to file this as feedback?" if you're not sure it's worth it. The failure
mode this guards against is silent: hand-editing `.conductor/state.json` to flip a story's
`done` flag (no CLI verb exists for it) recurred across several separate sessions before
anyone reported it, even though `/pm:feedback` existed the whole time. A filed issue is
cheap; an unreported recurring papercut is not — silent pain is where a product fails its
users.

## Re-read the source before an epic becomes the work

An epic becoming active is the moment specs or a plan get drawn for it. Before that, re-read
what it is FOR. Which source depends on provenance, never on any tracker's direction:
- The epic has an `externalId` → re-read the LINKED ITEM (body, comments, labels, state), then
  record what you found: `record-tracker-refresh <id> --verdict unchanged|material-change
  --external-updated-at <iso> [--summary "<what changed>"]`. The timestamp is the tracker's
  own, never a local clock reading, and recording it clears the obligation.
- The epic has NO `externalId` → re-read its local source: its plan document, or its OpenSpec
  proposal plus its tasks. This one is instruction only — nothing is recorded in state for it,
  and `record-tracker-refresh` refuses such an epic by name rather than accepting a verdict
  about a linked item that does not exist.
An outward-mirrored epic owes the same look as an inward-born one: a linked item accumulates
third-party context regardless of which way it was born. Origin decides only whose ask wins
when the item and a local spec disagree.
<!-- END pm-conductor rules -->
