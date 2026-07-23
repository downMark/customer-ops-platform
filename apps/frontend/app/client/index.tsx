import { hydrateRoot, createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HydrationBoundary, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";

import { createQueryClient } from "@app/utils/queryClient";
import App from "index";

interface TradeFlagType {
  isSSR: boolean;
}

const queryClient = createQueryClient();

const getDehydratedState = () => {
  try {
    const element = document.querySelector("#__REACT_QUERY_STATE__");
    if (!element?.textContent) return {};
    return JSON.parse(element.textContent);
  } catch (error) {
    console.error("Failed to parse dehydrated state:", error);
    return {};
  }
};

const getTradeFlag = (): TradeFlagType => {
  try {
    const element = document.querySelector("#__APP_FLAG__");
    if (!element?.textContent) return { isSSR: false };
    return JSON.parse(element.textContent);
  } catch (error) {
    console.error("Failed to parse trade flag:", error);
    return { isSSR: false };
  }
};

const dehydratedState = getDehydratedState();
const tradeFlag = getTradeFlag();

const ClientApp = () => (
  <BrowserRouter>
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <HydrationBoundary state={dehydratedState}>
          <App />
        </HydrationBoundary>
      </QueryClientProvider>
    </HelmetProvider>
  </BrowserRouter>
);

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Root element not found");
}

const renderApp = () => {
  if (tradeFlag.isSSR) {
    hydrateRoot(root, <ClientApp />);
    return;
  } else {
    createRoot(root).render(<ClientApp />);
  }
};

renderApp();
