import admin from 'firebase-admin';

// Firebase Admin initialization with better error handling
let appAdmin = null;

function initAdmin() {
  if (appAdmin) return appAdmin;

  try {
    // Check if already initialized
    if (admin.apps.length > 0) {
      appAdmin = admin.apps[0];
      return appAdmin;
    }

    // Expecting service account JSON in env var FIREBASE_SERVICE_ACCOUNT
    const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!svc) {
      throw new Error('Missing FIREBASE_SERVICE_ACCOUNT environment variable');
    }

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(svc);
    } catch (parseError) {
      throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT JSON format');
    }

    // Validate required service account fields
    const requiredFields = ['project_id', 'private_key', 'client_email'];
    for (const field of requiredFields) {
      if (!serviceAccount[field]) {
        throw new Error(`Missing required field in service account: ${field}`);
      }
    }

    appAdmin = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
    });

    console.log('Firebase Admin initialized successfully');
    return appAdmin;

  } catch (error) {
    console.error('Firebase Admin initialization failed:', error);
    throw error;
  }
}

// Token validation and cleanup
async function validateAndCleanTokens(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return [];
  }

  // Remove duplicates and invalid tokens
  const uniqueTokens = [...new Set(tokens)].filter(token => 
    token && typeof token === 'string' && token.length > 100
  );

  return uniqueTokens;
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate Content-Type
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    return res.status(400).json({ error: 'Content-Type must be application/json' });
  }

  let payload;
  try {
    // Parse and validate request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    payload = req.body;
    const { familyCode, payload: notifPayload } = payload;

    // Validate required fields
    if (!familyCode || typeof familyCode !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid familyCode' });
    }

    if (!notifPayload || typeof notifPayload !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid notification payload' });
    }

    if (!notifPayload.title || typeof notifPayload.title !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid notification title' });
    }

    // Initialize Firebase Admin
    const appAdmin = initAdmin();
    const firestore = appAdmin.firestore();

    // Validate family document exists
    const familySnap = await firestore.collection('families').doc(familyCode).get();
    if (!familySnap.exists) {
      return res.status(404).json({ error: 'Family not found' });
    }

    const familyData = familySnap.data();
    const users = Array.isArray(familyData.members) ? familyData.members : [];

    if (users.length === 0) {
      return res.status(400).json({ error: 'No users in this family' });
    }

    // Gather FCM tokens from users
    const tokens = [];
    const batch = firestore.batch();

    for (const uid of users) {
      // Skip excluded user if specified
      if (notifPayload.excludeUid && uid === notifPayload.excludeUid) {
        continue;
      }

      try {
        const userSnap = await firestore.collection('users').doc(uid).get();
        if (!userSnap.exists) continue;

        const userData = userSnap.data();
        if (Array.isArray(userData.tokens)) {
          tokens.push(...userData.tokens);
        }

        // Clean up old tokens periodically (simplified version)
        if (userData.tokens && userData.tokens.length > 10) {
          // Keep only the 10 most recent tokens
          const recentTokens = userData.tokens.slice(-10);
          batch.update(userSnap.ref, { tokens: recentTokens });
        }

      } catch (userError) {
        console.warn(`Error processing user ${uid}:`, userError);
        // Continue with other users
      }
    }

    // Commit batch updates if any
    if (batch._opStack.length > 0) {
      await batch.commit().catch(console.error);
    }

    // Clean and validate tokens
    const validTokens = await validateAndCleanTokens(tokens);
    
    if (validTokens.length === 0) {
      return res.status(200).json({ 
        ok: true, 
        message: 'No valid tokens to send notifications to' 
      });
    }

    // Prepare notification message
    const message = {
      notification: {
        title: notifPayload.title.trim(),
        body: (notifPayload.body || '').trim() || 'Your family shopping list was updated',
        image: notifPayload.image || undefined
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channel_id: 'shukku_default'
        }
      },
      webpush: {
        headers: {
          Urgency: 'high'
        }
      },
      tokens: validTokens
    };

    console.log(`Sending notification to ${validTokens.length} tokens for family ${familyCode}`);

    // Send multicast notification
    const response = await appAdmin.messaging().sendEachForMulticast(message);
    
    // Clean up failed tokens
    if (response.failureCount > 0) {
      console.log(`Notification had ${response.failureCount} failures`);
      
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(validTokens[idx]);
          console.warn(`Token failed: ${resp.error?.message}`);
        }
      });

      // Remove failed tokens from Firestore (in background)
      if (failedTokens.length > 0) {
        cleanupFailedTokens(firestore, users, failedTokens).catch(console.error);
      }
    }

    // Return success response
    return res.status(200).json({
      successCount: response.successCount,
      failureCount: response.failureCount,
      totalTokens: validTokens.length
    });

  } catch (error) {
    console.error('sendNotification error:', error);

    // Specific error handling
    if (error.code === 'messaging/invalid-argument') {
      return res.status(400).json({ error: 'Invalid notification payload' });
    } else if (error.code === 'messaging/registration-token-not-registered') {
      return res.status(400).json({ error: 'Invalid device tokens' });
    } else if (error.code === 'app/no-app') {
      return res.status(500).json({ error: 'Server configuration error' });
    } else {
      return res.status(500).json({ error: 'Failed to send notifications' });
    }
  }
}

// Background token cleanup
async function cleanupFailedTokens(firestore, users, failedTokens) {
  try {
    for (const uid of users) {
      const userRef = firestore.collection('users').doc(uid);
      const userSnap = await userRef.get();
      
      if (userSnap.exists) {
        const userData = userSnap.data();
        if (Array.isArray(userData.tokens)) {
          const updatedTokens = userData.tokens.filter(token => 
            !failedTokens.includes(token)
          );
          
          if (updatedTokens.length !== userData.tokens.length) {
            await userRef.update({ 
              tokens: updatedTokens,
              tokensUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          }
        }
      }
    }
  } catch (cleanupError) {
    console.error('Token cleanup failed:', cleanupError);
  }
}