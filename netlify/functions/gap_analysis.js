const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
};

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
    const snapshot = await db
      .collection('risk_scores')
      .orderBy('risk_score_cr', 'desc')
      .limit(20)
      .get();

    const gaps = snapshot.docs.map((doc) => ({
      gap_id: doc.id,
      ...doc.data(),
    }));

    const total_risk_cr = gaps.reduce(
      (sum, g) => sum + (g.risk_score_cr || 0),
      0
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        gaps,
        total_risk_cr: Math.round(total_risk_cr * 10) / 10,
        gap_count: gaps.length,
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
