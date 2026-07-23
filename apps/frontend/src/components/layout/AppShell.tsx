import { Outlet } from "react-router-dom";
import SideNav from "./SideNav";
import TopBar from "./TopBar";

/** Persistent frame: nav rail + top bar + routed workspace. */
const AppShell = () => (
  <div className="min-h-screen flex bg-background text-on-background font-body-md">
    <SideNav />
    <main className="flex-1 ml-16 lg:ml-64 flex flex-col h-screen overflow-hidden">
      <TopBar />
      <div className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </div>
    </main>
  </div>
);

export default AppShell;
