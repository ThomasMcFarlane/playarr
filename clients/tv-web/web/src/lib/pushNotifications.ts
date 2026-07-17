import type { FirebaseOptions } from "firebase/app";
import type { ApiClient, FirebaseWebConfig } from "@streamarr-tv/api-client";

function firebaseOptions(config: FirebaseWebConfig): FirebaseOptions {
  return {
    apiKey: config.api_key,
    authDomain: config.auth_domain,
    projectId: config.project_id,
    storageBucket: config.storage_bucket,
    messagingSenderId: config.messaging_sender_id,
    appId: config.app_id,
  };
}

export async function enableApprovalPushNotifications(client: ApiClient): Promise<void> {
  const [{ getApp, getApps, initializeApp }, { getMessaging, isSupported, onRegistered, register }] =
    await Promise.all([import("firebase/app"), import("firebase/messaging")]);
  if (!(await isSupported()) || !("serviceWorker" in navigator)) {
    throw new Error("Push notifications are not supported in this browser.");
  }
  const config = await client.getPushConfig();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }
  const appName = `streamarr-push-${config.project_id}`;
  const app = getApps().some((candidate) => candidate.name === appName)
    ? getApp(appName)
    : initializeApp(firebaseOptions(config), appName);
  const serviceWorkerRegistration = await navigator.serviceWorker.register("/sw.js");
  const messaging = getMessaging(app);
  const registrationId = await new Promise<string>((resolve, reject) => {
    const unsubscribe = onRegistered(messaging, (id) => {
      unsubscribe();
      resolve(id);
    });
    void register(messaging, {
      vapidKey: config.vapid_public_key,
      serviceWorkerRegistration,
    }).catch((error) => {
      unsubscribe();
      reject(error);
    });
  });
  await client.registerPush({ token: registrationId, platform: "web" });
}
