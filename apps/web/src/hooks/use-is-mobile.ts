import { useEffect, useState } from 'react';

/** 与 Tailwind md 对齐：视口宽度小于 768 视为移动端 */
const MOBILE_MQ = '(max-width: 767px)';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_MQ).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_MQ);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
