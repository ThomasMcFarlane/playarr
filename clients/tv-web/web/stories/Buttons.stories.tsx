import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, type ButtonSize, type ButtonVariant } from "../src/components/ui";
import { Caption, focusOn, hoverOn } from "./fixtures";

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
} satisfies Meta<typeof Matrix>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Focus: Story = { parameters: focusOn(".ui-btn") };
export const Hover: Story = { parameters: hoverOn(".ui-btn") };
export const Open: Story = { args: { active: true } };
export const Disabled: Story = { args: { disabled: true } };
