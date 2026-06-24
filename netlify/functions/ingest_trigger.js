exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      status: 'ingestion_is_local',
      message:
        'Run python scripts/ingest_documents.py <path_to_pdf> to ingest documents.',
    }),
  };
};
