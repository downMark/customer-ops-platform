import { NavLink } from "react-router-dom";
import { AuthSession } from "apis/model/auth";
import Icon from "components/Icon";

const items = [
  { to: "/chat", icon: "forum", label: "客服聊天" },
  { to: "/orders", icon: "receipt_long", label: "订单数据" },
  { to: "/addOrder", icon: "add_box", label: "添加订单" },
  { to: "/products", icon: "database", label: "商品管理" },
];

const displayRole = (role: string) =>
  role === "admin" ? "管理员" : "客服人员";

interface Props {
  session: AuthSession;
  onLogout: () => void;
}

const SideNav = ({ session, onLogout }: Props) => (
  <aside className="fixed inset-x-0 bottom-0 z-50 flex h-16 border-t border-outline-variant bg-surface-container lg:inset-y-0 lg:right-auto lg:h-auto lg:w-60 lg:flex-col lg:border-r lg:border-t-0">
    <div className="hidden h-16 items-center gap-3 border-b border-outline-variant px-4 lg:flex">
      <Icon name="support_agent" className="text-primary text-3xl" filled />
      <span className="text-lg font-bold text-on-surface">智能客服</span>
    </div>

    <nav className="flex min-w-0 flex-1 items-stretch gap-1 p-1 lg:block lg:space-y-2 lg:p-2">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            [
              "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 transition-colors lg:h-12 lg:flex-row lg:justify-start lg:gap-3 lg:px-3",
              isActive
                ? "bg-primary text-white shadow-sm"
                : "text-on-surface-variant hover:bg-surface-variant",
            ].join(" ")
          }
        >
          <Icon name={item.icon} />
          <span className="max-w-full truncate text-[11px] font-semibold lg:text-sm">
            {item.label}
          </span>
        </NavLink>
      ))}
    </nav>

    <div className="flex w-14 shrink-0 items-center border-l border-outline-variant p-1 lg:block lg:w-auto lg:border-l-0 lg:border-t lg:p-2">
      <div className="hidden lg:block px-3 py-2 min-w-0">
        <p className="text-sm font-bold truncate">{session.user.username}</p>
        <p className="text-xs text-on-surface-variant truncate">
          {displayRole(session.user.role)}
        </p>
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-on-surface-variant hover:bg-surface-variant hover:text-primary lg:h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3"
        aria-label="退出登录"
      >
        <Icon name="logout" />
        <span className="hidden text-sm font-semibold lg:block">退出登录</span>
      </button>
    </div>
  </aside>
);

export default SideNav;
