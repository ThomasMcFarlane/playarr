import { useEffect, useState } from "react";
import { createQrCodeSvg } from "@playarr-tv/device-auth";
import { useLanguage } from "../lib/i18n/LanguageProvider";

export function QrCode({
  value,
  size = 240,
  label,
}: {
  value: string;
  size?: number;
  label?: string;
}) {
  const { t } = useLanguage();
  const resolvedLabel = label ?? t("components.qrCode.label");
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
      aria-label={resolvedLabel}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
