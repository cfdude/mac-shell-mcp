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
- **THEN** previously written records are unchanged

### Requirement: The log is enabled by default and bounded

The system SHALL record by default, SHALL write to a configurable location, and SHALL bound the log's size so it cannot grow without limit.

#### Scenario: Recording happens without configuration

- **WHEN** the server runs on a default configuration
- **THEN** requests are recorded

#### Scenario: The log does not grow unbounded

- **WHEN** the log reaches its configured size limit
- **THEN** the limit is enforced and recording continues

### Requirement: The server proposes configuration but cannot apply it

The system SHALL offer a means of summarizing recorded history into suggested configuration, expressed in both the config-file form and the host-extension form. The system SHALL NOT apply its own suggestion, and SHALL NOT acquire any permission as a result of making one.

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
