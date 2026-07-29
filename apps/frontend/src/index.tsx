import { Suspense } from "react";
import { useRoutes } from "react-router-dom";
import routes from "./routes";
import { KoaProvider } from "@app/utils/KoaContext";
import { Context } from "koa";
import "theme/index.less";
import "./index.css";
import { installErrorReporting, observeWebVitals } from "./performance";

if (typeof window !== "undefined") {
  // 错误捕获要尽早装：装之前发生的未捕获异常收不到。
  installErrorReporting();
  observeWebVitals();
}

interface AppProps {
  context?: Context;
}

const App = (props: AppProps) => {
  const renderRoutes = useRoutes(routes);
  return (
      <KoaProvider value={props?.context}>
        <Suspense>{renderRoutes}</Suspense>
      </KoaProvider>
  );
};

export default App;
