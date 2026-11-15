import type { ReactNode } from 'react'

const shapes = {
  panel: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16M5.8 8h.4M5.8 11h.4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  archive: <><path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM9 12h6" /><rect x="3" y="4" width="18" height="4" rx="1" /></>,
  settings: <><path d="m9 3-.6 2.1-2 .9-2-.6L2.8 9l1.6 1.5v2.8L2.8 15l1.6 2.6 2-.6 2 .9L9 20h6l.6-2.1 2-.9 2 .6 1.6-2.6-1.6-1.7v-2.8L21.2 9l-1.6-2.6-2 .6-2-.9L15 3z" /><circle cx="12" cy="11.5" r="3" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a5 5 0 0 1 10 0v2M16 5a3 3 0 0 1 0 6M17 15a4 4 0 0 1 4 4v1" /></>,
  files: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" /></>,
  send: <path d="M12 19V5m-6 6 6-6 6 6" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  chat: <path d="M20 12c0 3.87-3.58 7-8 7a9.2 9.2 0 0 1-3.3-.6L4 20l1.2-3.4A6.5 6.5 0 0 1 4 12c0-3.87 3.58-7 8-7s8 3.13 8 7Z" />,
  attach: <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  task: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m9 12 2 2 4-4" /></>
} satisfies Record<string, ReactNode>

export default function Icon({ name, className = '' }: { name: keyof typeof shapes; className?: string }): React.JSX.Element {
  return <svg className={`ui-icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>
}
