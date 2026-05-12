import { TestAppI18nProvider } from "@canva/app-i18n-kit";
import { TestAppUiProvider } from "@canva/app-ui-kit";
import { render } from "@testing-library/react";
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
  it("renders", () => {
    const result = renderInTestProvider(<App />);
    expect(result.container.firstChild).toBeNull();
  });
});
