# ADR-0002: Keep validation execution out of the test tree and fail closed

- **Status:** Accepted for R0
- **Date:** 2026-10-23

## Context

Production IPC imported diagnostic runners from `test/`, and those runners included self-comparisons and placeholder references. The test directory is not a production validation service or packaged runtime dependency.

## Decision

Production IPC does not import modules from `test/`. Benchmark endpoints require an injected validation service and otherwise return `UNSUPPORTED`. Diagnostic runners remain explicit developer commands and report missing independent references as unavailable; they reserve failure for invalid data or a failed numerical threshold.

## Consequences

The renderer cannot present the legacy suites as released verification evidence. A future production validation service needs separately maintained reference artifacts, explicit tolerances, production-engine execution, and its own reviewed contract.
