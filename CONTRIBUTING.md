# Contributing to Mac Shell MCP

Thank you for your interest in contributing to Mac Shell MCP! This document provides guidelines for contributing to the project.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md) to keep our community welcoming and respectful.

## How to Contribute

### Reporting Issues

- Check if the issue already exists in the [issue tracker](https://github.com/cfdude/mac-shell-mcp/issues)
- Provide a clear description of the problem
- Include steps to reproduce the issue
- Share relevant logs or error messages
- Mention your environment (macOS version, Node.js version, etc.)

### Suggesting Features

- Open an issue with the "enhancement" label
- Clearly describe the feature and its use case
- Explain why this feature would be valuable
- Consider how it fits with the project's security model

### Submitting Code

1. **Fork the repository** and create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**:
   - Follow the existing code style
   - Add tests for new functionality
   - Update documentation as needed
   - Ensure all tests pass: `npm test`

3. **Commit your changes**:
   - Use clear, descriptive commit messages
   - Follow conventional commits format: `type(scope): description`
   - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

4. **Push and create a Pull Request**:
   - Push your branch to your fork
   - Create a PR against the `main` branch
   - Fill out the PR template completely
   - Link any related issues

### Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/mac-shell-mcp.git
cd mac-shell-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run in development mode
npm run dev
```

### Code Guidelines

- **TypeScript**: Write type-safe code with proper interfaces
- **Security**: Always consider security implications of changes
- **Testing**: Add tests for new features and bug fixes
- **Documentation**: Update README and inline comments as needed
- **Error Handling**: Provide meaningful error messages

### Adding New Commands to Whitelist

When proposing new default whitelisted commands:

1. Consider the security implications
2. Justify why the command should be included
3. Suggest an appropriate security level
4. Document any argument restrictions

### Testing

- Write unit tests for new functionality
- Test command execution in a safe environment
- Verify security levels work as expected
- Check error handling and edge cases

## Review Process

1. All submissions require review before merging
2. Security-related changes need extra scrutiny
3. We may request changes or improvements
4. Be patient - reviews take time

## Questions?

Feel free to open an issue for any questions about contributing!