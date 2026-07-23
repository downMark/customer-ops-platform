import { lazy } from "react";
import Index from "pages/index";
import { PreFetchRouteObject } from "@app/utils/routesTypes";
import { PrefetchKeys } from "apis/queryKeys";
import ChatService from "apis/services/Chat";
import SystemService from "apis/services/System";

const ActiveChat = lazy(() => import("pages/ActiveChat"));
const SystemSettings = lazy(() => import("pages/SystemSettings"));
const OrderHistory = lazy(() => import("pages/OrderHistory"));

const chatRoute = {
  element: <ActiveChat />,
  queryKey: [PrefetchKeys.CHAT_VIEW],
  loadData: ChatService.getChatView,
};

const routes: PreFetchRouteObject[] = [
  {
    path: "/",
    element: <Index />,
    children: [
      { index: true, ...chatRoute },
      { path: "chat", ...chatRoute },
      {
        path: "settings",
        element: <SystemSettings />,
        queryKey: [PrefetchKeys.SETTINGS_VIEW],
        loadData: SystemService.getSettingsView,
      },
      { path: "history", element: <OrderHistory /> },
    ],
  },
];

export default routes;
