# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kleponrachel/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kleponrachel/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for make.fun's own csv-reader 1.0.0: it answers exactly as
csv-reader does on every input `{text, header}` — `{columns, rows, errors}`
— but reads the text in a single pass driven by `indexOf` and `slice`
instead of one character at a time.

## How it is fast

- A record whose line holds no quote and no stray CR is cut out with
  `indexOf('\n')` and split on commas — no per-character loop, no per-field
  function calls.
- Only lines with a quote or a stray CR go through the field-by-field
  scanners, and those are also `indexOf`-driven, each search bounded to the
  piece of text it can still affect, so no scan ever runs away to the end
  of the file.
- V8's incremental marking is off, as the house baseline runs it
  (`--no-incremental-marking` in `main.ts`).

## Layout

- `solve.js` — the parser; `run(input)` returns csv-reader's answer.
- `main.ts` — the harness driver: reads `/input/cases.json`, writes
  `/output/answers.json`.

## License

MIT — see `LICENSE`.
