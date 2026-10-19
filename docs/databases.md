# Databases

Databases live in the shared ARGUS data volume alongside projects. They are available across projects and have stable database, field and row IDs. Their records are separate from graph nodes. A search materializes a snapshot of each matching record, preserving database revision, row and field provenance. Deleting or editing a database does not rewrite earlier graph findings.

## Schema and records

Create a database from the main-menu Databases tab. Add named fields using values, text, numbers, booleans, email, phone, URL, images, files, date/time or structured JSON. JSON fields preserve arrays and objects; image/file fields support multiple locally stored attachments. Rename fields or remove them with confirmation. Existing field types stay stable; create a new field for a type conversion. Record edits, schema changes and deletion use optimistic revision checks to prevent silent overwrites from another tab.

Rows are shown in searchable pages of 100. Limits are 200 fields, 100,000 rows per database, and 2 MiB of encoded cell data per row. Uploaded file content is stored separately, not embedded in JSON. Back up the entire ARGUS data volume, including its existing encryption keys and files.

## Import

1. Choose an existing database or create a new one through the import workbench.
2. Upload or drop files. Choose automatic table recognition, one row per file, or all attachments in one row.
3. Generate a preview. Configure the header row, delimiter, encoding, spreadsheet sheet or optional JSON record-list path when needed, then regenerate the preview after a format change.
4. Map each source column to an existing field, a new named field or Skip. Matching names are suggested automatically. Inspect the first ten rows.
5. Confirm. Schema additions and all rows are committed in one transaction; a consumed preview cannot be applied twice. A conflicting database revision requires a fresh preview/selection.

Structured formats: CSV, TSV, XLSX, ODS, JSON, JSONL/NDJSON, XML and delimited/plain text. XLSX/ODS readers use the Python standard library and do not execute formulas, macros, links or external relationships. Cached formula values are imported. Native spreadsheet formatting and date serial formatting are not interpreted; review the preview. A single unambiguous JSON record array is detected automatically; an explicit dotted record-list path can select another list. Nested JSON objects become dotted field paths; arrays remain JSON values. XML supports a root containing repeated record elements. Other formats, including PDFs and legacy binary XLS files, are retained as file attachments rather than silently misparsed as tables.

Each import accepts up to 200 files, 10,000 rows and 300,000 cells, with 32 MiB of structured input/decoded spreadsheet data. Files retain the existing 128 MiB individual upload limit. Attachment-only imports do not read image bytes into table JSON. Abandoned previews expire after one day when another preview is created. Import staging and database records participate in file-reference retention.

## Graph tools

Add a Database node and select the database. Connect **Search database** to it and a value, username, email, phone or URL node. Choose the reference column in the first-run dialog or tool details. Exact, contains and prefix matching are supported, with a case-sensitivity option. Phone searches normalize punctuation. Records are emitted as separate groups containing all populated fields, including media. The configured result limit or remaining graph capacity produces a partial-result warning when reached.

DeepFace retains two-image verification and also accepts one image plus one Database node. Select an image field. Matching rows become complete record groups with distance/threshold provenance and optional overlays. Multiple images in a row are supported and a matched row is emitted once. Comparison/time/capacity limits and failed comparisons produce incompleteness warnings. Original images are retained, including the existing 40 MP working-copy confirmation flow. This adapter is invoked only by an explicit user run; no comparisons are initiated by installation or import.

## API

- `GET /api/databases`: schema/revision/count list.
- `GET /api/databases/:id?offset=0&q=...`: metadata and paged records.
- `POST /api/databases`: create with `title`, `fields`.
- `POST /api/databases/:id`: `revision` plus `operation`: `schema`, `rows`, `delete_rows` or `delete`.
- `POST /api/databases/import/preview`: uploaded `files` IDs and parsing options; returns immutable preview ID, columns, samples and counts.
- `POST /api/databases/import/commit`: preview ID, target/revision or title, and explicit column mapping.

These routes use the existing session/CSRF and bounded-request transport. SQL uses parameters throughout. Image cells are checked against actual uploaded-image metadata. Import and tool modules share the repository rather than copying database JSON into graph inputs.
