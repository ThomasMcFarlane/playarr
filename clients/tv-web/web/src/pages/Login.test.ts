import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Login QR option", () => {
  it("opens a clean brokered QR route with no server query string", () => {
    const source = readFileSync(new URL("./Login.tsx", import.meta.url), "utf8");

    expect(source).toContain(
      'navigate("/login/qr", { state: location.state })'
    );
    expect(source).toContain("hostedLink");
    expect(source).not.toContain("LOGIN_SERVER_QUERY_PARAM");
    expect(source).not.toContain("qrLoginPath");
  });

  it("keeps manual and QR modes in the same login shell on separate routes", () => {
    const source = readFileSync(new URL("./Login.tsx", import.meta.url), "utf8");
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

    expect(source).toContain('t("pages.login.qrSubmit")');
    expect(source).toContain("<ProfileAuthLayout");
    expect(source).toContain('descriptionKey="pages.login.description"');
    expect(source).toContain('descriptionKey="pages.login.qrDescription"');
    expect(source).toContain("embedded");
    expect(source).toContain("onBack={showManualLogin}");
    expect(appSource).toContain(
      '<Route path="/login/qr" element={<QrLoginPage />} />'
    );
  });

  it("defaults TV entry points to QR while keeping manual login at /login", () => {
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const profilesSource = readFileSync(
      new URL("./Profiles.tsx", import.meta.url),
      "utf8"
    );

    expect(appSource).toContain(
      '<Navigate to="/login/qr" replace state={{ from: location }} />'
    );
    expect(profilesSource).toContain(
      'navigate(IS_TV ? "/login/qr" : "/login"'
    );
    expect(sourceManualNavigation()).toContain('navigate("/login"');
  });
});

function sourceManualNavigation(): string {
  return readFileSync(new URL("./Login.tsx", import.meta.url), "utf8");
}
