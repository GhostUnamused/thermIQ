/**
 * ingest_trigger — stub endpoint
 * Ingestion is handled locally via scripts/ingest_documents.py
 * or via POST /api/ingest_document for browser uploads.
 */
const setCors = require('./_cors');

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({
    message: 'Ingestion is handled locally via scripts/ingest_documents.py or via /api/ingest_document for PDF uploads.',
  });
};
