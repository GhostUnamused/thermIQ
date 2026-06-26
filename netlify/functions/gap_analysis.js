const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
};

const DEFAULT_CLIENT = 'ntpc';

let app;
if (!getApps().length) {
  app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
} else {
  app = getApp();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  try {
    const db = getFirestore(app);

    const rawClient = (event.queryStringParameters && event.queryStringParameters.client_name) || '';
    const clientName = (rawClient || DEFAULT_CLIENT).toString().trim().toLowerCase();

    const riskRef = db.collection('risk_scores');

    // Primary: namespaced records for this client (client_name field on each doc).
    const snapshot = await riskRef.where('client_name', '==', clientName).get();
    let gaps = snapshot.docs.map((doc) => ({ gap_id: doc.id, ...doc.data() }));

    // Back-compat fallback: legacy global set (docs written before namespacing).
    if (gaps.length === 0) {
      const legacy = await riskRef.get();
      gaps = legacy.docs
        .map((doc) => ({ gap_id: doc.id, ...doc.data() }))
        .filter((g) => !g.client_name);
    }

    gaps.sort((a, b) => (b.risk_score_cr || 0) - (a.risk_score_cr || 0));
    gaps = gaps.slice(0, 20);

    const total_risk_cr = gaps.reduce((sum, g) => sum + (g.risk_score_cr || 0), 0);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        gaps,
        total_risk_cr: Math.round(total_risk_cr * 10) / 10,
        gap_count: gaps.length,
        client_name: clientName,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
