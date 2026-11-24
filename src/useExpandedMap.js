import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useExpandedMap(card) {
  const [expanded, setExpanded] = useState(() => new URLSearchParams(location.search).get('full') === '1');
  const toggleRef = useRef(null);
  const ownsNative = useRef(false);
  function exit() {
    setExpanded(false);
    if (ownsNative.current && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  function toggle() {
    if (expanded) return exit();
    setExpanded(true);
    // Keep the dialog siblings in the fullscreen tree. iOS also supports the CSS-only layout.
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      ownsNative.current = true;
      document.documentElement.requestFullscreen().catch(() => { ownsNative.current = false; });
    }
  }
  useLayoutEffect(() => {
    if (!expanded) return;
    const y = window.scrollY, x = window.scrollX;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    const hidden = [];
    for (let n = card.current; n?.parentElement && n !== document.body; n = n.parentElement) {
      for (const sibling of n.parentElement.children) {
        if (sibling !== n && sibling instanceof HTMLElement && !sibling.inert && sibling.tagName !== 'DIALOG') {
          sibling.inert = true;
          hidden.push(sibling);
        }
      }
    }
    toggleRef.current?.focus({ preventScroll: true });
    return () => {
      hidden.forEach(n => { n.inert = false; });
      document.documentElement.style.overflow = previous;
      window.scrollTo({top:y, left:x, behavior:'instant'});
    };
  }, [expanded, card]);
  useEffect(() => {
    function onNative() {
      if (ownsNative.current && !document.fullscreenElement) { ownsNative.current = false; setExpanded(false); }
    }
    function onKey(e) {
      if (expanded && e.key === 'Escape' && !document.querySelector('dialog[open]')) exit();
    }
    document.addEventListener('fullscreenchange', onNative);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onNative);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded]);
  return { expanded, toggle, exit, toggleRef };
}
