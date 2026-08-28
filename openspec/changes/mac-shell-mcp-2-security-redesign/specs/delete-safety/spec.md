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

### Requirement: Directory deletion enumerates what will be lost

Where a delete targets a directory, the system SHALL require confirmation and SHALL first report the number of files, the total size, and a sample of the contents that would be destroyed.

#### Scenario: A directory delete reports its contents before proceeding

- **WHEN** a recursive delete targets a directory inside a configured root
- **THEN** confirmation is required
- **AND** the confirmation reports the file count, total size, and a sample of the contents

### Requirement: Deletion reports whether the target is recoverable

Before deleting, the system SHALL determine the target's version-control state and report the resulting recoverability. The system SHALL distinguish a tracked and committed file, a tracked file with uncommitted changes, a committed file not yet pushed, an untracked file, an ignored file, and a path in no repository.

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
