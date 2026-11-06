# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes (experimental) |

## Reporting a Vulnerability

Please report security vulnerabilities to **security@omnieng.io** (placeholder
address pending rights-holder confirmation). Do **not** open a public issue for
a vulnerability.

### Response SLA

| Severity | Initial response | Fix target (if accepted) |
| -------- | ---------------- | ------------------------- |
| Critical | 24 hours         | 7 days                    |
| High     | 48 hours         | 14 days                   |
| Medium   | 5 business days  | 30 days                   |
| Low      | 10 business days | Next release              |

### What to include

- Affected version(s)
- Steps to reproduce
- Impact description
- Any suggested mitigation

## Security practices

- The repository runs automated secret-pattern scans (`scripts/check_secret_patterns.js`)
  and dependency audits (`npm run dependency:audit`) in the local gate chain.
- IPC handlers enforce trusted-sender checks; the renderer uses a Content
  Security Policy and DOM-text rendering.
- This project is **experimental**; no release is certified for safety-critical
  use. Evaluate risks accordingly.
