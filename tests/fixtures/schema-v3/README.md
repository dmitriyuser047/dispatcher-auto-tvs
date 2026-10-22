These are the exact Git blob bytes of the previous schema3 implementation from
commit `d527ddf6c576726695d92a1994a3020da9d5b0ee`. `source-sha256.json` records their
paths and SHA-256 hashes. They are intentionally frozen, including formatting.

`operation-history25-old-writer.test.cjs` loads this actual older module graph
against synthetic current schema4 databases. It requires rejection before any
business-row read, SQLite connection, service-file write, or sidecar creation.
The separate schema-v2 fixtures remain unchanged.
