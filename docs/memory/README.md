# OpenComms local memory artifacts

This directory holds sanitized, locally generated Markdown artifacts that can be ingested into local recall store for OpenComms cross-channel recall. Regenerate them from local transcript JSONL with `npm run memory:export -- --limit 500`, then ingest with `npm run memory:ingest`.

Do not place raw transcript firehoses, relay tokens, `.secrets` contents, API keys, bearer tokens, or private config values here. The exporter drops secret-looking transcript entries before writing, and generated `docs/memory/opencomms/*.md` files are intentionally git-ignored except for `.gitkeep`.
