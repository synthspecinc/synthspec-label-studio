export const EDITOR_NOTIFICATION_EVENT = "lsf:editor-notification";

export type EditorNotification = {
  message: string;
  type?: "info" | "error" | "alertError";
};

export const showEditorNotification = (notification: EditorNotification) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<EditorNotification>(EDITOR_NOTIFICATION_EVENT, { detail: notification }));
};
