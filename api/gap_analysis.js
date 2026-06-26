const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const setCors = require('./_cors');

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
    const snapshot = await db
      .collection('risk_scores')
      .orderBy('risk_score_cr', 'desc')
      .limit(20)
      .get();

    const gaps = snapshot.docs.map((doc) => ({
      gap_id: doc.id,
      ...doc.data(),
    }));

    const total_risk_cr = gaps.reduce((sum, g) => sum + (g.risk_score_cr || 0), 0);

    return res.status(200).json({
      gaps,
      total_risk_cr: Math.round(total_risk_cr * 10) / 10,
      gap_count: gaps.length,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
