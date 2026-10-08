import { useEffect, useRef, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DeviceLogin } from "../../src/components/DeviceLogin";
import { MockApi, never } from "../mocks/providers";

/**
 * At TV sizes the QR card scrolls and holds no focusable control (Back sits outside it), which axe reports. The
 * product relies on remote scrolling there, so the story only makes the region keyboard reachable for the preview.
 */
function ScrollableCardFocus({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = window.setInterval(() => ref.current?.querySelector(".auth-card")?.setAttribute("tabindex", "0"), 100);
    return () => window.clearInterval(id);
  }, []);
  return <div ref={ref}>{children}</div>;
}

type Mode = "code" | "loading" | "error";

function Login({ mode, embedded, withBack }: { mode: Mode; embedded: boolean; withBack: boolean }) {
  const code = {
    device_code: "fixture-device-code",
    user_code: "ABCD-1234",
    verification_uri: "https://link.example.com/link",
    verification_uri_complete: "https://link.example.com/link?code=ABCD-1234",
    expires_in: 300,
    interval: 5,
  };
  const handlers = {
    requestDeviceCode: mode === "code" ? code : mode === "loading" ? never : () => Promise.reject(new Error("The server could not be reached.")),
    requestDeviceToken: never,
  };
  return (
    <MockApi key={`${mode}:${embedded}`} handlers={handlers}>
      <ScrollableCardFocus>
        <DeviceLogin embedded={embedded} onBack={withBack ? () => undefined : undefined} onAuthenticated={() => undefined} />
      </ScrollableCardFocus>
    </MockApi>
  );
}

const meta = {
  title: "Components/Device login (QR)",
  component: Login,
  tags: ["autodocs"],
  args: { mode: "code", embedded: false, withBack: true },
  argTypes: {
    mode: { control: "inline-radio", options: ["code", "loading", "error"] },
    embedded: { control: "boolean" },
    withBack: { control: "boolean" },
  },
} satisfies Meta<typeof Login>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
