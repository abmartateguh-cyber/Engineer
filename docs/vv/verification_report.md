# Released verification evidence

**Status: None available.** No engineering workflow currently has an independently reviewed release evidence package.

The previous generated report at this path presented unqualified test output as certification and standards sign-off. That report has been withdrawn. Its historical results must not be used to support engineering decisions, product claims, compliance, or release approval.

The checks under `test/vv/` are test-only diagnostics. Their external reference artifacts and calculations are not independently qualified. Run `node test/vv/run_vv.js` to print the current diagnostics. To write a production-side availability report, run:

```sh
npm run report:vv -- --output-dir /path/to/output
```

That command does not execute a solver. The generated report lists configured and unavailable reference cases and states that no validation ran. It is not validation evidence. A released evidence package requires independent reference artifacts, production engine execution, declared tolerances, convergence and performance checks, and independent review.
