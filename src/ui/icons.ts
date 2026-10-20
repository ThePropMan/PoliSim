/** Hand-authored line icons: 24×24 grid, 1.6 stroke, round caps — one family for the whole HUD. */
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  state: svg('<path d="M3 9.5 12 4l9 5.5"/><path d="M4.5 10v8M9 10v8M15 10v8M19.5 10v8"/><path d="M3 20.5h18"/>'),
  economy: svg('<ellipse cx="9" cy="7" rx="5.5" ry="2.5"/><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7"/><path d="M9.5 16.4c-.2 0-.3 0-.5 0-3 0-5.5-1.1-5.5-2.5v-3"/><ellipse cx="15.5" cy="15" rx="5" ry="2.3"/><path d="M10.5 15v3.3c0 1.3 2.2 2.3 5 2.3s5-1 5-2.3V15"/>'),
  society: svg('<circle cx="8" cy="8" r="2.8"/><circle cx="16.5" cy="9" r="2.3"/><path d="M3 19c.4-3.2 2.4-5.2 5-5.2s4.6 2 5 5.2"/><path d="M13.6 14.6c.8-.6 1.8-1 2.9-1 2.2 0 3.8 1.7 4.2 4.6"/>'),
  policy: svg('<path d="M6 3.5h9l3.5 3.5V20a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"/><path d="M14.5 3.5V7.5h4"/><path d="M8.5 11h7M8.5 14h7M8.5 17h4"/>'),
  parties: svg('<path d="M5 21V3.5"/><path d="M5 4.5c2.5-1.3 4.8-1.3 7 0s4.5 1.3 7 0v8c-2.5 1.3-4.8 1.3-7 0s-4.5-1.3-7 0"/>'),
  trends: svg('<path d="M3.5 3.5v17h17"/><path d="m7 15 3.5-4 3 2.5L19 7"/><path d="M15.5 7H19v3.5"/>'),
  chronicle: svg('<path d="M4 5.5h13v13a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2v-13Z"/><path d="M17 9h3v9.5a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12.5h7M7 16h4"/>'),
  events: svg('<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z"/>'),
  pause: svg('<path d="M8.5 5v14M15.5 5v14" stroke-width="2.4"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor"/>'),
  close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  save: svg('<path d="M5 3.5h11l3.5 3.5v12.5a1 1 0 0 1-1 1h-13.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M8 3.5v5h7v-5"/><path d="M7.5 20.5v-6h9v6"/>'),
  export: svg('<path d="M12 3.5v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4.5 16v3.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V16"/>'),
  menu: svg('<path d="M4 6.5h16M4 12h16M4 17.5h16"/>'),
  follow: svg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  scenes: svg('<rect x="3" y="5.5" width="18" height="13" rx="1"/><path d="M3 9h18M7.5 5.5 9 9M12.5 5.5 14 9M17.5 5.5 19 9"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
  legend: svg('<circle cx="6" cy="7" r="1.6"/><circle cx="6" cy="12" r="1.6"/><circle cx="6" cy="17" r="1.6"/><path d="M10 7h9M10 12h9M10 17h9"/>'),
  arrow: svg('<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>'),
  tri: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5 9 8.5H1Z" fill="currentColor"/></svg>',
} as const;
