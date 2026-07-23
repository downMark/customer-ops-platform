import { Suspense } from "react";
import { useRoutes } from "react-router-dom";
import routes from "./routes";
import { KoaProvider } from "@app/utils/KoaContext";
import { Context } from "koa";
import "theme/index.less";
import "./index.css";

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
