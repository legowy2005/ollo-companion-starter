import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const BookmarkIcon = (p: IconProps) => <Svg {...p}><path d="M6.5 3.5h11v17l-5.5-3.6-5.5 3.6z" fill="currentColor" /></Svg>;
export const SearchIcon = (p: IconProps) => <Svg {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></Svg>;
export const PencilIcon = (p: IconProps) => <Svg {...p} strokeWidth={0}><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></Svg>;
export const TrashIcon = (p: IconProps) => <Svg {...p} strokeWidth={1.9}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></Svg>;
export const PlayIcon = (p: IconProps) => <Svg {...p} strokeWidth={2.6}><circle cx="12" cy="12" r="9" /><path d="M10 8l6 4-6 4z" fill="currentColor" strokeWidth={1.2} /></Svg>;
export const PlusIcon = (p: IconProps) => <Svg {...p} strokeWidth={2.6}><path d="M12 4v16M4 12h16" /></Svg>;
export const ArrowLeftIcon = (p: IconProps) => <Svg {...p} strokeWidth={2.6}><path d="M20 12H5M11 5l-7 7 7 7" /></Svg>;
export const ArrowRightIcon = (p: IconProps) => <Svg {...p} strokeWidth={2.6}><path d="M4 12h15M13 5l7 7-7 7" /></Svg>;
export const FlipIcon = (p: IconProps) => <Svg {...p} strokeWidth={2.4}><path d="M4.5 15a7.5 7.5 0 0 1 15 0" /><path d="M16 15.5h7l-3.5 4.5z" fill="currentColor" strokeWidth={1.2} /></Svg>;
export const BluetoothIcon = (p: IconProps) => <Svg {...p} strokeWidth={2.4}><path d="M6.5 7.5 17 17l-5 5V2l5 5L6.5 16.5" /></Svg>;
export const SettingsIcon = (p: IconProps) => <Svg {...p} strokeWidth={2}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></Svg>;
export const CloseIcon = (p: IconProps) => <Svg {...p} strokeWidth={2.6}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
