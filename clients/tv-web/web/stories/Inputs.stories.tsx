import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MultiSelect, ViewToggle } from "../src/components/shell";
import { Caption } from "./fixtures";

const OPTIONS = [
  { value: "action", label: "Action" },
  { value: "drama", label: "Drama" },
  { value: "comedy", label: "Comedy" },
  { value: "documentary", label: "Documentary" },
];

function SearchField({ value, disabled, error }: { value: string; disabled?: boolean; error?: boolean }) {
  return (
    <div className="tv-search-form" role="search" aria-invalid={error || undefined}>
      <span className="tv-search-input-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 4.5 4.5" />
        </svg>
      </span>
      <input type="search" defaultValue={value} placeholder="Search titles" aria-label="Search titles" disabled={disabled} />
      {value ? (
        <button type="button" className="tv-search-clear" disabled={disabled}>
          Clear
        </button>
      ) : null}
    </div>
  );
}

function Inputs({ disabled, value = "", error }: { disabled?: boolean; value?: string; error?: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(["drama"]));
  const [view, setView] = useState("cover");
  return (
    <div className="sb-pad sb-col" style={{ maxWidth: 760 }}>
      <div>
        <Caption>Search field</Caption>
        <SearchField value={value} disabled={disabled} error={error} />
      </div>
      <div>
        <Caption>Text field</Caption>
        <input className="household-pin-input" type="password" aria-label="PIN" defaultValue={value ? "1234" : ""} disabled={disabled} maxLength={4} />
      </div>
      <div>
        <Caption>Select</Caption>
        <select aria-label="Sort order" disabled={disabled} defaultValue="title">
          <option value="title">Title</option>
          <option value="added">Recently added</option>
        </select>
      </div>
      <div>
        <Caption>Choice chips (multi-select)</Caption>
        <MultiSelect options={OPTIONS} selected={selected} onChange={setSelected} ariaLabel="Genres" />
      </div>
      <div>
        <Caption>View toggle</Caption>
        <ViewToggle
          ariaLabel="View"
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: "List", icon: "list" },
            { value: "cover", label: "Cover", icon: "cover" },
            { value: "screen", label: "Screen", icon: "screen" },
          ]}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Inputs",
  component: Inputs,
  tags: ["autodocs"],
  args: { disabled: false, value: "", error: false },
  argTypes: { disabled: { control: "boolean" }, value: { control: "text", description: "Filled value" }, error: { control: "boolean" } },
} satisfies Meta<typeof Inputs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
