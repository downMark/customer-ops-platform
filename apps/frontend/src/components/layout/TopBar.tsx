import Icon from "components/Icon";
import Avatar from "components/Avatar";

interface TopBarProps {
  searchPlaceholder?: string;
}

const TopBar = ({ searchPlaceholder = "搜索会话记录…" }: TopBarProps) => (
  <header className="h-16 w-full sticky top-0 z-40 bg-surface border-b border-outline-variant shadow-sm flex justify-between items-center px-gutter shrink-0">
    <div className="flex items-center gap-6 flex-1">
      <span className="text-headline-md font-headline-md font-bold text-on-surface">
        Mastra 智能客服
      </span>
      <div className="relative max-w-md w-full hidden md:block">
        <Icon
          name="search"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg"
        />
        <input
          type="text"
          placeholder={searchPlaceholder}
          className="w-full bg-surface-container-low border-none rounded-full pl-10 pr-4 py-2 text-label-sm focus:ring-2 focus:ring-primary/20 outline-none"
        />
      </div>
    </div>

    <div className="flex items-center gap-2">
      <button
        type="button"
        className="p-2 text-on-surface-variant hover:bg-secondary-container rounded-full transition-all"
        aria-label="网络"
      >
        <Icon name="hub" />
      </button>
      <button
        type="button"
        className="p-2 text-on-surface-variant hover:bg-secondary-container rounded-full transition-all"
        aria-label="指标"
      >
        <Icon name="signal_cellular_alt" />
      </button>
      <button
        type="button"
        className="p-2 text-on-surface-variant hover:bg-secondary-container rounded-full transition-all relative"
        aria-label="通知"
      >
        <Icon name="notifications" />
        <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full" />
      </button>
      <div className="h-8 w-px bg-outline-variant mx-2" />
      <Avatar name="Mastra 运营" className="w-8 h-8" />
    </div>
  </header>
);

export default TopBar;
