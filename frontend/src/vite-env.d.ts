/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module '@novnc/novnc' {
  // Minimal surface we use from RFB. Full API: https://github.com/novnc/noVNC/blob/master/docs/API.md
  export default class RFB {
    constructor(
      target: HTMLElement,
      urlOrChannel: string,
      options?: {
        shared?: boolean;
        credentials?: { username?: string; password?: string; target?: string };
        repeaterID?: string;
        wsProtocols?: string[];
      },
    );
    viewOnly: boolean;
    focusOnClick: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;
    disconnect(): void;
    sendCtrlAltDel(): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    // Push text to the remote X CLIPBOARD selection via RFB ClientCutText.
    // The user still needs to trigger Ctrl+V on the remote side for the
    // paste to land in a focused input. The corresponding *inbound* signal
    // is a 'clipboard' event dispatched on RFB with detail.text.
    clipboardPasteFrom(text: string): void;
    focus(options?: { preventScroll?: boolean }): void;
    addEventListener(type: string, listener: (e: unknown) => void): void;
    removeEventListener(type: string, listener: (e: unknown) => void): void;
  }
}
