import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionLayout } from "../../../src/pages/settings/SettingsSectionLayout";
import { Button } from "../../../src/components/ui";
import { SettingsFrame, type Mode } from "../pageKit";


function Section({ mode, busy, invalid }: { mode: Mode; busy: boolean; invalid: boolean }) {
  void busy;
  void invalid;
  return (
    <SettingsFrame active="Request latency" mode={mode}>
      <SettingsSectionLayout>
        <section className="card settings-card settings-card-wide">
          <div className="http-latency-table-wrap">
            <table className="http-latency-table" aria-label="Request latency">
              <thead>
                <tr>
                  {["Method", "Route", "Count", "Avg", "p50", "p95", "p99", "Max"].map((h) => (
                    <th scope="col" key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[["GET", "/api/v1/library"], ["GET", "/api/v1/search"], ["POST", "/api/v1/playback"]].map(([m, r], i) => (
                  <tr key={r}>
                    <td>{m}</td>
                    <td>{r}</td>
                    <td>{120 - i * 30}</td>
                    <td>{12 + i} ms</td>
                    <td>{10 + i} ms</td>
                    <td>{30 + i * 4} ms</td>
                    <td>{44 + i * 5} ms</td>
                    <td>{90 + i * 9} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </SettingsSectionLayout>
    </SettingsFrame>
  );
}

const meta = {
  title: "Pages/Settings/RequestLatency",
  component: Section,
  tags: ["autodocs"],
  args: { mode: "default", busy: false, invalid: false },
  argTypes: {
    mode: { control: "inline-radio", options: ["default", "loading", "empty", "error"] },
    busy: { control: "boolean", description: "Saving or working" },
    invalid: { control: "boolean", description: "Show the field error" },
  },
} satisfies Meta<typeof Section>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
