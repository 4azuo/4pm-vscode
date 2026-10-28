/**
 * The declarative view model the panel webviews render (`media/panel.js`): sections of fields / text / items /
 * messages, action buttons and an optional text form. The extension builds it from server + book data and handles
 * the actions the webview posts back; the webview itself holds no logic and makes no network call.
 * @adr 0673 @arch 0072
 */

/** A notice line above the sections. */
export interface PanelNotice {
  kind: "info" | "warning" | "error";
  text: string;
}

/** A clickable list entry; `action` is posted with the entry's `value`. */
export interface PanelItem {
  label: string;
  detail?: string;
  action?: string;
  value?: string;
}

/** A chat-style message. */
export interface PanelMessage {
  author: string;
  at: string;
  body: string;
  muted?: boolean;
}

/** One section of the panel. */
export interface PanelSection {
  title: string;
  fields?: [string, string][];
  text?: string;
  items?: PanelItem[];
  messages?: PanelMessage[];
  empty?: string;
}

/** A button. */
export interface PanelAction {
  id: string;
  label: string;
  kind?: "primary" | "danger";
  disabled?: boolean;
}

/** A text form (answer, reply). */
export interface PanelForm {
  id: string;
  label: string;
  placeholder?: string;
  submit: string;
}

/** What one panel shows. */
export interface PanelModel {
  title: string;
  subtitle?: string;
  notices?: PanelNotice[];
  sections: PanelSection[];
  actions: PanelAction[];
  form?: PanelForm;
  /** Disables every control while an action runs. */
  busy?: boolean;
}

/** A message from the webview. */
export type PanelEvent = { type: "ready" } | { type: "action"; id: string; value?: string };
