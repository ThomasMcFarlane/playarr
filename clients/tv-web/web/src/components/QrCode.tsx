import { useEffect, useState } from "react";
import { createQrCodeSvg } from "@streamarr-tv/device-auth";

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
      className="device-login-qr"
      role="img"
      aria-label="QR code for the Playarr TV sign-in link"
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
