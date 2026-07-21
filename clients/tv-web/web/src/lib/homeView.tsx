import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type HomeViewPreference = "thumbnail" | "cover";

export const HOME_VIEW_STORAGE_KEY = "playarr-home-view";

interface HomeViewContextValue {
  preference: HomeViewPreference;
  setPreference: (preference: HomeViewPreference) => void;
}

const HomeViewContext = createContext<HomeViewContextValue | null>(null);

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readHomeViewPreference(
  storage = browserStorage()
): HomeViewPreference {
  return storage?.getItem(HOME_VIEW_STORAGE_KEY) === "cover"
    ? "cover"
    : "thumbnail";
}

export function HomeViewProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<HomeViewPreference>(
    readHomeViewPreference
  );

  function setPreference(nextPreference: HomeViewPreference) {
    setPreferenceState(nextPreference);
    const storage = browserStorage();
    if (nextPreference === "thumbnail") {
      storage?.removeItem(HOME_VIEW_STORAGE_KEY);
    } else {
      storage?.setItem(HOME_VIEW_STORAGE_KEY, nextPreference);
    }
  }

  const value = useMemo<HomeViewContextValue>(
    () => ({ preference, setPreference }),
    [preference]
  );

  return <HomeViewContext.Provider value={value}>{children}</HomeViewContext.Provider>;
}

export function useHomeView(): HomeViewContextValue {
  const context = useContext(HomeViewContext);
  if (!context) {
    throw new Error("useHomeView must be used within HomeViewProvider");
  }
  return context;
}
