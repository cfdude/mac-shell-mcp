# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

The Mac Shell MCP server executes system commands and takes security seriously. If you discover a security vulnerability, please follow these steps:

1. **DO NOT** open a public issue
2. Report it privately, by either route:
   - **Preferred:** [GitHub private vulnerability reporting](https://github.com/cfdude/mac-shell-mcp/security/advisories/new)
   - Email **security@onvex.ai**

   Please include:
   - A description of the vulnerability
   - Steps to reproduce the issue
   - Potential impact
   - Suggested fix (if any)

We will acknowledge your email within 48 hours and provide a detailed response within 7 days.

## Security Model

- **No shell.** `execFile` is never given a `shell` option, so arguments reach the OS uninterpreted.
- **The child environment is constructed**, not inherited, so a configuration variable cannot name a helper program that never appears in the argument list.
- **Programs are authorized**, not only arguments: resolved from configured program directories, matched by resolved path rather than basename, and refused if they resolve inside a configured root.
- **Argument allowlists, never denylists.** A command declaring no allowed arguments accepts none.
- **Confinement.** Authorization is effect crossed with scope, computed per call, where scope covers the working directory as well as every path-shaped argument.
- **No tool mutates policy.** Policy is read once at startup and is immutable for the process lifetime.
- **Protected locations.** The policy file, its ancestors, the program directories and the whole audit log directory cannot be modified by this server, judged by the operation a request performs rather than a command's declared effect.
- **Append-only audit log** of every request, permitted or refused.

## Best Practices

When using this MCP server:

1. **Keep `allowedRoots` narrow** — everything inside a root is readable by one recursive search
2. **Add `find`, `git` or an interpreter only deliberately** — each can execute or write in ways the model cannot constrain
3. **Never run the server with elevated privileges** (e.g., sudo)
4. **Configure your MCP client to prompt for `execute_external_command`** — it is the only route outside your configured directories
5. **Keep the server updated** to receive security patches

## Known Limitations

Stated rather than implied. None of these is hidden by the design:

- **Path detection is heuristic.** Deciding which arguments are paths cannot be perfect; ambiguous arguments fail closed, which over-prompts rather than under-protects.
- **Everything inside a root is freely readable.** A single recursive search returns anything in a configured directory, so a root should be a project directory, not your home folder. The server refuses `$HOME` and `/` outright and reports a root containing `.ssh`, `.aws`, `.env`, `.npmrc` or `.git/config`.
- **The policy file is a single point of trust.** This server cannot modify it, and `chmod 444` raises the bar further, but a separate process running as the same user can. That is inherent to file-based configuration.
- **`ask` is only as strong as the host.** It resolves to the client's approval prompt, so a host configured to always-allow converts every `ask` into `allow`. Without MCP `elicitation`, `ask` becomes `deny`.
- **`execute_external_command` is inert without `elicitation`.** On a host that does not offer it — including the primary target — out-of-root work is unavailable rather than silently permitted.
- **Flag meanings vary between implementations.** `grep -R` follows symbolic links under one implementation and not another, so commands are pinned to an expected program path and flag allowlists are authored for that program.
- **Commands run with the full permissions of the user running the server.** There is no sandbox.
- **No delete capability.** `rm` is unavailable, as it was in 1.x.
- **The stdio-only CI guard is a tripwire, not a proof.** The SDK's HTTP transports pull in a web-framework dependency tree whose advisories are unreachable here only because this server never instantiates them. CI fails if a transport reference appears in the source or built output, but it matches text rather than parsing a module graph, so a sufficiently indirect reference could evade it.

## Distribution

The npm package named `mac-shell-mcp` is **not published by this project** and is not under its control. Install `@the_cfdude/mac-shell-mcp`, or from this repository.
