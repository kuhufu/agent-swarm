export interface IconDef {
  viewBox: string;
  paths: Array<{ d: string; fill?: string; stroke?: string; opacity?: string }>;
}

export const ICONS: Record<string, IconDef> = {
  close: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M18 6L6 18" },
      { d: "M6 6l12 12" },
    ],
  },
  plus: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M12 5v14" },
      { d: "M5 12h14" },
    ],
  },
  check: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M20 6L9 17l-5-5" },
    ],
  },
  chevronDown: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M6 9l6 6 6-6" },
    ],
  },
  chevronRight: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M9 18l6-6-6-6" },
    ],
  },
  search: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M11 19a8 8 0 100-16 8 8 0 000 16z" },
      { d: "M21 21l-4.35-4.35" },
    ],
  },
  chat: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" },
    ],
  },
  send: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M22 2L11 13" },
      { d: "M22 2l-7 20-4-9-9-4 20-7z" },
    ],
  },
  stop: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M6 6h12v12H6z" },
    ],
  },
  edit: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" },
    ],
  },
  trash: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M3 6h18" },
      { d: "M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" },
    ],
  },
  fork: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M6 3v12" },
      { d: "M18 6a3 3 0 100-6 3 3 0 000 6z" },
      { d: "M18 18a3 3 0 100 6 3 3 0 000-6z" },
      { d: "M8.21 13.89L15 9" },
      { d: "M8.21 10.11L15 15" },
    ],
  },
  copy: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M9 9h13v13H9z" },
      { d: "M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" },
    ],
  },
  upload: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" },
      { d: "M17 8l-5-5-5 5" },
      { d: "M12 3v12" },
    ],
  },
  download: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" },
      { d: "M7 10l5 5 5-5" },
      { d: "M12 15V3" },
    ],
  },
  user: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" },
      { d: "M12 3a4 4 0 100 8 4 4 0 000-8z" },
    ],
  },
  clock: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M12 2a10 10 0 100 20 10 10 0 000-20z" },
      { d: "M12 6v6l4 2" },
    ],
  },
  jsExecute: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M16 18l6-6-6-6" },
      { d: "M8 6l-6 6 6 6" },
    ],
  },
  folder: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" },
    ],
  },
  book: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M4 19.5A2.5 2.5 0 016.5 17H20" },
      { d: "M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" },
      { d: "M8 7h8" },
      { d: "M8 11h6" },
    ],
  },
  monitor: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M2 3h20v14H2z" },
      { d: "M8 21h8" },
      { d: "M12 17v4" },
    ],
  },
  swarm: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M12 2L2 7l10 5 10-5-10-5z" },
      { d: "M2 17l10 5 10-5" },
      { d: "M2 12l10 5 10-5" },
    ],
  },
  history: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M3 12a9 9 0 1018 0 9 9 0 00-18 0z" },
      { d: "M12 7v5l3 3" },
      { d: "M3 3l3 3" },
      { d: "M6 6L3 3" },
    ],
  },
  moreHorizontal: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M12 13a1 1 0 100-2 1 1 0 000 2z" },
      { d: "M19 13a1 1 0 100-2 1 1 0 000 2z" },
      { d: "M5 13a1 1 0 100-2 1 1 0 000 2z" },
    ],
  },
  pulse: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M22 12h-4l-3 9L9 3l-3 9H2" },
    ],
  },
  lock: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z" },
      { d: "M7 11V7a5 5 0 0110 0v4" },
    ],
  },
  arrowRight: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M5 12h14" },
      { d: "M12 5l7 7-7 7" },
    ],
  },
  save: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" },
      { d: "M17 21v-8H7v8" },
      { d: "M7 3v5h8" },
    ],
  },
  refresh: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M21 2v6h-6" },
      { d: "M3 12a9 9 0 0115-6.7L21 8" },
      { d: "M3 22v-6h6" },
      { d: "M21 12a9 9 0 01-15 6.7L3 16" },
    ],
  },
  wrench: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" },
    ],
  },
  file: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" },
      { d: "M14 2v6h6" },
      { d: "M16 13H8" },
      { d: "M16 17H8" },
      { d: "M10 9H8" },
    ],
  },
  image: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2z" },
      { d: "M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" },
      { d: "M21 15l-5-5L5 21" },
    ],
  },
  fileCode: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" },
      { d: "M14 2v6h6" },
      { d: "M10 13l-2 2 2 2" },
      { d: "M14 13l2 2-2 2" },
    ],
  },
  fileJson: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" },
      { d: "M14 2v6h6" },
      { d: "M8 14h.01" },
      { d: "M12 14h.01" },
      { d: "M16 14h.01" },
    ],
  },
};
