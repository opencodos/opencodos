# Contributing to Codos

Thanks for your interest in contributing to Codos! This guide covers what you need to know.

## Contributor License Agreement (CLA)

Before we can accept your contribution, you must sign our CLA. This grants Codos the right to use your contribution under both the AGPLv3 and our commercial license.

- **First-time contributors** will be prompted automatically on your first PR by the CLA bot.
- You only need to sign once — it covers all future contributions.

We require a CLA because Codos uses a dual license (AGPLv3 + commercial). Without it, we couldn't include community contributions in our enterprise offering.

## Dual License Rules

| Where your code goes | License | What this means |
|----------------------|---------|-----------------|
| Anywhere outside `ee/` | AGPLv3 | Open source, community-accessible |
| Inside `ee/` | Commercial | Requires explicit approval from maintainers |

- Most contributions go to the core (outside `ee/`).
- PRs touching `ee/` require prior discussion with maintainers.

## Getting Started

```bash
# Clone the repo
git clone https://github.com/<your-username>/codos.git
cd codos

# Run bootstrap (installs deps, starts services, opens setup wizard)
bash scripts/bootstrap.sh --start
```

See the [README](README.md) for detailed setup instructions.

## Making a Contribution

1. **Open an issue first** for non-trivial changes. Discuss the approach before writing code.
2. **Fork the repo** and create a branch from `main`.
3. **Follow existing code style.** Pre-commit hooks run automatically (see `.pre-commit-config.yaml`).
4. **Write clear commit messages.** One sentence explaining the "why", not the "what".
5. **Open a PR** against `main` with a description of what changed and why.

## Pull Request Guidelines

- Keep PRs focused — one logical change per PR.
- Include screenshots for UI changes.
- Link the related issue (e.g., `Closes #42`).
- All CI checks must pass before merge.

## Reporting Bugs

Open a [GitHub issue](https://github.com/<your-username>/codos/issues) with:
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Python/Node version)

## Security Vulnerabilities

Do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## Code of Conduct

Be respectful. We're building something together.
