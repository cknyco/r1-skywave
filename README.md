# data-log

Written by the `pages` workflow after each build with fresh station data; never merged into `main`.

- `snapshot.json`: every station in the deployed dataset, keyed by Radio Browser uuid, with name, place, country and the date it was first seen.
- `changes/YYYY-MM-DD.md`: stations added and removed since the previous run.
- `changes/latest.json`: the counts of the latest run.

The build job reads `snapshot.json` to publish `data/new.json`, the stations first seen in the last 14 days.
Station names come from Radio Browser; the Markdown logs escape them.
