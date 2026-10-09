import type { Meta, StoryObj } from "@storybook/react-vite";
import { ListPanel } from "../../src/components/tv/ListPanel";

function Panel({ rows }: { rows: number }) {
  return (
    <div className="sb-pad tv-library tv-directory" style={{ position: "relative", height: 420 }}>
      <ListPanel ariaLabel="Release list" scrollKey="story:list" refreshKey={rows} contentClassName="calendar-agenda-content">
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
          {Array.from({ length: rows }, (_, i) => (
            <li key={i}>
              <button type="button" className="media-card media-card-solid calendar-entry">
                <span className="calendar-entry-body">
                  <span className="calendar-entry-title">{`Release ${i + 1}`}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ListPanel>
    </div>
  );
}

const meta = {
  title: "Components/List panel",
  component: Panel,
  tags: ["autodocs"],
  args: { rows: 12 },
  argTypes: { rows: { control: { type: "number", min: 1, max: 60 }, description: "Rows: more than fit shows the edge fade" } },
} satisfies Meta<typeof Panel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
