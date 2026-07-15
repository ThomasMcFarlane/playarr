/**
 * React binding over @streamarr-tv/spatial-nav. One `SpatialNavigator` per
 * mounted `SpatialNavProvider` (typically one per app, mounted at the root),
 * listening for arrow-key / remote d-pad `keydown` events and translating
 * them into `navigator.move(direction)` calls.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  SpatialNavigator,
  type Direction,
  type FocusableNode,
} from "@streamarr-tv/spatial-nav";

const SpatialNavContext = createContext<SpatialNavigator | null>(null);

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export interface SpatialNavProviderProps {
  children: ReactNode;
  /** Called when Enter/OK is pressed while a node has focus. Receives the focused node's id. */
  onSelect?: (nodeId: string) => void;
}

export function SpatialNavProvider({ children, onSelect }: SpatialNavProviderProps) {
  const navigator = useMemo(() => new SpatialNavigator(), []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const direction = KEY_TO_DIRECTION[event.key];
      if (direction) {
        event.preventDefault();
        navigator.move(direction);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        const current = navigator.getCurrentFocus();
        if (current) {
          event.preventDefault();
          onSelect?.(current.id);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigator, onSelect]);

  return (
    <SpatialNavContext.Provider value={navigator}>{children}</SpatialNavContext.Provider>
  );
}

export function useSpatialNav(): SpatialNavigator {
  const navigator = useContext(SpatialNavContext);
  if (!navigator) {
    throw new Error("useSpatialNav() must be called within a <SpatialNavProvider>.");
  }
  return navigator;
}

export interface UseFocusableResult {
  ref: RefObject<HTMLElement | null>;
  isFocused: boolean;
}

/** Registers an element as a focusable spatial-nav node for the lifetime of the calling component. */
export function useFocusable(id: string, groupId?: string): UseFocusableResult {
  const navigator = useSpatialNav();
  const ref = useRef<HTMLElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const getRect = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    return rect ?? { x: 0, y: 0, width: 0, height: 0 };
  }, []);

  useEffect(() => {
    const node: FocusableNode = {
      id,
      groupId,
      getRect,
      onFocus: () => setIsFocused(true),
      onBlur: () => setIsFocused(false),
    };
    return navigator.register(node);
  }, [navigator, id, groupId, getRect]);

  return { ref, isFocused };
}
