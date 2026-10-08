import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchablePlaylistSelect } from "../../src/components/SearchablePlaylistSelect";

const OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: `p${i + 1}`, label: `Sample Playlist ${i + 1}` }));

type Args = { disabled: boolean; empty: boolean; selected: boolean };

function Select({ disabled, empty, selected }: Args) {
  const [value, setValue] = useState(selected ? "p2" : "");
  return (
    <div className="sb-pad" style={{ maxWidth: 420 }}>
      <SearchablePlaylistSelect
        ariaLabel="Playlist"
        disabled={disabled}
        emptyLabel="Choose a playlist"
        noResultsLabel="No playlists match"
        searchPlaceholder="Search playlists"
        options={empty ? [] : OPTIONS}
        value={value}
        onSelect={setValue}
      />
    </div>
  );
}

const meta = {
  title: "Components/Searchable playlist select",
  component: Select,
  tags: ["autodocs"],
  args: { disabled: false, empty: false, selected: false },
  argTypes: { disabled: { control: "boolean" }, empty: { control: "boolean", description: "No playlists" }, selected: { control: "boolean" } },
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Click to open (the open state), type to filter, Enter picks. */
export const Playground: Story = {};
