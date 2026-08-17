"use strict";

function createDeviceService(ctx) {
  const {
    DEFAULT_DEVICE_ID, cleanText, config, deviceOwnerUid, firestoreSet,
    localState, normalizeDeviceId, normalizeEmail, persistLocal, principalUid,
    runtime, safeIso, serviceError
  } = ctx;

async function registerDeviceSeen(deviceId, seenAt) {
  const normalized = normalizeDeviceId(deviceId, true);
  const timestamp = safeIso(seenAt || Date.now());
  const existing = localState.devices[normalized] || {
    deviceId: normalized,
    ownerUid: normalized === DEFAULT_DEVICE_ID ? deviceOwnerUid() : "",
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    claimedAt: null
  };
  existing.deviceId = normalized;
  existing.firstSeenAt = existing.firstSeenAt || timestamp;
  existing.lastSeenAt = timestamp;
  localState.devices[normalized] = existing;
  if (runtime.firestore) {
    await firestoreSet(config.collections.devices, normalized, {
      deviceId: normalized,
      firstSeenAt: new Date(existing.firstSeenAt),
      lastSeenAt: new Date(timestamp)
    }, true);
  }
  return existing;
}

async function claimDevice(deviceId, principal) {
  const normalized = normalizeDeviceId(deviceId, true);
  const uid = principalUid(principal);
  if (!uid || uid === "demo") {
    throw serviceError(401, "AUTH_REQUIRED", "Can dang nhap bang tai khoan that de nhan thiet bi.");
  }

  let localDevice = localState.devices[normalized] || null;
  if (runtime.firestore) {
    const reference = runtime.firestore.collection(config.collections.devices).doc(normalized);
    await runtime.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists && !localDevice) {
        throw serviceError(404, "DEVICE_NOT_FOUND", "Khong tim thay ma thiet bi. Hay bat ESP32 va cho gui du lieu truoc khi dang ky.");
      }
      const cloud = snapshot.exists ? snapshot.data() : {};
      const ownerUid = cleanText(cloud.ownerUid || localDevice && localDevice.ownerUid || "", 128);
      if (ownerUid && ownerUid !== uid) {
        throw serviceError(409, "DEVICE_ALREADY_CLAIMED", "Ma thiet bi nay da duoc lien ket voi mot tai khoan khac.");
      }
      const now = new Date();
      transaction.set(reference, {
        deviceId: normalized,
        ownerUid: uid,
        claimedAt: now,
        claimedByEmail: normalizeEmail(principal.email || "")
      }, { merge: true });
    });
  } else {
    if (!localDevice) {
      throw serviceError(404, "DEVICE_NOT_FOUND", "Khong tim thay ma thiet bi. Hay bat ESP32 va cho gui du lieu truoc khi dang ky.");
    }
    if (localDevice.ownerUid && localDevice.ownerUid !== uid) {
      throw serviceError(409, "DEVICE_ALREADY_CLAIMED", "Ma thiet bi nay da duoc lien ket voi mot tai khoan khac.");
    }
  }

  localDevice = localDevice || { deviceId: normalized, firstSeenAt: null, lastSeenAt: null };
  localDevice.ownerUid = uid;
  localDevice.claimedAt = new Date().toISOString();
  localState.devices[normalized] = localDevice;
  await persistLocal();
  return {
    deviceId: normalized,
    assigned: true,
    claimedAt: localDevice.claimedAt
  };
}


  return { registerDeviceSeen, claimDevice };
}

module.exports = { createDeviceService };
