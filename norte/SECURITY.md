# Security Policy

## Supported version

Security fixes are applied to the current `main` branch.

## Reporting a vulnerability

Do not open a public issue containing credentials, personal data or exploit details. Use the repository's **Security > Report a vulnerability** flow so the maintainer can investigate privately.

Include the affected route or component, reproduction steps, expected impact and any suggested mitigation. Never test against accounts or data you do not own.

## Secrets

The repository must never contain a real `GEMINI_API_KEY`, `DATABASE_URL`, session cookie, invitation code or private key. If a secret is committed, revoke it first; deleting the line from a later commit is not sufficient.
