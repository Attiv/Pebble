/**
 * The muted "original" line printed under a translated paragraph.
 *
 * The echo used to carry its look as an inline `style` attribute on a `<span>`.
 * That made it depend on seven declarations surviving two trips through the
 * sanitizer and then outranking whatever the message says about its own text —
 * and it lost that fight in the app: the original came out as plain body text
 * running on from the translation (measured from a reader's screenshot: the
 * echoed English is painted in the surrounding 16px body colour rather than
 * 12px `#8a8a8a`, and it does not start a line of its own).
 *
 * The rule now lives in the shadow root next to the message, where the
 * sanitizer never sees it and a message cannot address it, and the translation
 * only emits the class. Nothing about the look has to survive anything.
 */
export const SOURCE_ECHO_CLASS = "pebble-source-echo";

/**
 * Injected by `ShadowDomEmail` alongside the message.
 *
 * No `!important` anywhere: the echo is a direct child of the paragraph, so
 * these declarations already beat the sender's inherited `font-size`/`color`
 * on the paragraph's own `<div>`. A message would have to know this class to
 * interfere, and a class selector outranks anything it could write by accident.
 */
export const SOURCE_ECHO_CSS = `.${SOURCE_ECHO_CLASS} {
          display: block;
          margin-top: 2px;
          padding-left: 8px;
          border-left: 2px solid rgba(128, 128, 128, 0.45);
          font-size: 12px;
          font-weight: normal;
          line-height: 1.6;
          color: #8a8a8a;
        }`;
