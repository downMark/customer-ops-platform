import { CSSProperties, ReactNode } from "react";

interface IconProps {
  name: string;
  className?: string;
  filled?: boolean;
  style?: CSSProperties;
}

const icons: Record<string, ReactNode> = {
  support_agent: (
    <>
      <path d="M4 13v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 13a2 2 0 0 0 2 2h1v-4H6a2 2 0 0 0-2 2Zm16 0a2 2 0 0 1-2 2h-1v-4h1a2 2 0 0 1 2 2Z" />
      <path d="M17 15v1a3 3 0 0 1-3 3h-2" />
      <circle cx="11" cy="19" r="1" />
    </>
  ),
  forum: (
    <>
      <path d="M5 5h14v10H9l-4 4V5Z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  receipt_long: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  logout: (
    <>
      <path d="M10 5H5v14h5" />
      <path d="M13 8l4 4-4 4M17 12H9" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M6 20a6 6 0 0 1 12 0" />
    </>
  ),
  smart_toy: (
    <>
      <rect x="5" y="7" width="14" height="12" rx="3" />
      <path d="M12 7V4M9 12h.01M15 12h.01M9 16h6" />
    </>
  ),
  attach_file: <path d="M9 17 16.5 9.5a3.5 3.5 0 0 0-5-5L4 12a5 5 0 0 0 7 7l7-7" />,
  stop_circle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </>
  ),
  send: <path d="m3 11 18-8-8 18-2-8-8-2Zm8 2 4-4" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  add_box: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  local_shipping: (
    <>
      <path d="M3 6h11v10H3V6Zm11 4h4l3 3v3h-7v-6Z" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  pin: (
    <>
      <path d="M7 4h10l-2 6 3 3H6l3-3-2-6Z" />
      <path d="M12 13v8" />
    </>
  ),
  event: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18M8 14h3M13 14h3M8 17h3" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
};

/** 本地 SVG 图标，不依赖外部字体或网络资源。 */
const Icon = ({ name, className = "", filled = false, style }: IconProps) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    className={`inline-block shrink-0 ${className}`}
    style={style}
    fill="none"
    stroke="currentColor"
    strokeWidth={filled ? 2.2 : 1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {icons[name] ?? icons.support_agent}
  </svg>
);

export default Icon;
