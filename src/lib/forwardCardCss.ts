/**
 * Styles for a forwarded block rebuilt into a card, for the reader's shadow
 * root.
 *
 * The reader renders mail inside a shadow root, so `index.css` cannot reach
 * it — this string is appended to `shadowEmailCss()` instead. The palette is
 * fixed rather than token-based on purpose: the message sheet is forced light
 * (`color-scheme: light`) even in dark mode, so `var(--color-*)` values, which
 * flip with the app theme, would land dark text on a white card.
 */
export const FORWARD_CARD_CSS = `
        .pebble-forward-card {
          box-sizing: border-box;
          display: block;
          margin: 22px 0 0;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          overflow: hidden;
          background: #ffffff;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 14px 30px -24px rgba(15, 23, 42, 0.45);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          text-align: start;
        }
        .pebble-forward-card:first-child {
          margin-top: 0;
        }
        .pebble-forward-card__header {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 7px;
          padding: 14px 18px 15px;
          background: linear-gradient(180deg, #f8fafd 0%, #eef3f9 100%);
          border-bottom: 1px solid #e4eaf2;
        }
        .pebble-forward-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin: 0;
          padding: 3px 10px 3px 8px;
          border: 1px solid #d3dff2;
          border-radius: 999px;
          background: #e7eefb;
          color: #33507a;
          font-size: 10px;
          font-weight: 700;
          line-height: 1.6;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .pebble-forward-badge::before {
          content: "";
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #4a6fa5;
        }
        .pebble-forward-card__subject {
          width: 100%;
          margin: 0;
          color: #111827;
          font-size: 15px;
          font-weight: 600;
          line-height: 1.4;
          letter-spacing: -0.005em;
          overflow-wrap: anywhere;
        }
        .pebble-forward-card__meta {
          display: flex;
          align-items: baseline;
          gap: 10px;
          width: 100%;
          margin: 0;
          min-width: 0;
          max-width: 100%;
          color: #475467;
          font-size: 12px;
          line-height: 1.5;
        }
        .pebble-forward-card__meta-label {
          flex: 0 0 auto;
          min-width: 46px;
          color: #8b95a5;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .pebble-forward-card__meta-value {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .pebble-forward-card__meta-value b,
        .pebble-forward-card__meta-value strong {
          font-weight: 600;
          color: #344054;
        }
        .pebble-forward-card__body {
          padding: 16px 18px 18px;
          color: #1f2937;
          font-size: 14px;
          line-height: 1.62;
          overflow-wrap: anywhere;
        }
        .pebble-forward-card__body > :first-child {
          margin-top: 0;
        }
        .pebble-forward-card__body > :last-child {
          margin-bottom: 0;
        }
        .pebble-forward-card__body .pebble-forward-card {
          margin-top: 18px;
        }
        .pebble-forward-history {
          margin: 18px 0 0;
          padding: 10px 0 2px 14px;
          border-left: 2px solid #dbe2ed;
        }
        .pebble-forward-history__label {
          display: inline-block;
          margin: 0 0 6px;
          color: #97a1b2;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        /* A hop that is already one level down must not shout as loudly as the
           newest one: same structure, quieter surface. */
        .pebble-forward-history .pebble-forward-card {
          margin-top: 0;
          border-color: #e6ebf3;
          box-shadow: none;
        }
        .pebble-forward-history .pebble-forward-card__header {
          background: #fafbfd;
        }
        .pebble-forward-history .pebble-forward-history {
          margin-left: 10px;
          padding-right: 10px;
          border-radius: 0 6px 6px 0;
          background: rgba(148, 163, 184, 0.07);
        }
        /* From the third hop down the card chrome turns a long thread into an
           onion; the rail carries the depth instead. */
        .pebble-forward-history .pebble-forward-history .pebble-forward-card {
          border-color: #e9edf4;
          background: transparent;
        }
        .pebble-forward-history .pebble-forward-history .pebble-forward-card__header {
          background: transparent;
          border-bottom-color: #eef2f7;
        }`;
