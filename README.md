# data-log

Written by the `pages` workflow after each build with fresh station data; never merged into `main`.

- `snapshot.json`: every station in the deployed dataset, keyed by Radio Browser uuid, with name, place, country, the date it was first seen and a short hash of its stream URL.
- `day-base.json`: the last snapshot of the previous UTC day.
- `changes/YYYY-MM-DD.md`: stations added, removed and changed (the same stream under a new uuid: renamed, moved or re-listed) since the end of the previous day. Later runs on the same day replace it; a day whose changes cancel out has none.
- `changes/latest.json`: the counts behind the latest day file.

The build job reads `snapshot.json` to keep each stream on the listing it had before and to publish `data/new.json`, the stations first seen in the last 14 days.
Station names come from Radio Browser; the Markdown logs escape them.
