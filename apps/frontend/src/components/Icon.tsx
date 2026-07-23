import { CSSProperties } from "react";

interface IconProps {
  name: string;
  className?: string;
  filled?: boolean;
  style?: CSSProperties;
}

/** Material Symbols Outlined glyph (font loaded in the root layout head). */
const Icon = ({ name, className = "", filled = false, style }: IconProps) => (
  <span
    className={`material-symbols-outlined ${className}`}
    style={{
      ...(filled ? { fontVariationSettings: "'FILL' 1" } : {}),
      ...style,
    }}
  >
    {name}
  </span>
);

export default Icon;
