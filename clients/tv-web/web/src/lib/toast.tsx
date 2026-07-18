import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLanguage } from "./i18n/LanguageProvider";

const TOAST_DURATION_MS = 4_000;

interface Toast {
  id: number;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string) => {
      const id = ++nextIdRef.current;
      setToasts((current) => [...current, { id, message }]);
      const timer = window.setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
      timersRef.current.set(id, timer);
    },
    [dismissToast]
  );

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
      timersRef.current.clear();
    },
    []
  );

  const contextValue = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div
        className="toast-viewport"
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions"
      >
        {toasts.map((toast) => (
          <div className="toast" key={toast.id}>
            <span className="toast-mark" aria-hidden="true">
              ✓
            </span>
            <span className="toast-message">{toast.message}</span>
            <button
              type="button"
              className="toast-dismiss"
              onClick={() => dismissToast(toast.id)}
              aria-label={t("lib.toast.dismiss", { message: toast.message })}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider.");
  }
  return value;
}
