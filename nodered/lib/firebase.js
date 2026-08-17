"use strict";

const fs = require("fs");
const path = require("path");
const {
    initializeApp,
    cert,
    getApps
} = require("firebase-admin/app");

const {
    getFirestore,
    Timestamp,
    FieldValue
} = require("firebase-admin/firestore");

let firestore = null;

function initializeFirestore() {
    if (firestore) {
        return firestore;
    }

    const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (!configuredPath) {
        throw new Error("Chưa cấu hình FIREBASE_SERVICE_ACCOUNT_PATH");
    }

    const serviceAccountPath = path.resolve(
        __dirname,
        "..",
        configuredPath
    );

    const serviceAccount = JSON.parse(
        fs.readFileSync(serviceAccountPath, "utf8")
    );

    if (getApps().length === 0) {
        initializeApp({
            credential: cert(serviceAccount)
        });
    }

    firestore = getFirestore();
    return firestore;
}

async function saveTelemetry(telemetry) {
    const database = initializeFirestore();
    const receivedAt = new Date(telemetry.receivedAt);

    if (Number.isNaN(receivedAt.getTime())) {
        throw new Error("receivedAt không hợp lệ");
    }

    const document = {
        deviceId: telemetry.deviceId,
        temperature: telemetry.temperature,
        ph: telemetry.ph,
        relayOn: telemetry.relayOn,
        receivedAt: Timestamp.fromDate(receivedAt),
        createdAt: FieldValue.serverTimestamp()
    };

    const reference = await database
        .collection("aquaTelemetry")
        .add(document);

    return {
        id: reference.id,
        ...telemetry
    };
}

async function readTelemetryHistory({ hours = 24, limit = 360 } = {}) {
    const database = initializeFirestore();

    const fromDate = new Date(
        Date.now() - hours * 60 * 60 * 1000
    );

    const snapshot = await database
        .collection("aquaTelemetry")
        .where(
            "receivedAt",
            ">=",
            Timestamp.fromDate(fromDate)
        )
        .orderBy("receivedAt", "desc")
        .limit(limit)
        .get();

    const history = snapshot.docs.map((document) => {
        const data = document.data();

        return {
            id: document.id,
            deviceId: data.deviceId,
            temperature: data.temperature,
            ph: data.ph,
            relayOn: data.relayOn,
            receivedAt: data.receivedAt.toDate().toISOString()
        };
    });

    return history.reverse();
}

module.exports = {
    saveTelemetry,
    readTelemetryHistory
};
