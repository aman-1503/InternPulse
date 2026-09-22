import type { ReactNode, SVGProps } from "react";

/**
 * Tiny inline icon set (stroke-based, 20x20 viewbox) so the shell/nav reads as
 * a designed product instead of text-only links. Deliberately hand-picked —
 * not a full icon library dependency.
 */
function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 9.5 10 4l7 5.5" />
    <path d="M5 8.5V16a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5" />
  </Icon>
);

export const WorkIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="6.5" width="14" height="9.5" rx="1.5" />
    <path d="M7 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 13 5v1.5" />
    <path d="M3 10.5h14" />
  </Icon>
);

export const AtIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10.5" r="3" />
    <path d="M13 10.5v1a2 2 0 0 0 4 0V10a7 7 0 1 0-3 5.75" />
  </Icon>
);

export const ClipboardIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="4.5" y="4" width="11" height="13" rx="1.5" />
    <path d="M7.5 4V3.5A1.5 1.5 0 0 1 9 2h2a1.5 1.5 0 0 1 1.5 1.5V4" />
    <path d="M7.5 9h5M7.5 12.5h5" />
  </Icon>
);

export const FileIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 3h5l3 3v10.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M11 3v3h3" />
  </Icon>
);

export const SparkleIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.3 5.3l2 2M12.7 12.7l2 2M14.7 5.3l-2 2M7.3 12.7l-2 2" />
    <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
  </Icon>
);

export const GearIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="2.5" />
    <path d="M10 3.5v1.6M10 14.9v1.6M16.5 10h-1.6M5.1 10H3.5M14.6 5.4l-1.1 1.1M6.5 13.5l-1.1 1.1M14.6 14.6l-1.1-1.1M6.5 6.5 5.4 5.4" />
  </Icon>
);

export const ShieldIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 2.5 16 5v5c0 4-2.5 6.5-6 7.5-3.5-1-6-3.5-6-7.5V5l6-2.5Z" />
    <path d="M7.5 10 9 11.5l3.5-3.5" />
  </Icon>
);

export const AlertIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 3 2.5 16h15L10 3Z" />
    <path d="M10 8.5v3.2" />
    <circle cx="10" cy="14" r="0.6" fill="currentColor" stroke="none" />
  </Icon>
);

export const UploadIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 12.5V4M6.5 7.5 10 4l3.5 3.5" />
    <path d="M4 14v1.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V14" />
  </Icon>
);

export const MenuIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 5.5h14M3 10h14M3 14.5h14" />
  </Icon>
);
