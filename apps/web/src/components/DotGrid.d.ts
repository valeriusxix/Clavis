import type { CSSProperties, ReactElement } from "react";

/** Types for DotGrid.jsx, which stays JavaScript so it matches the React Bits source. */
export type DotGridProps = {
  /** Hex only (#rgb or #rrggbb): any other format silently renders white. */
  baseColor?: string;
  /** Hex only (#rgb or #rrggbb): any other format silently renders white. */
  activeColor?: string;
  shape?: "circle" | "square";
  dotSize?: number;
  gap?: number;
  proximity?: number;
  strength?: number;
  bounce?: number;
  tension?: number;
  returnDuration?: number;
  shockRadius?: number;
  shockStrength?: number;
  swell?: number;
  stretch?: number;
  glow?: number;
  fade?: number;
  opacity?: number;
  intro?: boolean;
  mouseInteraction?: boolean;
  clickShock?: boolean;
  paused?: boolean;
  dpr?: number;
  className?: string;
  style?: CSSProperties;
};

declare function DotGrid(props: DotGridProps): ReactElement;
export default DotGrid;
