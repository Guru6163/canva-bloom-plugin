import { TestAppI18nProvider } from "@canva/app-i18n-kit";
import { TestAppUiProvider } from "@canva/app-ui-kit";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { App } from "../../../app";

function renderInTestProvider(node: ReactNode) {
  return render(
    <TestAppI18nProvider>
      <TestAppUiProvider>{node}</TestAppUiProvider>
    </TestAppI18nProvider>,
  );
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows setup when no saved API key", async () => {
    renderInTestProvider(<App />);
    await waitFor(() => {
      expect(screen.getByText("Connect your Bloom account")).toBeDefined();
    });
  });
});
