# `POST /api/stats`: All Stats graphs

## Scope and dependencies

Implement the lazy-loaded All Stats endpoint using [00-shared-api-contract.md](00-shared-api-contract.md). It is a read-only aggregate endpoint and must not call Spotify during the request.

## Purpose

Return the seven graphs displayed by the All Stats page for one requested range.

## Time-series buckets

Use the shared range request body. The server chooses one chronological bucket list per response and uses that exact list for every series:

| Range | Bucket size | Target bucket count |
| --- | --- | --- |
| 4 weeks | UTC day | 28 |
| 6 months | Evenly sized UTC intervals | 90 |
| All time | Evenly sized UTC intervals from first retained play to now | 120 |

Every `labels` array is chronological and exactly aligns with its `values` array. Use concise labels such as `"Oct 9"`, `"Oct 6–12"`, or `"Oct 2026"`. Do not compress older data into a few wide buckets; bucket widths must stay uniform within a response.

## Successful response

```json
{
  "error": "",
  "stats": {
    "topArtistsByPlays": [{ "name": "Solstice FM", "value": 42 }],
    "listeningDistribution": { "labels": ["Oct 9"], "values": [81] },
    "topArtistsByMinutes": [{ "name": "Solstice FM", "value": 156 }],
    "songsListened": { "labels": ["Oct 9"], "values": [24] },
    "artistsListened": { "labels": ["Oct 9"], "values": [12] }
  }
}
```

## Metric definitions

| Response field | Graph | Definition |
| --- | --- | --- |
| `topArtistsByPlays` | Bar | Up to 10 artists ranked by completed plays. Credit every artist once per play; ties use listening duration then name. |
| `listeningDistribution` | Bar | Active listening minutes per bucket; round only after summing the bucket. |
| `topArtistsByMinutes` | Bar | Up to 10 artists ranked by active listening minutes. Credit full duration to each collaborator; artist-centric totals need not equal listener total. |
| `songsListened` | Line | Completed plays per bucket, including repeats. |
| `artistsListened` | Line | Distinct credited artists with at least one play per bucket. |

For empty buckets, return `0` for plays, artists, and listening minutes. This keeps all chart values numeric and aligned.

## Required tests

- Reject invalid ranges; enforce user isolation and UTC cutoff boundaries.
- Verify every series has the same ordered labels and matching value counts for each range.
- Verify each metric above, including repeat plays, collaboration credits, and no-play buckets.
- Verify response limits and no sensitive/unowned data exposure.
