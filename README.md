# Mac Shell MCP Server

[![CI](https://github.com/cfdude/mac-shell-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/cfdude/mac-shell-mcp/actions/workflows/ci.yml)
[![Security Scans](https://github.com/cfdude/mac-shell-mcp/actions/workflows/security.yml/badge.svg)](https://github.com/cfdude/mac-shell-mcp/actions/workflows/security.yml)

An MCP server that lets an AI client run a **small, fixed set of read-only shell commands**, confined to directories you nominate.

It is built around one idea: **the agent cannot widen its own authority.** There is no tool that edits the policy, no approval queue the agent can drain, and no shell to interpret its arguments.

> **Upgrading from 1.x?** 2.0.0 is a breaking change. Seven tools were removed and the authorization model was replaced. See [Migrating from 1.x](#migrating-from-1x). 1.x contained two vulnerabilities reported by four independent researchers; see the [security advisories](https://github.com/cfdude/mac-shell-mcp/security/advisories).

## What it does

| Tool                       | What it is for                                                    |
| -------------------------- | ----------------------------------------------------------------- |
| `execute_command`          | Run a permitted command **inside** your configured directories    |
| `execute_external_command` | Run one **outside** them — requires a client that can ask a human |
| `execute_pipeline`         | Chain read-only commands, stdout to stdin, without a shell        |
| `get_policy`               | Ask what is permitted, rather than guessing and being refused     |
| `suggest_policy_config`    | Turn observed usage into config **you** apply                     |

## Default commands

`ls` `pwd` `echo` `cat` `head` `tail` `wc` `grep`

Each is restricted to an allowlist of flags. None of them can write a file, execute another program, or read configuration from the environment.

**`find`, `git`, `rm` and every interpreter are absent by default.** You can add any of them, and should know why they are not there:

- `find -fprintf` writes attacker-chosen content to an attacker-chosen path, while `find` is naturally classified read-only
- `git` executes commands from a repository's own `.git/config`, and no environment variable disables that
- interpreters (`python`, `perl`, `awk`, `node`, `osascript`, …) take inline code as an argument

## Install

```bash
npm install -g @cfdude/mac-shell-mcp
```

Then create a policy:

```bash
mkdir -p ~/.mac-shell-mcp
cp .mac-shell-mcp.sample.json ~/.mac-shell-mcp/config.json
$EDITOR ~/.mac-shell-mcp/config.json    # set allowedRoots to your project
chmod 444 ~/.mac-shell-mcp/config.json  # defence in depth; see Security
```

Add to your MCP client:

```json
{
  "mcpServers": {
    "mac-shell": { "command": "npx", "args": ["-y", "@cfdude/mac-shell-mcp"] }
  }
}
```

**A fresh install with no roots configured refuses everything** — deliberately. Each refusal names the permitted commands and where configuration lives, so the first failure tells you what to do.

## Configuration

Policy is found in this order, first match wins, never merged:

1. `$MAC_SHELL_MCP_CONFIG` — an explicit path
2. `~/.mac-shell-mcp/config.json`
3. Host environment (`MAC_SHELL_ROOTS`, `MAC_SHELL_COMMANDS`)
4. Built-in defaults

**Policy is never read from the working directory.** A cloned repository must not be able to supply the policy governing the agent that opens it.

```jsonc
{
  "allowedRoots": ["/Users/you/Projects/my-project"],
  "programDirectories": ["/usr/bin", "/bin", "/usr/sbin", "/sbin"],
  "commands": {
    "grep": {
      "program": "/usr/bin/grep",
      "effect": "read",
      "allowedArgs": ["-i", "-n", "-r", "-l", "-E", "-F"],
      "permission": "allow",
    },
  },
}
```

`permission` is `allow`, `ask`, or `deny`. **`ask` requires a client offering MCP `elicitation`** — the only capability that means a human can be asked. Where it is absent, `ask` becomes `deny`, never `allow`.

## How it decides

**Authorization is `effect × scope`, computed per call.** `grep` inside your project is free; the same `grep` against `~/.aws` is not. The command name alone never decides.

- **No shell.** `execFile` is never given a `shell` option, so arguments reach the OS uninterpreted. Nothing evaluates `;`, `$()`, or backticks — which is also why filenames with spaces, parentheses and brackets work normally.
- **The program is authorized, not just the arguments.** Commands resolve to an absolute path from your program directories, are matched by that resolved path rather than by basename, and are refused if they resolve inside one of your roots. Roots hold data, never code.
- **The environment is constructed, not inherited**, so a variable like `RIPGREP_CONFIG_PATH` cannot smuggle in a helper program that never appears in the argument list.
- **Allowlists, never denylists.** A denylist is a list of the flags somebody thought of.
- **Scope includes the working directory**, so a command with no path argument is judged by where it runs rather than passing because it named nothing.

## Security

The policy file, its parent directories, your program directories, and the whole audit log directory are **protected locations** — the server refuses to modify any of them, judged by the operation a request performs rather than by a command's declared effect. This is enforced in code, keyed on filesystem identity rather than path strings, and cannot be switched off from the policy file.

`chmod 444` on your config is worth doing as a second, independent layer. It is not the mechanism: replacing a file needs write permission on its _directory_, not the file.

Every request, permitted or refused, is recorded to an append-only audit log.

**Known limits**, stated rather than implied — see [SECURITY.md](SECURITY.md):

- Path detection is heuristic, and fails closed
- Everything inside a root is freely readable by one recursive search
- `ask` is only as strong as the host's approval prompt
- Flag meanings vary between implementations of the same command name

Report vulnerabilities via [private advisory](https://github.com/cfdude/mac-shell-mcp/security/advisories/new) or `security@onvex.ai`.

## Migrating from 1.x

**Removed:** `add_to_whitelist`, `update_security_level`, `remove_from_whitelist`, `approve_command`, `deny_command`, `get_pending_commands`, `get_whitelist`.

The first three let any client promote a forbidden command to `safe`. The next three formed an approval workflow the requesting agent could drain by itself. `get_whitelist` is replaced by `get_policy`.

Runtime whitelist edits become a config file you edit and the server reads at startup. `rm` was `FORBIDDEN` in 1.x and remains unavailable, so nothing that worked before stops working.

## Development

```bash
npm install && npm run build
npm test          # run it twice; a suite that only passes once is not passing
npm run lint && npm run format:check
```

Design and specifications: `openspec/changes/mac-shell-mcp-2-security-redesign/`.

## License

MIT — see [LICENSE](LICENSE).
