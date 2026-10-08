import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../src/components/ui";
import { Drawer, FilterSection, MultiSelect, ScrollArea } from "../src/components/shell";
import { focusOn } from "./fixtures";

const GENRES = ["Action", "Drama", "Comedy", "Documentary", "Thriller", "Animation"].map((g) => ({ value: g, label: g }));

function DrawerDemo({ open, tall }: { open: boolean; tall?: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(["Drama"]));
  const [isOpen, setIsOpen] = useState(open);
  return (
    <div className="sb-pad">
      <Button variant="secondary" onClick={() => setIsOpen(true)} aria-expanded={isOpen}>
        Open panel
      </Button>
      <Drawer
        open={isOpen}
        title="Filters"
        titleId="sb-drawer-title"
        closeLabel="Close"
        onClose={() => setIsOpen(false)}
        initialFocus="none"
        footer={
          <Button variant="primary" onClick={() => setIsOpen(false)}>
            Apply
          </Button>
        }
      >
        <FilterSection title="Genres">
          <MultiSelect options={GENRES} selected={selected} onChange={setSelected} ariaLabel="Genres" />
        </FilterSection>
        {tall
          ? Array.from({ length: 6 }, (_, i) => (
              <FilterSection key={i} title={`Section ${i + 1}`}>
                <MultiSelect options={GENRES} selected={selected} onChange={setSelected} ariaLabel={`Section ${i + 1}`} />
              </FilterSection>
            ))
          : null}
      </Drawer>
    </div>
  );
}

const meta = { title: "Components/Panel drawer", component: DrawerDemo, tags: ["autodocs"], args: { open: true } } satisfies Meta<typeof DrawerDemo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const Closed: Story = { args: { open: false } };
/** A long body scrolls natively and shows the edge fade on the side where content continues. */
export const Scrolling: Story = { args: { tall: true } };
export const Focus: Story = { args: { open: true }, parameters: focusOn(".drawer button") };

function ScrollDemo({ axis }: { axis: "vertical" | "horizontal" }) {
  return (
    <div className="sb-pad">
      <div style={axis === "vertical" ? { height: "18rem", width: "24rem" } : { width: "28rem" }}>
        <ScrollArea axis={axis} scrollKey={`sb:${axis}`} className={axis === "horizontal" ? "sb-row" : undefined} viewportProps={{ tabIndex: 0, role: "region", "aria-label": `Fixture ${axis} list` }}>
          {Array.from({ length: 24 }, (_, i) => (
            <p key={i} style={{ margin: "0 1rem 0.75rem", whiteSpace: "nowrap" }}>
              Fixture row {i + 1}
            </p>
          ))}
        </ScrollArea>
      </div>
    </div>
  );
}

export const ScrollAreaVertical: Story = { name: "Scroll area (vertical)", render: () => <ScrollDemo axis="vertical" /> };
export const ScrollAreaHorizontal: Story = { name: "Scroll area (horizontal)", render: () => <ScrollDemo axis="horizontal" /> };
