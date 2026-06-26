const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const setCors = require('./_cors');

const DEFAULT_CLIENT = 'ntpc';

let app;
if (!getApps().length) {
  app = initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
} else {
  app = getApp();
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const db = getFirestore(app);

    // Read client_name from query string, tolerating runtimes that don't pre-parse req.query.
    let rawClient = req.query && req.query.client_name;
    if (!rawClient && req.url) {
      try {
        rawClient = new URL(req.url, 'http://localhost').searchParams.get('client_name');
      } catch (_) { /* ignore */ }
    }
    const clientName = (rawClient || DEFAULT_CLIENT).toString().trim().toLowerCase();

    const riskRef = db.collection('risk_scores');

    // Primary: namespaced records for this client (client_name field on each doc).
    const snapshot = await riskRef.where('client_name', '==', clientName).get();
    let gaps = snapshot.docs.map((doc) => ({ gap_id: doc.id, ...doc.data() }));

    // Back-compat fallback: if no namespaced records exist yet (pre-migration),
    // return the legacy global set (docs written before namespacing had no client_name).
    if (gaps.length === 0) {
      const legacy = await riskRef.get();
      gaps = legacy.docs
        .map((doc) => ({ gap_id: doc.id, ...doc.data() }))
        .filter((g) => !g.client_name);
    }

    // Sort + cap in JS (avoids a Firestore composite index on where + orderBy).
    gaps.sort((a, b) => (b.risk_score_cr || 0) - (a.risk_score_cr || 0));
    gaps = gaps.slice(0, 20);

    const total_risk_cr = gaps.reduce((sum, g) => sum + (g.risk_score_cr || 0), 0);

    return res.status(200).json({
      gaps,
      total_risk_cr: Math.round(total_risk_cr * 10) / 10,
      gap_count: gaps.length,
      client_name: clientName,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
