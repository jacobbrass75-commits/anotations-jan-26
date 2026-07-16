# Writing V3 benchmark source packet

Internal source packet for the July 2026 ScholarMark blog series. This file is not customer-facing and should not be bundled into the public application.

## Public articles

- `/blog/writing-v3-quote-integrity-benchmark`
- `/blog/context-rot-long-research-projects`
- `/blog/writing-v3-living-evidence-packet`

## Evidence sources

1. Long-form quote benchmark v0.2:
   - `benchmarks/quote-retrieval/runs/model-matrix-v02-2026-07-13/MODEL_MATRIX_REPORT.md`
   - `benchmarks/quote-retrieval/runs/model-matrix-v02-2026-07-13/MODEL_MATRIX_SUMMARY.json`
   - `benchmarks/quote-retrieval/README.md`
2. Context-integrity stress run v0.4:
   - `benchmarks/context-integrity/runs/luna-stress-v04-2026-07-13/RUN_REPORT.md`
   - `benchmarks/context-integrity/runs/luna-stress-v04-2026-07-13/score-matrix.json`
   - `benchmarks/context-integrity/README.md`
3. Writing V3 design implementation:
   - Git commit `ea948f3` (`docs/WRITING_V3.md`, retrieval and quote-audit implementation)
   - Git commit `687c3a0` (adaptive retrieval and claim-to-quote benchmark)
4. Result graphics reviewed from:
   - `outputs/scholarmark-context-harness/slide-1.png` through `slide-6.png`

Some benchmark artifacts live in a separate local worktree or generated-output directory. Preserve the exact report files before revising any public number.

## Approved narrow claims

- The updated context harness averaged 0.9917 quote integrity across five frozen reader targets under the equal-8K policy-memory condition.
- Raw context averaged 0.5583 and the former harness averaged 0.5533 in the same aggregate.
- Updated context recorded 30 wins, 10 ties, and zero losses against raw context across 40 paired model-case comparisons.
- Updated equal-8K packets used about 84% fewer input tokens than complete full-context packets.
- In the separate eight-case context-integrity stress suite under an estimated 4K policy-memory cap, the ScholarMark composite scored 0.9643.
- That composite used 45.9% fewer reader input tokens than its unconstrained condition and had no per-case loss to an equal-budget baseline.

## Required limitations

- Both headline suites are internal, deterministic, and synthetic/generated.
- The quote benchmark has eight cases. All 120 equal-budget rows completed; 239 of 240 total authoritative rows completed.
- The context-integrity suite has eight cases. Marginal confidence intervals overlap; paired intervals on the repeated cases favored the composite.
- These results do not establish a universal best-memory-system claim.
- A held-out real-PDF set, external LongMemEval-style confirmation, and public immutable artifacts remain future work.
- The direct OpenAI production key was quota-blocked; the completed OpenAI reader was explicitly routed through OpenRouter.
- Never claim that the system eliminates hallucinations or removes the student's verification responsibility.

## Product-language boundary

Describe Writing V3 as a development architecture or evaluated development system unless its production availability has been separately confirmed. Do not imply that every public ScholarMark session already uses the exact benchmarked branch.
