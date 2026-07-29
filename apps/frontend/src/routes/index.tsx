import { lazy } from "react";
import Index from "pages/index";
import { PreFetchRouteObject } from "@app/utils/routesTypes";
import { diagnosticsEnabled } from "../diagnostics";

const ActiveChat = lazy(() => import("pages/ActiveChat"));
const Orders = lazy(() => import("pages/Orders"));
const CreateOrder = lazy(() => import("pages/CreateOrder"));
const Products = lazy(() => import("pages/Products"));
const CreateProduct = lazy(() => import("pages/CreateProduct"));
const Operations = lazy(() => import("pages/Operations"));
const Diagnostics = lazy(() => import("pages/Diagnostics"));

const chatRoute = {
  element: <ActiveChat />,
};

const routes: PreFetchRouteObject[] = [
  {
    path: "/",
    element: <Index />,
    children: [
      { index: true, ...chatRoute },
      { path: "chat", ...chatRoute },
      { path: "orders", element: <Orders /> },
      { path: "addOrder", element: <CreateOrder /> },
      { path: "products", element: <Products /> },
      { path: "products/new", element: <CreateProduct /> },
      { path: "operations", element: <Operations /> },
      // 自检页会往真实链路灌人造错误，生产环境不注册这条路由。
      ...(diagnosticsEnabled
        ? [{ path: "diagnostics", element: <Diagnostics /> }]
        : []),
    ],
  },
];

export default routes;
