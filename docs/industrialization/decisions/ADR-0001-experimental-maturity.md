# ADR-0001: Default all engineering domains to experimental maturity

- **Status:** Accepted for R0
- **Date:** 2026-10-23

## Context

The repository contains broad engineering features, but no complete independent validation record supports a released workflow. Existing names and test descriptions sometimes imply certification, signoff, or commercial parity without evidence.

## Decision

The maturity registry marks every registered domain `experimental` and `releaseApproved: false`. Unknown domains also resolve to experimental. Reports, diagnostics, and public UI copy must not promote an experimental result to validation, certification, signoff, or release status.

## Consequences

The current workbench remains available for development and demonstration, with experimental labels. A domain can advance only after its own evidence package is independently reviewed and the registry is deliberately changed. The registry is a guardrail and display source; it does not by itself establish feature-level correctness.
