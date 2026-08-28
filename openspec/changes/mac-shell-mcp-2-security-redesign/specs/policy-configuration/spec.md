## Purpose

Loads the server's authorization policy from a file that the server itself can never modify, so that the same policy model works across every host and cannot be widened by the agent it governs.

## ADDED Requirements

### Requirement: Policy is discovered in a fixed order and never merged

The system SHALL locate its policy by checking, in order: an explicitly configured path, a file in the working directory, a file in the user's home configuration directory, host-supplied environment configuration, and finally built-in defaults. The first source found SHALL be used in full. Sources SHALL NOT be merged.

#### Scenario: A config file supersedes host environment configuration

- **WHEN** both a config file and host-supplied environment configuration are present
- **THEN** the config file is used in full
- **AND** startup output names the file that won and reports that the environment configuration was ignored

#### Scenario: Environment configuration is used when no file exists

- **WHEN** no config file is found at any searched location and host-supplied environment configuration is present
- **THEN** the environment configuration is used

#### Scenario: The active source is discoverable

- **WHEN** the server starts
- **THEN** it reports which policy source was used

### Requirement: Policy is immutable for the lifetime of the process

The system SHALL read policy once at startup and SHALL NOT re-read or modify it while running.

#### Scenario: Editing the file mid-run has no effect

- **WHEN** the policy file is changed while the server is running
- **THEN** the running server's decisions are unchanged until it is restarted

### Requirement: The server cannot modify its own configuration

The system SHALL refuse every write-effect command whose resolved target is the active policy file **or that file's parent directory**, regardless of configured roots, regardless of the command's permissions, and regardless of any exemption expressed in the policy itself. Reading the policy file SHALL remain permitted.

#### Scenario: The server cannot unlock its own policy

- **WHEN** a request runs `chmod` against the active policy file
- **THEN** the request is refused, even if `chmod` is otherwise permitted and the file lies inside a configured root

#### Scenario: The policy file cannot be replaced

- **WHEN** a request runs `mv` or `cp` with the active policy file as its destination
- **THEN** the request is refused, because replacing a file requires no write permission on the file itself

#### Scenario: The policy file's directory is protected

- **WHEN** a request performs any write-effect command against the directory containing the active policy file
- **THEN** the request is refused

#### Scenario: A symlink to the policy file does not launder access

- **WHEN** a request targets a symbolic link that resolves to the active policy file
- **THEN** the request is refused

#### Scenario: Policy cannot exempt itself

- **WHEN** the policy file declares its own path as permitted or excluded from protection
- **THEN** the declaration has no effect and the protection still applies

#### Scenario: Reading policy is allowed

- **WHEN** a request reads the active policy file with a permitted read command
- **THEN** the request succeeds

### Requirement: Policy declares roots, commands, tools, and per-command permissions

The system SHALL accept configured roots, permitted commands, denied commands, enabled tools, and a per-command permission of `allow`, `ask`, or `deny`. A denied command SHALL remain denied even if also listed as permitted. A tool that is not enabled SHALL NOT be offered.

#### Scenario: Denial beats permission

- **WHEN** a command appears in both the permitted and denied lists
- **THEN** requests for it are refused

#### Scenario: A disabled tool is not exposed

- **WHEN** the policy omits a tool from the enabled tools
- **THEN** that tool is absent when a client lists available tools

### Requirement: `ask` degrades to `deny` without an interactive client

Where a command's permission is `ask` and no interactive client is present to prompt a human, the system SHALL refuse the request. It SHALL NOT treat `ask` as `allow`.

#### Scenario: Headless operation refuses rather than permits

- **WHEN** a command whose permission is `ask` is requested and no interactive client is present
- **THEN** the request is refused
- **AND** startup output records that `ask` was downgraded to `deny`

### Requirement: A fresh installation is safe and self-explanatory

The system SHALL default to a read-only command set and no configured roots, so that every request is refused until a human configures roots. Each refusal SHALL name the permitted commands and state where configuration is supplied.

#### Scenario: An unconfigured install refuses but teaches

- **WHEN** any command is requested on a fresh installation
- **THEN** the request is refused
- **AND** the refusal names the permitted commands and points to the configuration location

### Requirement: Host-supplied configuration fields carry defaults without blocking installation

Where the system is distributed as a host extension, every configuration field that carries a default value SHALL be declared optional, so that installation completes and the connector enables without human interaction. A genuinely missing required value SHALL still produce a clear startup error.

#### Scenario: An extension install needs no manual form entry

- **WHEN** the extension is installed and every configuration field carrying a default is declared optional
- **THEN** the connector enables without the human editing the configuration form

#### Scenario: A missing required value still fails loudly

- **WHEN** a value with no default is absent at startup
- **THEN** the server reports a clear error naming the missing value
