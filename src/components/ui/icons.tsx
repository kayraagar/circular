import type { ReactNode, SVGProps } from "react";

/** Az sayıda, ince çizgili ikon. Dekoratiftir; anlam metinle birlikte verilir. */
type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...props }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconOverview = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7.25" />
    <circle cx="10" cy="10" r="2.25" />
  </Svg>
);
export const IconUsers = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="7" r="3" />
    <path d="M2.75 16.25c.6-2.6 2.7-4.25 5.25-4.25s4.65 1.65 5.25 4.25" />
    <path d="M13.5 4.25a3 3 0 0 1 0 5.5M15.5 12.5c1 .7 1.6 2 1.75 3.75" />
  </Svg>
);
export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4.25" width="14" height="12.5" rx="2.5" />
    <path d="M3 8.25h14M7 2.75v3M13 2.75v3" />
  </Svg>
);
export const IconShare = (p: P) => (
  <Svg {...p}>
    <circle cx="5.5" cy="10" r="2.25" />
    <circle cx="14.5" cy="5" r="2.25" />
    <circle cx="14.5" cy="15" r="2.25" />
    <path d="m7.5 9 5-2.8M7.5 11l5 2.8" />
  </Svg>
);
export const IconQr = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="5.5" height="5.5" rx="1" />
    <rect x="11.5" y="3" width="5.5" height="5.5" rx="1" />
    <rect x="3" y="11.5" width="5.5" height="5.5" rx="1" />
    <path d="M11.5 11.5h2v2M17 11.5v5.5h-5.5M14.5 14.5h.01" />
  </Svg>
);
export const IconSend = (p: P) => (
  <Svg {...p}>
    <path d="M17 3 8.5 11.5M17 3l-5 14-3.5-5.5L3 8l14-5Z" />
  </Svg>
);
export const IconOrbit = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="2.5" />
    <ellipse cx="10" cy="10" rx="7.5" ry="3.5" transform="rotate(-30 10 10)" />
  </Svg>
);
export const IconChart = (p: P) => (
  <Svg {...p}>
    <path d="M3 16.75h14M5.5 13.5V9.75M10 13.5V5.5M14.5 13.5v-6" />
  </Svg>
);
export const IconSliders = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h8M15 6h2M3 14h2M9 14h8" />
    <circle cx="13" cy="6" r="2" />
    <circle cx="7" cy="14" r="2" />
  </Svg>
);
export const IconBriefcase = (p: P) => (
  <Svg {...p}>
    <rect x="2.75" y="6" width="14.5" height="10.5" rx="2.25" />
    <path d="M7 6V4.75C7 4.2 7.45 3.75 8 3.75h4c.55 0 1 .45 1 1V6M2.75 10.5h14.5" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="5.25" />
    <path d="m13 13 3.75 3.75" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M10 4v12M4 10h12" />
  </Svg>
);
export const IconMenu = (p: P) => (
  <Svg {...p}>
    <path d="M3 6.5h14M3 13.5h14" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="m5 5 10 10M15 5 5 15" />
  </Svg>
);
export const IconArrowLeft = (p: P) => (
  <Svg {...p}>
    <path d="M16 10H4M9 5l-5 5 5 5" />
  </Svg>
);
export const IconArrowRight = (p: P) => (
  <Svg {...p}>
    <path d="M4 10h12M11 5l5 5-5 5" />
  </Svg>
);
export const IconLogout = (p: P) => (
  <Svg {...p}>
    <path d="M8 3.5H5.25c-.97 0-1.75.78-1.75 1.75v9.5c0 .97.78 1.75 1.75 1.75H8M13 6.5 16.5 10 13 13.5M16.5 10H8" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M10 6.25v4.5M10 13.5h.01" />
  </Svg>
);
export const IconPin = (p: P) => (
  <Svg {...p}>
    <path d="M10 17s5.25-4.6 5.25-9A5.25 5.25 0 0 0 4.75 8c0 4.4 5.25 9 5.25 9Z" />
    <circle cx="10" cy="8" r="1.75" />
  </Svg>
);

export const NAV_ICONS = {
  overview: IconOverview,
  users: IconUsers,
  calendar: IconCalendar,
  share: IconShare,
  qr: IconQr,
  send: IconSend,
  orbit: IconOrbit,
  chart: IconChart,
  sliders: IconSliders,
  briefcase: IconBriefcase,
} as const;
export type NavIconName = keyof typeof NAV_ICONS;
