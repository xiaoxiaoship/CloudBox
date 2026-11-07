interface IconProps {
  className?: string;
}

function cls(className?: string): string {
  return className ?? 'h-5 w-5';
}

function base(className?: string) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: cls(className),
    'aria-hidden': true,
  };
}

export function CloudIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={cls(className)} aria-hidden="true">
      <path d="M6.5 19a4.5 4.5 0 0 1-.53-8.97A6.5 6.5 0 0 1 18.4 9.1 4 4 0 0 1 18 17H6.5Z" />
    </svg>
  );
}

export function DashboardIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.2a3 3 0 0 1 0 5.6M17.5 20a5.2 5.2 0 0 0-2.2-4.2" />
    </svg>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
    </svg>
  );
}

export function FileIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M14 3v5a1 1 0 0 0 1 1h5" />
      <path d="M19 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h9l5 5v12a1 1 0 0 1-1 1Z" />
    </svg>
  );
}

export function ServerIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  );
}

export function WifiIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M2.5 8.5a15 15 0 0 1 19 0M5.5 12a10.5 10.5 0 0 1 13 0M8.5 15.4a6 6 0 0 1 7 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 8.9c.14.39.43.71.82.87H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.23Z" />
    </svg>
  );
}

export function PlugIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-6 6v4M8 21h8" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {  return (
    <svg {...base(className)}>
      <path d="M12 3 4.5 6v5.5c0 4.4 3.2 8.4 7.5 9.5 4.3-1.1 7.5-5.1 7.5-9.5V6L12 3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function DatabaseIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
    </svg>
  );
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 4v12m0 0 5-5m-5 5-5-5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function KeyIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9m-3 3 2 2m-5 1 2 2" />
    </svg>
  );
}

export function UnlockIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2M12 15v2" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export function PowerIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 3v9" />
      <path d="M6.3 6.3a8 8 0 1 0 11.4 0" />
    </svg>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6" />
    </svg>
  );
}

export function HardDriveIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 13h18M7 16.5h.01M11 16.5h.01" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 9v4m0 4h.01M10.3 4.5 2.8 17.4A1.6 1.6 0 0 0 4.2 20h15.6a1.6 1.6 0 0 0 1.4-2.6L13.7 4.5a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

export function EyeOffIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="m3 3 18 18M10.6 6.1A9.9 9.9 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.4 3.2M6.6 6.6C3.9 8.5 2.5 12 2.5 12S6 18 12 18a9.5 9.5 0 0 0 3.4-.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export function Spinner({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`animate-spin ${cls(className)}`}
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
