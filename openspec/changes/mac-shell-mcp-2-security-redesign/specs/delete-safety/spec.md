## Purpose

Governs file deletion by refusing the shapes that cannot be undone and, for the rest, telling the human whether version control can actually recover what they are about to lose.

## ADDED Requirements

### Requirement: Deletion is off by default and confined to roots

The system SHALL treat deletion as denied unless policy explicitly permits it, and SHALL refuse deletion of any path resolving outside the configured roots regardless of policy.

#### Scenario: Deletion is denied on a default configuration

- **WHEN** a delete is requested and policy does not enable it
- **THEN** the request is refused

#### Scenario: Deletion outside roots is refused with no override

- **WHEN** a delete targets a path outside every configured root
- **THEN** the request is refused, even where policy permits deletion

### Requirement: Recursive forced deletion is always refused

The system SHALL refuse any delete request combining a recursive flag with a force flag, in any spelling or order, including fused short flags. The system SHALL refuse any request disabling root protection.

#### Scenario: Combined recursive and force flags are refused

- **WHEN** a delete is requested with `-rf`, `-fr`, `-r -f`, or `--recursive --force`
- **THEN** the request is refused, regardless of policy and regardless of target

#### Scenario: Disabling root protection is refused

- **WHEN** a delete is requested with `--no-preserve-root`
- **THEN** the request is refused

### Requirement: Deletion is a two-call contract, never self-confirmed

A delete request SHALL NOT execute on the call that requests it. The system SHALL refuse the first call and return a report describing exactly what would be destroyed. Deletion SHALL occur only on a subsequent, separate tool call naming the same target.

The system SHALL NOT implement its own approval queue, and SHALL NOT accept any parameter by which the caller asserts its own approval. The human gate is the host's per-call approval prompt, which is why a second call is required: it presents the host with a fresh decision carrying the report. Where no interactive client is present, a delete SHALL be refused outright, following the `ask` rule.

#### Scenario: The first call reports rather than deletes

- **WHEN** a delete targeting a directory inside a configured root is requested
- **THEN** nothing is deleted on that call
- **AND** the response reports the file count, total size, a sample of the contents, and the recoverability assessment

#### Scenario: The second call performs the deletion

- **WHEN** a delete is requested again for the same target after a reporting call
- **THEN** the deletion proceeds, subject to every other rule

#### Scenario: The agent cannot assert its own approval

- **WHEN** a delete request carries any parameter purporting to confirm or approve it
- **THEN** the parameter has no effect, because a self-asserted approval is the pattern this design removes

#### Scenario: Headless deletion is refused

- **WHEN** a delete is requested and no interactive client is present
- **THEN** the request is refused rather than proceeding on a second call

### Requirement: Deletion reports whether the target is recoverable

Before deleting, the system SHALL determine the target's version-control state **within the repository that actually contains the target**, resolving submodule and linked-worktree boundaries so that recoverability is never reported from a repository whose history does not hold the content. The system SHALL report the resulting recoverability. The system SHALL distinguish a tracked and committed file, a tracked file with uncommitted changes, a committed file not yet pushed, an untracked file, an ignored file, and a path in no repository.

#### Scenario: A committed and pushed file is reported recoverable

- **WHEN** a delete targets a file that is tracked, unmodified, committed, and present on the upstream remote
- **THEN** the confirmation states that the file can be restored from version control

#### Scenario: An ignored file inside a repository is reported unrecoverable

- **WHEN** a delete targets a file that lies inside a repository but is excluded by its ignore rules
- **THEN** the confirmation states that version control will NOT restore it, despite the file being inside a repository

#### Scenario: Uncommitted changes are called out

- **WHEN** a delete targets a tracked file with uncommitted modifications
- **THEN** the confirmation states that the uncommitted changes will be lost while the committed version remains recoverable

#### Scenario: An unpushed commit is distinguished from a pushed one

- **WHEN** a delete targets a tracked file whose commits have not reached the upstream remote
- **THEN** the confirmation states that recovery depends on the local repository only

#### Scenario: A path outside any repository is reported permanent

- **WHEN** a delete targets a path in no repository
- **THEN** the confirmation states the deletion is permanent unless a separate backup exists

#### Scenario: An untracked file is reported permanent

- **WHEN** a delete targets a file inside a repository that has never been tracked
- **THEN** the confirmation states the deletion is permanent

#### Scenario: A submodule is assessed against its own repository

- **WHEN** a delete targets a path inside a submodule or a linked worktree
- **THEN** recoverability is determined from the repository that holds that content, not from the enclosing repository

### Requirement: Version-control metadata is protected from deletion

Because the recoverability report depends entirely on version-control metadata, the system SHALL refuse every write- or delete-effect command whose resolved target is a repository's metadata directory, or any path within it, regardless of configured roots.

#### Scenario: The repository metadata directory cannot be destroyed

- **WHEN** a request targets a repository's `.git` directory with a write- or delete-effect command
- **THEN** the request is refused
- **AND** the refusal states that doing so would destroy the recoverability every other delete depends on
