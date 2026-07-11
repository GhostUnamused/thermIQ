"""
Drive-link ingestion worker — runs inside .github/workflows/drive-ingest.yml.

Reads ingest_jobs/{INGEST_JOB_ID} from Firestore and handles three link kinds:

  file    — a single shared Drive file (pdf/docx/xlsx/csv/txt). Downloaded with
            gdown, then run through the CANONICAL ingest engine
            scripts/ingest_documents.py as a subprocess — same chunking/
            embedding/Firestore code path as every other document.
  gdoc    — a native Google Doc / Sheet / Slides link. Downloaded via the
            public export endpoint (Docs→pdf, Sheets→xlsx, Slides→pdf).
  folder  — a shared Drive folder. Every supported file inside is ingested.
            With sync=true the folder is DIFFED against what was previously
            ingested from it: new files are added, files removed from the
            folder are deleted from Qdrant + Firestore.

Relevance screening: ingest_documents.py runs a Gemini gate on client docs and
exits 3 on rejection — rejected files are recorded on the job, not fatal for
folder runs.

Job status lifecycle: queued -> processing -> done | failed (error recorded).

Env (set by the workflow): INGEST_JOB_ID, FIREBASE_*, JINA_API_KEY, QDRANT_*,
GEMINI_API_KEY (optional — enables relevance screening).
"""
import os
import re
import subprocess
import sys
import tempfile

import firebase_admin
from firebase_admin import credentials, firestore

SUPPORTED_EXT = {"pdf", "docx", "xlsx", "csv", "txt"}
GDOC_EXPORT = {
    "document":      ("pdf",  "https://docs.google.com/document/d/{id}/export?format=pdf"),
    "spreadsheets":  ("xlsx", "https://docs.google.com/spreadsheets/d/{id}/export?format=xlsx"),
    "presentation":  ("pdf",  "https://docs.google.com/presentation/d/{id}/export/pdf"),
}


def get_firestore_client():
    try:
        app = firebase_admin.get_app("thermiq")
    except ValueError:
        cred = credentials.Certificate(
            {
                "type": "service_account",
                "project_id": os.environ["FIREBASE_PROJECT_ID"],
                "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
                "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        )
        app = firebase_admin.initialize_app(cred, name="thermiq")
    return firestore.client(app=app)


def pretty_name(filename):
    stem = os.path.splitext(os.path.basename(filename))[0]
    return re.sub(r"[_-]+", " ", stem).strip() or "Untitled Document"


def sanity_check(path):
    """Catch Drive permission/HTML error pages masquerading as downloads."""
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    with open(path, "rb") as f:
        head = f.read(64)
    if head.lstrip()[:5].lower() in (b"<!doc", b"<html"):
        raise RuntimeError(
            "Downloaded content is an HTML page, not a document — the link is likely "
            "restricted or deleted. Set sharing to 'Anyone with the link'."
        )
    if ext == "pdf" and not head.startswith(b"%PDF-"):
        raise RuntimeError(
            "Downloaded content is not a PDF — the link is likely restricted, deleted, "
            "or points to something other than a PDF file."
        )


def run_ingest_engine(path, doc_type, doc_name, source_url, client_name,
                      drive_file_id="", origin_folder_id="", skip_relevance=False):
    """Run the canonical engine. Returns (ok, rejected, message)."""
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ingest_documents.py")
    env = dict(os.environ)
    if drive_file_id:
        env["THERMIQ_DRIVE_FILE_ID"] = drive_file_id
    if origin_folder_id:
        env["THERMIQ_ORIGIN_FOLDER_ID"] = origin_folder_id
    if skip_relevance:
        env["THERMIQ_SKIP_RELEVANCE"] = "1"
    result = subprocess.run(
        [sys.executable, script, path, doc_type, doc_name, source_url, client_name],
        capture_output=True, text=True, env=env,
    )
    print(result.stdout)
    if result.returncode == 0:
        return True, False, ""
    if result.returncode == 3:
        msg = (result.stderr or "").strip().splitlines()[-1] if result.stderr else "rejected by relevance screening"
        return False, True, msg
    print(result.stderr, file=sys.stderr)
    return False, False, f"ingest engine failed: {(result.stderr or 'unknown error')[-400:]}"


def delete_document_everywhere(db, doc_snap):
    """Remove a document record + its Qdrant chunks + meta counters (sync removals)."""
    from qdrant_client import QdrantClient

    data = doc_snap.to_dict()
    doc_name = data.get("doc_name", "")
    chunks = data.get("chunks_indexed", 0)
    client = QdrantClient(url=os.environ["QDRANT_URL"], api_key=os.environ["QDRANT_API_KEY"], timeout=120)
    client.delete(
        collection_name="thermiq_chunks",
        points_selector={"filter": {"must": [{"key": "source_doc", "match": {"value": doc_name}}]}},
    )
    doc_snap.reference.delete()
    db.collection("system_meta").document("config").set(
        {
            "total_chunks_indexed": firestore.Increment(-chunks),
            "documents_ingested": firestore.ArrayRemove([doc_name]),
        },
        merge=True,
    )
    print(f"  Sync-removed '{doc_name}' ({chunks} chunks).")


def download_single_file(file_id, out_dir):
    """gdown a single file preserving its Drive filename. Returns local path."""
    import gdown

    out = gdown.download(id=file_id, output=out_dir + os.sep, quiet=False, fuzzy=True)
    if not out or not os.path.exists(out) or os.path.getsize(out) == 0:
        raise RuntimeError(
            "Drive download failed — is the file shared as 'Anyone with the link'? "
            "(Restricted files cannot be downloaded by the ingest worker.)"
        )
    return out


def download_gdoc(gdoc_type, file_id, out_dir):
    import requests

    ext, url_tpl = GDOC_EXPORT.get(gdoc_type, GDOC_EXPORT["document"])
    url = url_tpl.format(id=file_id)
    path = os.path.join(out_dir, f"google_doc_{file_id}.{ext}")
    r = requests.get(url, timeout=120, allow_redirects=True)
    if r.status_code != 200 or not r.content:
        raise RuntimeError(
            f"Google Docs export failed (HTTP {r.status_code}) — is the document shared as "
            "'Anyone with the link'?"
        )
    with open(path, "wb") as f:
        f.write(r.content)
    return path


def main():
    job_id = os.environ.get("INGEST_JOB_ID", "").strip()
    if not job_id:
        print("INGEST_JOB_ID env var missing.", file=sys.stderr)
        sys.exit(1)

    db = get_firestore_client()
    job_ref = db.collection("ingest_jobs").document(job_id)
    snap = job_ref.get()
    if not snap.exists:
        print(f"ingest_jobs/{job_id} not found in Firestore.", file=sys.stderr)
        sys.exit(1)

    job = snap.to_dict()
    file_id        = job.get("drive_file_id", "")
    link_kind      = job.get("link_kind", "file") or "file"
    gdoc_type      = job.get("gdoc_type", "")
    is_sync        = bool(job.get("sync"))
    skip_relevance = bool(job.get("skip_relevance_check"))
    doc_name       = job.get("doc_name", "") or ""
    name_given     = bool(job.get("doc_name_given", True))
    doc_type       = job.get("doc_type", "manual")
    client_name    = job.get("client_name", "")
    source_url     = job.get("source_url", "")

    if not file_id or not client_name:
        job_ref.set({"status": "failed", "error": "Job record missing drive_file_id or client_name."}, merge=True)
        sys.exit(1)

    job_ref.set({"status": "processing"}, merge=True)

    try:
        with tempfile.TemporaryDirectory() as tmp:
            if link_kind == "gdoc":
                path = download_gdoc(gdoc_type, file_id, tmp)
                name = doc_name if name_given and doc_name else pretty_name(path)
                sanity_check(path)
                ok, rejected, msg = run_ingest_engine(
                    path, doc_type, name, source_url, client_name,
                    drive_file_id=file_id, skip_relevance=skip_relevance,
                )
                if rejected:
                    raise RuntimeError(f"Rejected by relevance screening: {msg}. "
                                       "Re-upload with 'Skip AI relevance check' if this is legitimate.")
                if not ok:
                    raise RuntimeError(msg)

            elif link_kind == "folder":
                import gdown

                folder_dir = os.path.join(tmp, "folder")
                os.makedirs(folder_dir, exist_ok=True)
                print(f"Downloading Drive folder {file_id} ...")
                paths = gdown.download_folder(id=file_id, output=folder_dir, quiet=False, use_cookies=False)
                if paths is None:
                    raise RuntimeError(
                        "Drive folder download failed — is the folder shared as 'Anyone with the link'?"
                    )
                local_files = []
                for root, _, files in os.walk(folder_dir):
                    for fn in files:
                        if os.path.splitext(fn)[1].lower().lstrip(".") in SUPPORTED_EXT:
                            local_files.append(os.path.join(root, fn))
                print(f"Folder contains {len(local_files)} supported file(s).")

                # Previously-ingested docs from this folder (for dedupe + sync deletes)
                existing_snap = (
                    db.collection("documents")
                    .where("client_name", "==", client_name)
                    .get()
                )
                from_folder = [d for d in existing_snap if d.to_dict().get("origin_folder_id") == file_id]
                existing_names = {d.to_dict().get("doc_name", "") for d in from_folder}
                current_names = {pretty_name(p) for p in local_files}

                ingested, skipped, rejected_files = 0, 0, []
                for path in sorted(local_files):
                    name = pretty_name(path)
                    if name in existing_names:
                        print(f"  Skipping '{name}' — already ingested from this folder.")
                        skipped += 1
                        continue
                    try:
                        sanity_check(path)
                    except RuntimeError as e:
                        rejected_files.append(f"{name}: {e}")
                        continue
                    ok, was_rejected, msg = run_ingest_engine(
                        path, doc_type, name, "", client_name,
                        origin_folder_id=file_id, skip_relevance=skip_relevance,
                    )
                    if ok:
                        ingested += 1
                    elif was_rejected:
                        rejected_files.append(f"{name}: {msg}")
                    else:
                        rejected_files.append(f"{name}: {msg}")

                removed = 0
                if is_sync:
                    for d in from_folder:
                        if d.to_dict().get("doc_name", "") not in current_names:
                            delete_document_everywhere(db, d)
                            removed += 1

                summary = f"Ingested {ingested}, skipped {skipped} already-indexed"
                if is_sync:
                    summary += f", removed {removed} deleted-from-folder"
                if rejected_files:
                    summary += f". Not ingested: {'; '.join(rejected_files)[:600]}"
                job_ref.set({"folder_summary": summary}, merge=True)
                print(summary)
                if ingested == 0 and removed == 0 and rejected_files and skipped == 0:
                    raise RuntimeError(summary)

            else:  # single file
                print(f"Downloading Drive file {file_id} ...")
                path = download_single_file(file_id, tmp)
                ext = os.path.splitext(path)[1].lower().lstrip(".")
                if ext not in SUPPORTED_EXT:
                    raise RuntimeError(
                        f"Unsupported file type '.{ext}' — supported: PDF, DOCX, XLSX, CSV, TXT."
                    )
                sanity_check(path)
                size_mb = os.path.getsize(path) / (1024 * 1024)
                print(f"Downloaded {size_mb:.1f} MB. Running canonical ingest engine ...")
                name = doc_name if name_given and doc_name else pretty_name(path)
                ok, rejected, msg = run_ingest_engine(
                    path, doc_type, name, source_url, client_name,
                    drive_file_id=file_id, skip_relevance=skip_relevance,
                )
                if rejected:
                    raise RuntimeError(f"Rejected by relevance screening: {msg}. "
                                       "Re-upload with 'Skip AI relevance check' if this is legitimate.")
                if not ok:
                    raise RuntimeError(msg)

        job_ref.set({"status": "done", "error": "", "finished_at": firestore.SERVER_TIMESTAMP}, merge=True)
        print(f"Job {job_id} complete.")
    except Exception as e:  # noqa: BLE001 — always record failure on the job
        job_ref.set({"status": "failed", "error": str(e)[:1000], "finished_at": firestore.SERVER_TIMESTAMP}, merge=True)
        print(f"Job {job_id} FAILED: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
