import { NavLink } from "react-router-dom";
import Icon from "components/Icon";
import Avatar from "components/Avatar";

interface NavItem {
  to: string;
  icon: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/chat", icon: "forum", label: "当前会话" },
  { to: "/history", icon: "history", label: "订单历史" },
  { to: "/settings", icon: "settings", label: "系统设置" },
];

const SideNav = () => (
  <aside className="w-16 lg:w-64 h-full fixed left-0 top-0 bg-surface-container text-body-md font-body-md border-r border-outline-variant flex flex-col py-base z-50">
    <div className="px-4 py-6 flex items-center gap-3">
      <Icon name="hub" className="text-primary text-3xl" filled />
      <div className="hidden lg:block">
        <h1 className="text-headline-md font-headline-md text-primary">
          客服控制台
        </h1>
        <p className="text-label-sm font-label-sm text-on-surface-variant opacity-70">
          企业级客服支持
        </p>
      </div>
    </div>

    <nav className="flex-1 px-2 space-y-1 mt-4">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            [
              "flex items-center gap-3 p-3 rounded-lg transition-colors",
              isActive
                ? "text-primary font-bold border-r-4 border-primary bg-surface-variant/40"
                : "text-on-surface-variant hover:bg-surface-variant",
            ].join(" ")
          }
        >
          <Icon name={item.icon} />
          <span className="hidden lg:block">{item.label}</span>
        </NavLink>
      ))}
    </nav>

    <div className="p-4 mt-auto border-t border-outline-variant">
      <div className="flex items-center gap-3">
        <Avatar name="陈亚历" />
        <div className="hidden lg:block overflow-hidden">
          <p className="text-body-md font-bold truncate">陈亚历</p>
          <p className="text-label-sm text-on-surface-variant truncate">
            高级客服专员
          </p>
        </div>
      </div>
    </div>
  </aside>
);

export default SideNav;
