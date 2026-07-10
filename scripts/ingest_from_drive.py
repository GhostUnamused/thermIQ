"""
Drive-link ingestion worker — runs inside .github/workflows/drive-ingest.yml.

Reads ingest_jobs/{INGEST_JOB_ID} from Firestore, downloads the publicly
shared Google Drive file (gdown handles Drive's large-file "can't scan for
viruses" confirm page), then runs the CANONICAL ingest engine
scripts/ingest_documents.py as a subprocess — same chunking/embedding/
Firestore-record code path as every other document, zero logic duplication.

Job status lifecycle: queued -> processing -> done | failed (error recorded).

Env (set by the workflow): INGEST_JOB_ID, FIREBASE_*, JINA_API_KEY, QDRANT_*.
"""
import os
import subprocess
import sys
import tempfile

import firebase_admin
from firebase_admin import credentials, firestore


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
    file_id     = job.get("drive_file_id", "")
    doc_name    = job.get("doc_name", "") or "Untitled Document"
    doc_type    = job.get("doc_type", "manual")
    client_name = job.get("client_name", "")
    source_url  = job.get("source_url", "")  # Drive /preview link — enables in-app preview

    if not file_id or not client_name:
        job_ref.set({"status": "failed", "error": "Job record missing drive_file_id or client_name."}, merge=True)
        sys.exit(1)

    job_ref.set({"status": "processing"}, merge=True)

    try:
        import gdown  # installed by the workflow alongside requirements.txt

        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = os.path.join(tmp, "document.pdf")
            print(f"Downloading Drive file {file_id} ...")
            out = gdown.download(id=file_id, output=pdf_path, quiet=False)
            if not out or not os.path.exists(pdf_path) or os.path.getsize(pdf_path) == 0:
                raise RuntimeError(
                    "Drive download failed — is the file shared as 'Anyone with the link'? "
                    "(Restricted files cannot be downloaded by the ingest worker.)"
                )
            size_mb = os.path.getsize(pdf_path) / (1024 * 1024)
            print(f"Downloaded {size_mb:.1f} MB. Running canonical ingest engine ...")

            # Basic sanity: PDFs start with %PDF. A restricted/deleted file often
            # downloads as an HTML error page instead — catch that early with a
            # clear message rather than a confusing pypdf parse error.
            with open(pdf_path, "rb") as f:
                if f.read(5) != b"%PDF-":
                    raise RuntimeError(
                        "Downloaded content is not a PDF — the link is likely restricted, "
                        "deleted, or points to a folder rather than a single PDF file."
                    )

            script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ingest_documents.py")
            result = subprocess.run(
                [sys.executable, script, pdf_path, doc_type, doc_name, source_url, client_name],
                capture_output=True, text=True,
            )
            print(result.stdout)
            if result.returncode != 0:
                print(result.stderr, file=sys.stderr)
                raise RuntimeError(f"ingest_documents.py failed: {(result.stderr or 'unknown error')[-500:]}")

        job_ref.set({"status": "done", "error": "", "finished_at": firestore.SERVER_TIMESTAMP}, merge=True)
        print(f"Job {job_id} complete.")
    except Exception as e:  # noqa: BLE001 — always record failure on the job
        job_ref.set({"status": "failed", "error": str(e)[:1000], "finished_at": firestore.SERVER_TIMESTAMP}, merge=True)
        print(f"Job {job_id} FAILED: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
