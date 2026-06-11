export interface FirebaseNotificationListenerEvent {
  notification: {
    data?: unknown;
    body?: string;
    title?: string;
  };
}
