import { lazy } from "react";
import Index from "pages/index";
import { PreFetchRouteObject } from "@app/utils/routesTypes";

const ActiveChat = lazy(() => import("pages/ActiveChat"));
const Orders = lazy(() => import("pages/Orders"));
const CreateOrder = lazy(() => import("pages/CreateOrder"));
const Products = lazy(() => import("pages/Products"));
const CreateProduct = lazy(() => import("pages/CreateProduct"));

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
    ],
  },
];

export default routes;
