// Import this module FIRST in any story that renders a component using the API client. Its first import replaces
// `fetch` before `ApiClientProvider` captures it, so nothing here reaches a network: every request is answered from
// fixtures, stays pending (loading state) or fails (error state).
import "./mockFetch";
import type { ReactNode } from "react";
import { ApiClientProvider } from "../src/lib/ApiClientProvider";
import { HomeViewProvider } from "../src/lib/homeView";
import { ToastProvider } from "../src/lib/toast";
import { ShellActionColumnProvider } from "../src/components/shell";

export { json, setMockApi, type MockHandler } from "./mockFetch";

export function MockApi({ children }: { children: ReactNode }) {
  return (
    <ApiClientProvider>
      <ToastProvider>
        <HomeViewProvider>
          <ShellActionColumnProvider>{children}</ShellActionColumnProvider>
        </HomeViewProvider>
      </ToastProvider>
    </ApiClientProvider>
  );
}
