# Contributing to CadenceMQ

Thank you for your interest in contributing to CadenceMQ! This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- Node.js 22+ (see `.nvmrc`)
- pnpm 10.10.0+ (see `package.json`)

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/papra-hq/cadence-mq.git
   cd cadence-mq
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Run tests**
   ```bash
   pnpm test
   ```

## Development Workflow

### Available Scripts

- `pnpm test` - Run all tests
- `pnpm test:watch` - Run tests in watch mode
- `pnpm build` - Build all packages
- `pnpm build:watch` - Build packages in watch mode
- `pnpm lint` - Run linting
- `pnpm lint:fix` - Fix linting issues
- `pnpm dev` - Start development mode (watch and auto-build packages)

### Project Structure

```
packages/
├── core/                 # Main library
├── driver-{name}/        # Driver package
└── test-suites/          # Shared test suites
```

### Adding New Drivers

1. Create a new package in `packages/driver-{name}/`
2. Implement the `JobRepositoryDriver` interface
3. Add comprehensive tests using the shared test suites
4. Update the main README with usage examples

### Testing

- All drivers must pass the shared test suites
- Add unit tests for driver-specific functionality
- Ensure tests run in both memory and file-based modes where applicable

## Code Style

### TypeScript

- Use strict TypeScript configuration
- Prefer functional programming patterns
- Use factory functions for object creation
- Export types and interfaces clearly

### Error Handling

- Use the `CadenceError` class for domain-specific errors
- Provide meaningful error messages and codes

## Pull Request Guidelines

### Before Submitting

1. **Run tests**: Ensure all tests pass
   ```bash
   pnpm test
   ```

2. **Check linting**: Fix any linting issues
   ```bash
   pnpm lint:fix
   ```

3. **Update documentation**: Add or update relevant documentation

4. **Add tests**: Include tests for new functionality

5. **Add a changeset**: [Changesets](https://github.com/changesets/changesets) is used to manage versioning and publishing.
   ```bash
   pnpm changeset
   ```
6. **Open a PR**: Open a PR to the `main` branch.

## Issue Reporting

### Bug Reports

Include the following information:
- CadenceMQ version
- Node.js version
- Database driver and version
- Steps to reproduce
- Expected vs actual behavior
- Error messages and stack traces

### Feature Requests

- Describe the use case
- Explain the expected behavior
- Consider implementation complexity
- Check if it aligns with project goals

## Community Guidelines

- Be respectful and inclusive
- Provide constructive feedback
- Help others learn and grow
- Follow the project's code of conduct

## Getting Help

- Check existing issues and discussions
- Join our community channels
- Create a detailed issue report
- Provide minimal reproduction examples

## License

By contributing to CadenceMQ, you agree that your contributions will be licensed under the [MIT License](./LICENSE) of the project.

---

Thank you for contributing to CadenceMQ! 