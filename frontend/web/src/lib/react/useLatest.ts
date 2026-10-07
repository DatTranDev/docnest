import { useLayoutEffect, useRef } from 'react';
export function useLatest<T>(value: T) {
  const reference = useRef(value);
  useLayoutEffect(() => {
    reference.current = value;
  }, [value]);
  return reference;
}
