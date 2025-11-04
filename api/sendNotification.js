// /api/sendNotification.js
import admin from 'firebase-admin';

function initAdmin() {
  if (admin.apps.length) return admin.app();

  // Expecting service account JSON in env var FIREBASE_SERVICE_ACCOUNT
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!svc) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT env var');

  const serviceAccount = JSON.parse(svc);

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  let payload;
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body);
    const { pairId, payload: notifPayload } = body;
    if (!pairId || !notifPayload) return res.status(400).json({ error: 'Missing pairId or payload' });

    const appAdmin = initAdmin();
    const firestore = appAdmin.firestore();

    // read pair doc
    const pairSnap = await firestore.collection('pairs').doc(pairId).get();
    if (!pairSnap.exists) return res.status(404).json({ error: 'Pair not found' });
    const pairData = pairSnap.data();
    const users = pairData.users || [];

    // gather tokens from users collection
    const tokens = [];
    for (const uid of users) {
      if (notifPayload.excludeUid && uid === notifPayload.excludeUid) continue;
      const userSnap = await firestore.collection('users').doc(uid).get();
      if (!userSnap.exists) continue;
      const userData = userSnap.data();
      if (Array.isArray(userData.tokens)) tokens.push(...userData.tokens);
    }
    if (!tokens.length) return res.status(200).json({ ok: true, message: 'No tokens to send' });

    // build message
    const message = {
      notification: {
        title: notifPayload.title || 'Shukku List',
        body: notifPayload.body || ''
      },
      tokens
    };

    // send multidevice
    const resp = await appAdmin.messaging().sendEachForMulticast(message);
    return res.status(200).json({ successCount: resp.successCount, failureCount: resp.failureCount });
  } catch (err) {
    console.error('sendNotification error', err);
    return res.status(500).json({ error: err.message });
  }
}
