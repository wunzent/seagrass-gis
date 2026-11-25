import { useLayoutEffect, useRef, type FocusEvent } from 'react';

export function usePaginationFocus(loading: boolean, page: number, total: number | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const focused = useRef<HTMLButtonElement | null>(null);
  const selectedTrigger = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const button = focused.current;
    // Native disabling can already have sent focus to body during this commit.
    if (!loading && button && (document.activeElement === button || document.activeElement === document.body)) {
      // Base UI can update its native trigger after this parent layout effect.
      // A disabled size trigger is temporary; arrow boundary fallback would move focus to Next.
      if (button === selectedTrigger.current && button.disabled) {
        const observer = new MutationObserver(() => {
          if (button.disabled) return;
          observer.disconnect();
          if (
            focused.current === button &&
            (document.activeElement === button || document.activeElement === document.body)
          )
            button.focus();
        });
        observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
        return () => observer.disconnect();
      }
      const target =
        (!button.disabled
          ? button
          : ref.current?.querySelector<HTMLElement>('.pagination-navigation button:not(:disabled)')) ??
        ref.current?.querySelector<HTMLElement>('[aria-live]');
      target?.focus();
    }
  }, [loading, page, total]);
  return {
    ref,
    rememberSelection(button: HTMLButtonElement | null) {
      focused.current = button;
      selectedTrigger.current = button;
    },
    onFocusCapture(event: FocusEvent<HTMLElement>) {
      // React portal events bubble through pagination even though the popup is outside its DOM.
      if (!event.target.closest('.pagination')) return;
      if (event.target !== selectedTrigger.current) selectedTrigger.current = null;
      focused.current = event.target.tagName === 'BUTTON' ? (event.target as HTMLButtonElement) : null;
    },
    onBlurCapture(event: FocusEvent<HTMLElement>) {
      if (!event.target.closest('.pagination')) return;
      if (event.relatedTarget || !(event.target as HTMLButtonElement).disabled) focused.current = null;
    },
  };
}
