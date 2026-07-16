import { useEffect, useState } from "react";
import { createQrCodeSvg } from "@streamarr-tv/device-auth";
import { radius } from "@streamarr-tv/design-tokens";

export function QrCode({ value, size = 240 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    void createQrCodeSvg(value, size).then((result) => {
      if (!cancelled) setSvg(result);
    });
    return () => {
      cancelled = true;
    };
  }, [size, value]);

  return (
    <div
      role="img"
      aria-label="QR code for the Streamarr pairing link"
      style={{
        width: size,
        height: size,
        overflow: "hidden",
        borderRadius: radius.md,
        background: "#fff",
      }}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
