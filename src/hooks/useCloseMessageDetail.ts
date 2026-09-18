import { useEffect, useRef } from "react";

/**
 * Escape reaches an open message detail through this event.
 *
 * The keyboard layer cannot close a detail on its own: the inbox keeps its
 * selection in `mail.store`, while the search and starred views keep theirs in
 * component state. So `useKeyboard` asks, and whichever view is showing a
 * message answers by calling `preventDefault()` on the cancelable event. That
 * answer is also how the caller learns the keystroke was used at all — without
 * it, a press with nothing open would be swallowed instead of falling through
 * to the next thing Escape does in that view.
 */
export const CLOSE_MESSAGE_DETAIL_EVENT = "pebble:close-message-detail";

/**
 * Answer `CLOSE_MESSAGE_DETAIL_EVENT` while `hasOpenDetail` holds.
 *
 * The callbacks are read through a ref so a view that re-renders on every
 * keystroke does not tear the listener down and put it back.
 */
export function useCloseMessageDetail(hasOpenDetail: boolean, closeDetail: () => void) {
  const latest = useRef({ hasOpenDetail, closeDetail });
  latest.current = { hasOpenDetail, closeDetail };

  useEffect(() => {
    const onRequest = (event: Event) => {
      if (!latest.current.hasOpenDetail) return;
      event.preventDefault();
      latest.current.closeDetail();
    };

    document.addEventListener(CLOSE_MESSAGE_DETAIL_EVENT, onRequest);
    return () => document.removeEventListener(CLOSE_MESSAGE_DETAIL_EVENT, onRequest);
  }, []);
}
