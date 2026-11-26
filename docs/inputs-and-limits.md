# Inputs and limits

This page lists the sources that AiTM accepts, the size caps, and the checks that
connect each claim to its evidence.

## Accepted inputs

- Local folders/repositories and individual UTF-8 code, config, text, Markdown,
  HTML, CSV, JSON, YAML, and other readable text files.
- PDF and DOCX documents; scanned/image-only documents need OCR or a transcription.
- Public HTTPS repositories on GitHub, GitLab and Bitbucket. A shallow clone is
  pinned to a commit, snapshotted and deleted; no hooks or submodules are run.
  Use a local checkout for private repositories or other Git hosts.
- Public HTTPS code/text, HTML pages, PDF, DOCX and ZIP URLs (8 MiB, 30 seconds,
  three redirects). A page is preserved as HTML source; AiTM does not execute page
  scripts, crawl links or fetch embedded documents. Use a direct PDF/DOCX link to
  assess the document itself.
- Repository ZIPs from local files, browser uploads or public URLs. Archives have
  an 8 MiB compressed limit, 32 MiB expanded limit and at most 10,000 entries.
  Extraction rejects unsafe/ambiguous paths, encrypted entries and special files;
  skips symlinks, credentials and dependencies; and honors nested `.gitignore`.
  Temporary extraction files are removed. Nested archives are skipped.
- Inline text and file snapshots pushed over the API. A file snapshot may contain
  UTF-8 text or base64 PDF/DOCX/ZIP data; replacing it invalidates dependent analysis.

Folder ingestion honors nested `.gitignore` rules and skips dependencies, generated
folders, credential filenames, symlinks and unsupported binaries. Caps are 8 MiB per
file, 32 MiB / 1,000 files per source and 100 sources / 2,000 files per project.
Extracted text is bounded to 8 million characters (8 × 1024²) per file and
32 million (32 × 1024²) per source/project. Accepted files are stored in full;
oversized inputs produce an explicit error or a recorded folder-skip diagnostic,
never a truncated document. Scope shows import diagnostics, including unreadable
or skipped files. Inline API text is limited to 500,000 characters per request.

## How the pipeline reads sources

Classification quickly identifies a provisional profile from the inventory and scope.
TRACE model construction then reads **all accepted source text**, in sequential
batches of up to 180,000 numbered source characters. Later batches return new or
changed objects; the engine retains earlier findings and validates the merged model.
The model is saved only after every batch finishes. STRIDE, attack trees,
coordination and the report reason from the completed artifacts, without rereading
the repository at every step. Seven source batches therefore require 12 normal
provider calls for a full run with coordination, rather than 36.

Cross-phase references are constrained to existing model IDs. Citation mismatches
and unresolved optional links become explicit review notes without regenerating
whole responses. Broken required relationships still get one bounded repair.
Progress shows the current source batch during model construction. Complete source
delivery does not guarantee that an AI identifies every issue.

## Older snapshots

Older saved snapshots marked as truncated are refreshed from their original local
file or URL before a new run, and affected analysis is rebuilt. Old analysis made
from prompt excerpts is also rebuilt. Portable snapshots need their complete
originals supplied again if they were truncated. Until rebuilt, affected reports
show a brief incomplete-source notice. Routine import diagnostics are not repeated
in a generic report section; actual unresolved questions and unverified claims remain.

## Evidence checks

Snapshots have file IDs, hashes and line references. Model claims need matching
source quotes or explicit assumptions. The engine validates object references,
STRIDE coverage of assets/invariants/edges, tree connectivity and roadmap links.
If a generated quote occurs exactly once in its cited file, the engine can correct
mistaken line numbers and records the correction in generation metadata. It never
fuzzy-matches invented quotes; ambiguous references are not accepted as verified
evidence. A citation problem gets one automatic correction attempt. If it remains
unresolved, the claim is explicitly marked **Evidence review required** and the
sequential pipeline continues. Valid citations stay attached; rejected quotes are
retained only in diagnostic metadata. Review notes appear in the TUI and reports
and carry into downstream analysis as uncertainty. Citation retries cannot discard
an otherwise usable draft.
Coverage links are computed from the threats' object references. Missing coverage
is explicitly flagged for review, and corrections are retained in generation metadata.
These checks establish traceability; they cannot establish whether an AI judgement
is correct. Source text is treated as evidence, never instructions.
