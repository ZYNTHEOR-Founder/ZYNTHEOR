# Gate 6: pluggable brain + task benchmark

New files only (nothing existing is modified):

| File | Purpose |
|---|---|
| `qplus_native/brain.py` | `TemplateBrain` (old deterministic behaviour), `ModelBrain` (any `complete(system, user) -> text`), an HTTP adapter for Anthropic, `run_task()` reporting each stage |
| `qplus_native/agent_bench.py` | 11 tasks with hidden check scripts; reports pass rate per stage and `false_success` |
| `tests/agent_reference.py`, `tests/test_agent_pipeline.py` | 15 tests using scripted fake models (no network, no keys) |

## Run

```bash
python3 -m pytest tests/test_agent_pipeline.py -q                 # 15 tests
python3 -m qplus_native.agent_bench --brain template --out bench_template.json   # baseline

export ZYNTHEOR_BRAIN_PROVIDER=anthropic
export ZYNTHEOR_BRAIN_MODEL=<model name>     # no default on purpose; names go stale
export ANTHROPIC_API_KEY=...                 # environment only, never committed
python3 -m qplus_native.agent_bench --brain model --out bench_model.json
```

## Reading the report

* `delivered` - the brain's own plan passed its own acceptance checks and the zip verified.
* `hidden_ok` - the code passes a check script the brain never saw.
* `false_success` = delivered but not hidden_ok. This is the honesty metric: the baseline template brain delivers
  11/11 tasks and solves 0/11, because its generated project never touches the requested function.
* `stage_reached_ok` - how many tasks got past understand / plan / build / test / repair / deliver.

## Safety properties (tested)

* Model output is data: parsed as JSON, validated by `orchestrator.validate_plan` plus size/path limits.
* Everything executes through `Sandbox` (path jail, allowlisted commands, resource limits, audit chain).
  A plan that asks for `python3 -c ...` ends as `build` failed with the Sandbox refusal.
* A reply with a `../` path is rejected before anything runs; retries are bounded (default 3 per stage).
* Adapter errors never include the provider's message or the key.

## Known limits

* `make_http_complete` follows the public API shape of the provider but was NOT run against the live service
  here (no network or key in the test environment). Run the benchmark once and read the first failures.
* Tasks are small stdlib-only functions. Passing them says the loop works; it does not prove larger-project ability.
* Hidden checks are only as good as their authors: add tasks, especially ones that resemble your real work.
