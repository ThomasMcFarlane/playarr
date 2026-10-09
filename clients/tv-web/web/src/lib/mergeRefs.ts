import type { ForwardedRef, RefCallback } from "react";

/** One ref callback that fills several refs (a forwarded ref and a local one). */
export function mergeRefs<T>(...refs: Array<ForwardedRef<T> | RefCallback<T> | undefined>): RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value);
      else if (ref) (ref as { current: T | null }).current = value;
    }
  };
}
