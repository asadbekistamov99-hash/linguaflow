'use strict';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously } from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  getDocFromServer
} from 'firebase/firestore';
import config from '../firebase-applet-config.json';

const app = getApps().length ? getApp() : initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app, config.firestoreDatabaseId);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// Verify connection on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore client offline, checking configuration.');
    }
  }
}
testConnection();

// Error handler conforming to Firebase Skill specifications
function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((p) => ({
        providerId: p.providerId,
        email: p.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function ensureAuth() {
  if (auth.currentUser) return auth.currentUser;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (e) {
    return auth.currentUser;
  }
}

window.FirebaseSync = {
  db,
  auth,
  ensureAuth,
  handleFirestoreError,

  async saveFlashcard(userId, card) {
    const u = await ensureAuth();
    const effectiveUid = (u && u.uid) || String(userId);
    const cardId = String(card.id || card.concept_id || card.conceptId || `${card.lang}_${encodeURIComponent(card.front)}`);
    const path = `users/${effectiveUid}/flashcards/${cardId}`;
    try {
      const payload = {
        id: cardId,
        userId: effectiveUid,
        lang: String(card.lang || 'en').slice(0, 10),
        conceptId: card.concept_id || card.conceptId || null,
        front: String(card.front || '').slice(0, 200),
        back: String(card.back || '').slice(0, 500),
        hint: String(card.hint || '').slice(0, 200),
        example: String(card.example || '').slice(0, 500),
        reps: Number(card.reps || 0),
        ease: Number(card.ease || 2.3),
        intervalDays: Number(card.interval_days || card.intervalDays || 0),
        dueAt: Number(card.due_at || card.dueAt || Date.now()),
        lapses: Number(card.lapses || 0),
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'users', effectiveUid, 'flashcards', cardId), payload);
      return { ok: true, id: cardId };
    } catch (error) {
      handleFirestoreError(error, 'write', path);
    }
  },

  async deleteFlashcard(userId, cardId) {
    const u = await ensureAuth();
    const effectiveUid = (u && u.uid) || String(userId);
    const strId = String(cardId);
    const path = `users/${effectiveUid}/flashcards/${strId}`;
    try {
      await deleteDoc(doc(db, 'users', effectiveUid, 'flashcards', strId));
      return { ok: true };
    } catch (error) {
      handleFirestoreError(error, 'delete', path);
    }
  },

  async fetchFlashcards(userId, lang) {
    const u = await ensureAuth();
    const effectiveUid = (u && u.uid) || String(userId);
    const path = `users/${effectiveUid}/flashcards`;
    try {
      const snapshot = await getDocs(collection(db, 'users', effectiveUid, 'flashcards'));
      const cards = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (!lang || d.lang === lang) {
          cards.push({
            id: d.id,
            concept_id: d.conceptId || null,
            front: d.front,
            back: d.back,
            hint: d.hint || '',
            example: d.example || '',
            reps: d.reps || 0,
            ease: d.ease || 2.3,
            interval_days: d.intervalDays || 0,
            due_at: d.dueAt || Date.now(),
            lapses: d.lapses || 0,
            lang: d.lang,
            updatedAt: d.updatedAt,
          });
        }
      });
      return cards;
    } catch (error) {
      handleFirestoreError(error, 'get', path);
    }
  },
};

window.signInWithGooglePopup = async function () {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const idToken = await user.getIdToken(true);
    return {
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'Foydalanuvchi'),
        photoURL: user.photoURL,
      },
      idToken,
    };
  } catch (error) {
    console.warn('[firebase-auth] signInWithPopup error:', error?.code || error?.message);
    throw error;
  }
};

window.getFirebaseAuth = function () {
  return auth;
};

