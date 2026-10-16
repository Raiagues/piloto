# Private development reports

The runner stores JSON reports in ignored `var/benchmarks/`, the private report storage equivalent of this directory. Historical reports remain there unchanged. Reports contain evaluator-only information and must never enter Project Memory or a model prompt.

Use `--output-dir DIRECTORY` for a separate local destination. Evaluation references remain provisional until independent human engineering review. Approval of `docs/VALIDATED.md` approves the specification, not that separate review.
