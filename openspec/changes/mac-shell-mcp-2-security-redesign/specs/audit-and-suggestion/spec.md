## Purpose

Records every command the server was asked to run and turns that history into configuration a human can review and apply, so the question "what did the agent actually do?" has an answer.

## ADDED Requirements

### Requirement: Every request is recorded to an append-only log

The system SHALL append a record for every request it handles, whether permitted or refused, capturing the time, the tool, the command and its arguments, the resolved working directory, the effect and scope classification, the decision, and — where the command ran — its exit code and duration. Records SHALL only be appended.

#### Scenario: A permitted command is recorded with its outcome

- **WHEN** a permitted command runs to completion
- **THEN** a record is appended capturing the command, its arguments, the resolved working directory, the decision, the exit code, and the duration

#### Scenario: A refused command is recorded with its reason

- **WHEN** a request is refused
- **THEN** a record is appended capturing the request and the reason it was refused

#### Scenario: Existing records are never rewritten

- **WHEN** any new record is written
- **THEN** previously written records are unchanged within the active log file

### Requirement: The log is enabled by default and bounded by rotation

The system SHALL record by default, SHALL write to a configurable location, and SHALL bound the log's size by **rotating** to a new file rather than by truncating or rewriting the active one, so that the append-only guarantee holds within each file. The system SHALL report where rotated records went.

The **audit log directory and every file in it** — active and rotated alike — SHALL be protected from write-effect commands, as required by the policy-configuration capability, so that append-only is a property of the system rather than a convention the agent may break, and so that rotation cannot be used to age records out of protection.

#### Scenario: Recording happens without configuration

- **WHEN** the server runs on a default configuration
- **THEN** requests are recorded

#### Scenario: The log does not grow unbounded

- **WHEN** the log reaches its configured size limit
- **THEN** the active file is rotated, recording continues in a new file, and no existing record is rewritten

#### Scenario: The agent cannot erase its own trail

- **WHEN** a request runs a write-effect command against the active log, a rotated log, or the log directory
- **THEN** the request is refused

#### Scenario: The trail as a whole is bounded, not only each file

- **WHEN** rotation has produced many files
- **THEN** a bound on the total number of files and total bytes is enforced, and the oldest records are discarded by the server itself
- **AND** an agent issuing refused requests cannot fill the disk one record at a time, since every request is recorded

#### Scenario: Rotation cannot be pumped to escape protection

- **WHEN** the agent issues many refused requests to force rotation, then targets the rotated file
- **THEN** the rotated file is refused too, because protection covers the directory rather than the active file

### Requirement: The server proposes configuration but cannot apply it

The system SHALL offer a means of summarizing recorded history into suggested configuration, expressed in both the config-file form and the host-extension form. It SHALL be able to propose **permission promotions for already-permitted commands** and **roots derived from server-resolved working directories** — never a new command, a program directory, or any value derived from request arguments. The system SHALL NOT apply its own suggestion, and SHALL NOT acquire any permission as a result of making one.

#### Scenario: A suggestion proposes something actionable

- **WHEN** an already-permitted command has been repeatedly gated by `ask` and approved
- **THEN** the suggestion may propose promoting that command's permission, which is a change a human can act on

#### Scenario: A suggestion reflects observed usage

- **WHEN** a summary is requested after a command has been repeatedly permitted
- **THEN** the suggestion includes that command, with the counts of times it was permitted and refused

#### Scenario: A suggestion is emitted in both configuration forms

- **WHEN** a summary is requested
- **THEN** it is expressed both as a config-file fragment and as the host-extension field value

#### Scenario: Suggesting grants nothing

- **WHEN** a summary suggesting additional commands is produced
- **THEN** the set of permitted commands is unchanged
- **AND** the policy file is not written, consistent with the server being unable to modify its own configuration

#### Scenario: A suggestion cannot carry argument-derived content

- **WHEN** a summary is produced after requests whose arguments contained configuration-like text
- **THEN** the suggestion contains only a fixed set of fields with values drawn from server-side data, never text derived from request arguments
- **AND** it never proposes a program directory, since that would manufacture a path to authoring programs

#### Scenario: Repeated refusals cannot manufacture a suggestion

- **WHEN** a command that has never been permitted is requested many times and refused each time
- **THEN** it does not appear as a suggested addition
- **AND** any count derived from agent-initiated requests is labelled as such, so a human is not persuaded by volume the agent chose
