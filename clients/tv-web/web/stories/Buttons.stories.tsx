import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, type ButtonSize, type ButtonVariant } from "../src/components/ui";
import { Caption } from "./fixtures";

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger", "icon"];
const SIZES: ButtonSize[] = ["sm", "md", "lg"];

function Matrix({ disabled, active }: { disabled?: boolean; active?: boolean }) {
  return (
    <div className="sb-pad sb-col">
      {VARIANTS.map((variant) => (
        <div key={variant}>
          <Caption>{variant}</Caption>
          <div className="sb-row">
            {SIZES.map((size) => (
              <Button key={size} variant={variant} size={size} disabled={disabled} active={active} aria-label={variant === "icon" ? "Example" : undefined}>
                {variant === "icon" ? "+" : `${variant} ${size}`}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: "Components/Button",
  component: Matrix,
  tags: ["autodocs"],
  args: { disabled: false, active: false },
  argTypes: { disabled: { control: "boolean" }, active: { control: "boolean", description: "Open or pressed" } },
} satisfies Meta<typeof Matrix>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
