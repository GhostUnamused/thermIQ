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
      .collection('cea_outages')
      .orderBy('date_out', 'desc')
      .limit(30)
      .get();

    const outages = snapshot.docs.map((doc) => doc.data());

    const total_forced_outages = outages.filter((o) => o.outage_type === 'forced').length;
    const total_mw_lost = outages.reduce((sum, o) => sum + (o.mw_lost || 0), 0);
    const total_revenue_lost_cr =
      Math.round(outages.reduce((sum, o) => sum + (o.revenue_lost_est_cr || 0), 0) * 10) / 10;

    const outages_by_equipment = {};
    outages.forEach((o) => {
      const tag = o.equipment_tag || 'Other';
      outages_by_equipment[tag] = (outages_by_equipment[tag] || 0) + 1;
    });

    return res.status(200).json({
      outages,
      total_forced_outages,
      total_mw_lost,
      total_revenue_lost_cr,
      outages_by_equipment,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
