import { MockApi, json, setMockApi } from "../mockApi";
import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoginPage, QrLoginPage } from "../../src/pages/Login";

/** The real sign-in pages. `outcome` is what submitting the form does on the (fixture) server. */
function Page({ page, outcome }: { page: "password" | "qr"; outcome: "ok" | "wrong-password" | "pending" }) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    setMockApi((url) => {
      if (!/\/auth\/login$/.test(url.pathname)) return undefined;
      if (outcome === "pending") return "pending";
      return outcome === "wrong-password" ? json({ error: "invalid_credentials" }, 401) : undefined;
    });
    setKey((k) => k + 1);
  }, [outcome]);
  return <MockApi key={key}>{page === "qr" ? <QrLoginPage /> : <LoginPage />}</MockApi>;
}

const meta = {
  title: "Pages/Login",
  component: Page,
  args: { page: "password", outcome: "wrong-password" },
  argTypes: {
    page: { control: "inline-radio", options: ["password", "qr"] },
    outcome: { control: "inline-radio", options: ["ok", "wrong-password", "pending"] },
  },
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
