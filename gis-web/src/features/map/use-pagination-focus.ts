import { useLayoutEffect, useRef, type FocusEvent } from 'react';

export function usePaginationFocus(loading: boolean, page: number, total: number | undefined) {
  const ref = useRef<HTMLElement>(null);
  const focused = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const button = focused.current;
    // Native disabling can already have sent focus to body during this commit.
    if (
      !loading &&
      button?.disabled &&
      (document.activeElement === button || document.activeElement === document.body)
    ) {
      const target =
        ref.current?.querySelector<HTMLElement>('button:not(:disabled)') ??
        ref.current?.querySelector<HTMLElement>('span');
      target?.focus();
    }
  }, [loading, page, total]);
  return {
    ref,
    onFocusCapture(event: FocusEvent<HTMLElement>) {
      focused.current = event.target.tagName === 'BUTTON' ? (event.target as HTMLButtonElement) : null;
    },
    onBlurCapture(event: FocusEvent<HTMLElement>) {
      if (event.relatedTarget || !(event.target as HTMLButtonElement).disabled) focused.current = null;
    },
  };
}
