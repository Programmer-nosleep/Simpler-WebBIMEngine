// webix-excel-like.ts
// Vanilla TypeScript (tanpa React) — cocok dipanggil dari main.ts
// Membuat UI mirip Excel (flat ribbon + formula bar + grid Webix), light/dark, autosave localStorage, import/export CSV.

declare global {
  interface Window {
    webix?: any;
    $$?: any;
  }
}

export type Theme = "light" | "dark";

export type RowData = {
  id?: string | number;
  label: string;
  area: number;
  count: number;
  dept_name: string;
  dept_color: string;
  spaceld: string;
  [key: string]: any; // Allow indexing for custom columns
};

type ActiveCell = { rowId: string | number; colId: keyof RowData } | null;

type InitOptions = {
  mount: string | HTMLElement; // container root (mis: "#app")
  title?: string;
  storageKeyData?: string;
  storageKeyTheme?: string;
  webixCdnJs?: string; // optional kalau kamu ingin auto-load
  webixCssLight?: string;
  webixCssDark?: string;
};

const DEFAULTS = {
  title: "University Learning …",
  storageKeyData: "webix_sheet_data_v3",
  storageKeyTheme: "webix_sheet_theme_v1",
  webixCdnJs: "https://cdn.webix.com/edge/webix.js",
  webixCssLight: "https://cdn.webix.com/edge/webix.css",
  webixCssDark: "https://cdn.webix.com/edge/skins/dark.css",
};

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function safeNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function getEl(mount: string | HTMLElement): HTMLElement {
  if (typeof mount === "string") {
    const el = document.querySelector<HTMLElement>(mount);
    if (!el) throw new Error(`mount element not found: ${mount}`);
    return el;
  }
  return mount;
}

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-webix-src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.webixSrc = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

function ensureWebixSkinLink(id: string, href: string) {
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = href; // browser akan normalize ke absolute
}

function applyTheme(theme: Theme, storageKeyTheme: string) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(storageKeyTheme, theme);
}

function getInitialTheme(storageKeyTheme: string): Theme {
  const saved = localStorage.getItem(storageKeyTheme);
  if (saved === "light" || saved === "dark") return saved;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  return prefersDark ? "dark" : "light";
}

function injectExcelFlatStyles(styleId = "excel-flat-styles") {
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
:root{
  --xl-appbg:#ffffff;
  --xl-ribbon:#f3f3f3;
  --xl-border:#c6c6c6;
  --xl-grid:#d6d6d6;
  --xl-header:#f3f3f3;
  --xl-subheader:#fafafa;
  --xl-group:#ededed;
  --xl-select:#2b78ff;
  --xl-select-soft:rgba(43,120,255,.15);
  --xl-text:#111827;
  --xl-text2:#4b5563;
}
html.dark{
  --xl-appbg:#0b1220;
  --xl-ribbon:#111827;
  --xl-border:rgba(148,163,184,.35);
  --xl-grid:rgba(148,163,184,.22);
  --xl-header:#111827;
  --xl-subheader:#0f172a;
  --xl-group:#0f172a;
  --xl-select:#60a5fa;
  --xl-select-soft:rgba(96,165,250,.18);
  --xl-text:#e5e7eb;
  --xl-text2:#9ca3af;
}

*{ box-sizing:border-box; }
html,body{ height:100%; margin:0; background:var(--xl-appbg); color:var(--xl-text); font-family:"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial; }
button, input { font-family:inherit; }
button{ cursor:pointer; }
.xl-root{ height:100%; display:flex; flex-direction:column; }

.xl-titlebar{
  height:36px;
  display:flex; align-items:center; gap:10px;
  background:var(--xl-ribbon);
  border-bottom:1px solid var(--xl-border);
  padding:0 10px;
}
.xl-appicon{
  width:22px; height:22px;
  border:1px solid var(--xl-border);
  background:#fff;
  display:grid; place-items:center;
  font-size:11px; font-weight:700;
}
html.dark .xl-appicon{ background:#0b1220; }
.xl-title{ font-size:12px; }
.xl-titlebar .spacer{ flex:1; }
.xl-mini-btn{
  height:26px;
  border:1px solid var(--xl-border);
  background:transparent;
  padding:0 10px;
  font-size:12px;
}
.xl-mini-btn:hover{ background:rgba(0,0,0,.06); }
html.dark .xl-mini-btn:hover{ background:rgba(255,255,255,.06); }

.xl-tabs{
  display:flex; gap:2px;
  background:var(--xl-ribbon);
  border-bottom:1px solid var(--xl-border);
  padding:6px 8px 0 8px;
  align-items:flex-end;
}
.xl-tab{
  height:28px;
  padding:0 12px;
  border:none;
  background:transparent;
  font-size:12px;
  color:var(--xl-text2);
}
.xl-tab:hover{ background:rgba(0,0,0,.06); }
html.dark .xl-tab:hover{ background:rgba(255,255,255,.06); }
.xl-tab.active{
  background:#fff;
  border:1px solid var(--xl-border);
  border-bottom-color:#fff;
  color:var(--xl-text);
}
html.dark .xl-tab.active{
  background:#0b1220;
  border-bottom-color:var(--xl-ribbon);
}

.xl-ribbon{
  display:flex; gap:0;
  background:var(--xl-ribbon);
  border-bottom:1px solid var(--xl-border);
  padding:8px 8px;
  flex-wrap:wrap;
}
.xl-group{
  border-right:1px solid var(--xl-border);
  padding:0 10px;
  display:flex; flex-direction:column;
}
.xl-group:last-child{ border-right:none; }
.xl-controls{ display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.xl-gtitle{ margin-top:6px; font-size:10px; color:var(--xl-text2); text-align:center; user-select:none; }
.xl-btn{
  height:30px; min-width:52px;
  border:1px solid var(--xl-border);
  background:transparent;
  font-size:11px;
}
.xl-btn:hover{ background:rgba(0,0,0,.06); }
html.dark .xl-btn:hover{ background:rgba(255,255,255,.06); }
.xl-pill{
  height:30px; min-width:64px;
  border:1px solid var(--xl-border);
  background:#fff;
  padding:0 8px;
  display:flex; align-items:center;
  font-size:11px;
  user-select:none;
}
html.dark .xl-pill{ background:#0b1220; }

.xl-formula{
  display:flex; gap:8px; align-items:center;
  padding:6px 8px;
  border-bottom:1px solid var(--xl-border);
  background:#fff;
}
html.dark .xl-formula{ background:#0b1220; }
.xl-namebox{
  width:78px;
  border:1px solid var(--xl-border);
  height:26px;
  display:flex; align-items:center;
  padding:0 8px;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size:12px;
}
.xl-fx{
  border:1px solid var(--xl-border);
  height:26px;
  padding:0 8px;
  display:flex; align-items:center;
  color:var(--xl-text2);
  user-select:none;
}
.xl-fxinput{
  flex:1;
  border:1px solid var(--xl-border);
  height:26px;
  padding:0 10px;
  font-size:12px;
  background:#fff;
  color:var(--xl-text);
}
html.dark .xl-fxinput{ background:#0b1220; color:var(--xl-text); }
.xl-apply{
  height:26px;
  border:1px solid var(--xl-border);
  background:transparent;
  padding:0 10px;
  font-size:12px;
}
.xl-apply:hover{ background:rgba(0,0,0,.06); }
html.dark .xl-apply:hover{ background:rgba(255,255,255,.06); }

.xl-sheetwrap{
  flex:1;
  display:flex;
  flex-direction:column;
  min-height:0;
}
.xl-grid{
  flex:1;
  min-height:0;
  border-left:1px solid var(--xl-border);
  border-right:1px solid var(--xl-border);
  border-bottom:1px solid var(--xl-border);
  background:#fff;
}
html.dark .xl-grid{ background:#0b1220; }

.xl-sheettabs{
  display:flex; align-items:center; gap:2px;
  background:var(--xl-ribbon);
  border-top:1px solid var(--xl-border);
  padding:4px 8px;
}
.xl-sheetbtn{
  height:26px;
  padding:0 12px;
  border:none;
  background:transparent;
  font-size:12px;
  color:var(--xl-text2);
}
.xl-sheetbtn:hover{ background:rgba(0,0,0,.06); }
html.dark .xl-sheetbtn:hover{ background:rgba(255,255,255,.06); }
.xl-sheetbtn.active{
  background:#fff;
  border:1px solid var(--xl-border);
  border-bottom-color:#fff;
  color:var(--xl-text);
}
html.dark .xl-sheetbtn.active{
  background:#0b1220;
  border-bottom-color:var(--xl-ribbon);
}

/* ---- Webix overrides to be flatter + Excel-like ---- */
.webix_view{ font-family:"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial !important; }
.webix_dtable{ background:transparent !important; }

.webix_view, .webix_el_box, .webix_popup, .webix_window{
  border-radius:0 !important;
  box-shadow:none !important;
}
.webix_button, .webix_el_button button{
  border-radius:0 !important;
  box-shadow:none !important;
}

.webix_dtable_header, .webix_ss_header{ background:var(--xl-header) !important; }
.webix_dtable_header .webix_hcell{
  background:var(--xl-header) !important;
  border-right:1px solid var(--xl-grid) !important;
  border-bottom:1px solid var(--xl-grid) !important;
  box-shadow:none !important;
  padding:0 6px !important;
  font-weight:600 !important;
}
.webix_dtable .webix_cell{
  border-right:1px solid var(--xl-grid) !important;
  border-bottom:1px solid var(--xl-grid) !important;
  box-shadow:none !important;
  padding:0 6px !important;
}
.webix_dtable_header .excel-corner{ background:var(--xl-header) !important; }
.webix_dtable_header .excel-letter{ background:var(--xl-header) !important; text-align:center; font-weight:600 !important; }
.webix_dtable_header .excel-label{ background:var(--xl-subheader) !important; font-weight:600 !important; }
.webix_dtable_header .excel-group{ background:var(--xl-group) !important; text-align:center; font-weight:600 !important; }
.webix_dtable .excel-rowhdr{ background:var(--xl-header) !important; text-align:right; padding-right:8px !important; font-variant-numeric:tabular-nums; }

.webix_dtable .webix_cell.webix_cell_select{
  background:var(--xl-select-soft) !important;
  box-shadow:inset 0 0 0 2px var(--xl-select) !important;
}
.webix_dtable .webix_row_hover .webix_cell{ background:rgba(0,0,0,.03) !important; }
html.dark .webix_dtable .webix_row_hover .webix_cell{ background:rgba(255,255,255,.04) !important; }

/* Custom Excel Headers */
.excel-group-green {
  background: #e2efda !important;
  color: #000 !important;
  border-bottom: 2px solid #548235 !important;
  text-align: center !important;
  font-weight: 700 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.excel-group-gray {
  background: #ededed !important;
  color: #000 !important;
  border-bottom: 2px solid #bfbfbf !important;
  text-align: center !important;
  font-weight: 700 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.excel-header-bold {
  font-weight: 700 !important;
  text-align: center !important;
  vertical-align: middle !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  white-space: pre-wrap !important;
  line-height: 1.2 !important;
}

.excel-header-italic {
  font-style: italic !important;
  font-size: 11px !important;
  text-align: center !important;
  color: #555 !important;
  white-space: pre-wrap !important;
  line-height: 1.2 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.excel-header-italic-small {
  font-style: italic !important;
  font-size: 10px !important;
  text-align: center !important;
  color: #888 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}
`;
  document.head.appendChild(style);
}

function rowsFromCSV(webix: any, text: string): RowData[] {
  const gridCols = ["label", "area", "count", "dept_name", "dept_color"];
  const parsed: any[][] = webix.csv.parse(text);
  if (!parsed?.length) return [];

  const first = parsed[0].map((x) => String(x || "").trim().toLowerCase());
  const hasHeader = first.some((x) => gridCols.includes(x));

  const start = hasHeader ? 1 : 0;
  const headerMap: Record<string, number> = {};
  if (hasHeader) first.forEach((h, idx) => (gridCols.includes(h) ? (headerMap[h] = idx) : void 0));

  const out: RowData[] = [];
  for (let i = start; i < parsed.length; i++) {
    const row = parsed[i];
    if (!row || row.every((cell) => String(cell ?? "").trim() === "")) continue;

    const get = (key: string, fallbackIdx: number) => {
      const idx = hasHeader ? headerMap[key] : fallbackIdx;
      return idx != null && idx < row.length ? row[idx] : "";
    };

    // const qty = safeNumber(get("qty", 4));
    // const unit = safeNumber(get("unit_price", 5));
    // // const total = safeNumber(get("total", 6)) || qty * unit; // total unused now

    out.push({
      label: String(get("label", 0)).trim(),
      area: safeNumber(get("area", 1)),
      count: safeNumber(get("count", 2)),
      dept_name: String(get("dept_name", 3)).trim(),
      dept_color: String(get("dept_color", 4)).trim(),
      spaceld: "",
    });
  }
  return out;
}

export async function initExcelLikeWebixSheet(opts: InitOptions) {
  const cfg = { ...DEFAULTS, ...opts };

  injectExcelFlatStyles();

  const root = getEl(cfg.mount);
  root.innerHTML = ""; // clear
  root.classList.add("xl-root");

  // Root UI DOM
  const titlebar = document.createElement("div");
  titlebar.className = "xl-titlebar";
  titlebar.innerHTML = `
    <div class="xl-appicon">X</div>
    <div class="xl-title">${cfg.title}</div>
    <div class="spacer"></div>
    <button class="xl-mini-btn" data-action="export">Export</button>
    <button class="xl-mini-btn" data-action="theme">Theme</button>
  `;

  const tabs = document.createElement("div");
  tabs.className = "xl-tabs";
  const tabNames = ["HOME", "INSERT", "PAGE LAYOUT", "FORMULAS", "DATA", "VIEW", "SETTINGS"] as const;
  tabs.innerHTML = tabNames
    .map((t, i) => `<button class="xl-tab ${i === 0 ? "active" : ""}" data-tab="${t}">${t}</button>`)
    .join("");

  const ribbon = document.createElement("div");
  ribbon.className = "xl-ribbon";
  ribbon.innerHTML = `
    <div class="xl-group">
      <div class="xl-controls">
        <button class="xl-btn" data-action="paste">Paste</button>
        <button class="xl-btn" data-action="cut">Cut</button>
        <button class="xl-btn" data-action="copy">Copy</button>
      </div>
      <div class="xl-gtitle">Clipboard</div>
    </div>

    <div class="xl-group">
      <div class="xl-controls">
        <div class="xl-pill">Arial</div>
        <div class="xl-pill">11</div>
        <button class="xl-btn" data-action="bold">B</button>
        <button class="xl-btn" data-action="italic">I</button>
        <button class="xl-btn" data-action="underline">U</button>
      </div>
      <div class="xl-gtitle">Font</div>
    </div>

    <div class="xl-group">
      <div class="xl-controls">
        <button class="xl-btn" data-action="left">Left</button>
        <button class="xl-btn" data-action="center">Center</button>
        <button class="xl-btn" data-action="right">Right</button>
        <button class="xl-btn" data-action="wrap">Wrap</button>
      </div>
      <div class="xl-gtitle">Alignment</div>
    </div>

    <div class="xl-group">
      <div class="xl-controls">
        <button class="xl-btn" data-action="sort">Sort</button>
        <button class="xl-btn" data-action="filter">Filter</button>
        <button class="xl-btn" data-action="find">Find</button>
      </div>
      <div class="xl-gtitle">Data</div>
    </div>

    <div class="xl-group">
      <div class="xl-controls">
        <button class="xl-btn" data-action="add">Tambah</button>
        <button class="xl-btn" data-action="delete">Hapus</button>
        <button class="xl-btn" data-action="import">Import</button>
        <button class="xl-btn" data-action="reset">Reset</button>
      </div>
      <div class="xl-gtitle">Sheet</div>
    </div>
  `;

  const formula = document.createElement("div");
  formula.className = "xl-formula";
  formula.innerHTML = `
    <div class="xl-namebox" data-el="addr">A1</div>
    <div class="xl-fx">fx</div>
    <input class="xl-fxinput" data-el="fx" placeholder="Masukkan nilai…" />
    <button class="xl-apply" data-action="applyFx">Apply</button>
  `;

  const sheetWrap = document.createElement("div");
  sheetWrap.className = "xl-sheetwrap";

  const gridHost = document.createElement("div");
  gridHost.className = "xl-grid";

  const sheetTabs = document.createElement("div");
  sheetTabs.className = "xl-sheettabs";
  sheetTabs.innerHTML = `
    <button class="xl-sheetbtn active" data-sheet="Program Data">Program Data</button>
    <button class="xl-sheetbtn" data-sheet="Site Analysis">Site Analysis</button>
    <button class="xl-sheetbtn" data-sheet="Stories">Stories</button>
    <button class="xl-sheetbtn" data-action="addSheet">+</button>
  `;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".csv,text/csv";
  fileInput.style.display = "none";

  sheetWrap.appendChild(gridHost);
  sheetWrap.appendChild(sheetTabs);

  root.appendChild(titlebar);
  root.appendChild(tabs);
  root.appendChild(ribbon);
  root.appendChild(formula);
  root.appendChild(sheetWrap);
  root.appendChild(fileInput);

  // Theme init
  let theme: Theme = getInitialTheme(cfg.storageKeyTheme);
  applyTheme(theme, cfg.storageKeyTheme);

  // Webix load (optional) + skin link
  ensureWebixSkinLink("webix-skin", theme === "dark" ? cfg.webixCssDark : cfg.webixCssLight);
  if (!window.webix) await loadScriptOnce(cfg.webixCdnJs);
  if (!window.webix) throw new Error("Webix not available. Pastikan webix.js ter-load.");

  const webix = window.webix;

  // Webix columns with 4-level headers to match design
  const cols = [
    // --- Input Fields Group ---
    {
      id: "label",
      width: 200,
      editor: "text",
      header: [
        { text: "Input Fields", colspan: 5, css: "excel-group-green" },
        { text: "Label", css: "excel-header-bold" },
        { text: "Labels to identify Objects", css: "excel-header-italic" },
        { text: "(Required)", css: "excel-header-italic-small" }
      ]
    },
    {
      id: "area",
      width: 120,
      editor: "text",
      header: [
        null,
        { text: "Area per Object\n(Achieved)", css: "excel-header-bold" },
        { text: "Objects are created\nwith this area", css: "excel-header-italic" },
        { text: "(Required)", css: "excel-header-italic-small" }
      ]
    },
    {
      id: "count",
      width: 120,
      editor: "text",
      header: [
        null,
        { text: "Count\n(Achieved)", css: "excel-header-bold" },
        { text: "Number of Objects\ncreated with this area", css: "excel-header-italic" },
        { text: "(Required)", css: "excel-header-italic-small" }
      ]
    },
    {
      id: "dept_name",
      width: 180,
      editor: "text",
      header: [
        null,
        { text: "Department Name", css: "excel-header-bold" },
        { text: "Spatial categories or\nzones", css: "excel-header-italic" },
        { text: "(Optional)", css: "excel-header-italic-small" }
      ]
    },
    {
      id: "dept_color",
      width: 120,
      editor: "color", // use color editor if available, else text
      header: [
        null,
        { text: "Department Color", css: "excel-header-bold" },
        { text: "Editable HEX code\ncolor...", css: "excel-header-italic" },
        { text: "(Optional)", css: "excel-header-italic-small" }
      ],
      template: "<div style='width:100%; height:100%; display:flex; align-items:center; gap:8px;'><div style='width:16px; height:16px; background:#value#; border:1px solid #ccc;'></div> #value#</div>"
    },

    // --- Custom Calculation Group ---
    // Spacer Cols (F to AC is a lot, let's do a few sample blanks + start of Custom Calc)
    {
      id: "custom_add",
      width: 100,
      header: [
        { text: "Custom Calculation", colspan: 5, css: "excel-group-gray" },
        { text: "Add custom\ncolumns", rowspan: 3, css: "excel-header-italic-small" },
        null,
        null
      ]
    },
    // Empty spacers to mimic the grid look
    { id: "c1", header: [null, "", "", ""], width: 60 },
    { id: "c2", header: [null, "", "", ""], width: 60 },
    { id: "c3", header: [null, "", "", ""], width: 60 },

    // spaceld column
    {
      id: "spaceld",
      width: 150,
      editor: "text",
      header: [
        null, // part of Custom Calc group theoretically but maybe separate? Image shows header continued.
        { text: "spaceld", css: "excel-header-bold" },
        { text: "", css: "" },
        { text: "", css: "" }
      ]
    }
  ];

  const exampleRow: RowData = {
    label: "Main Entry & Social Commons",
    area: 7560.00,
    count: 1,
    dept_name: "& Social Commons",
    dept_color: "#d7d5ba",
    spaceld: "spaceId_1_1",
    custom_add: "",
    c1: "", c2: "", c3: ""
  };
  // Add more rows to match image vibe
  const exampleRows = [
    { label: "Main Entry Lobby", area: 1200, count: 1, dept_name: "& Social Commons", dept_color: "#d7d5ba", spaceld: "spaceId_1_3" },
    { label: "Orientation & Digital Display", area: 550, count: 1, dept_name: "& Social Commons", dept_color: "#d7d5ba", spaceld: "spaceId_1_2" },
    { label: "Reception / Information", area: 250, count: 1, dept_name: "& Social Commons", dept_color: "#d7d5ba", spaceld: "spaceId_1_4" },
    { label: "Flexible Lounge Zone", area: 825, count: 2, dept_name: "& Social Commons", dept_color: "#d7d5ba", spaceld: "spaceId_1_6" },
    { label: "Collaborative Study Zone", area: 9200, count: 1, dept_name: "Collaborative Study Zone", dept_color: "#dabfec", spaceld: "spaceId_2_1" },
  ];

  const loadRows = (): RowData[] => {
    try {
      const raw = localStorage.getItem(cfg.storageKeyData);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? (data as RowData[]) : [];
    } catch {
      return [];
    }
  };

  let saveTimer: number | null = null;
  const scheduleSave = (table: any) => {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const rows = table.serialize(true) as RowData[];
      localStorage.setItem(cfg.storageKeyData, JSON.stringify(rows));
    }, 250);
  };

  // Formula bar state
  let activeCell: ActiveCell = null;
  const addrEl = formula.querySelector<HTMLElement>('[data-el="addr"]')!;
  const fxEl = formula.querySelector<HTMLInputElement>('[data-el="fx"]')!;

  const computeAddr = (table: any, rowId: any, colId: string) => {
    const colIndex = table.getColumnIndex(colId) - 1; // minus row header column
    const rowIndex = table.getIndexById(rowId);
    return `${colLetter(Math.max(0, colIndex))}${rowIndex + 1}`;
  };

  const syncFxFromSelection = (table: any) => {
    const sel = table.getSelectedId?.();
    if (!sel?.row || !sel?.column) return;

    const rowId = sel.row as string | number;
    const colId = sel.column as string;
    if (colId === "__row") return;

    activeCell = { rowId, colId: colId as keyof RowData };
    addrEl.textContent = computeAddr(table, rowId, colId);

    const item = table.getItem(rowId);
    const v = item?.[colId];
    fxEl.value = v == null ? "" : String(v);
  };

  const applyFx = (table: any) => {
    if (!activeCell) return;
    const { rowId, colId } = activeCell;

    const item = table.getItem(rowId);
    const numericCols = new Set<keyof RowData>(["qty", "unit_price", "total"]);

    let next: any = fxEl.value;
    if (numericCols.has(colId)) next = safeNumber(next);

    item[colId] = next;

    // Keep total consistent
    if (colId === "qty" || colId === "unit_price") {
      item.qty = safeNumber(item.qty);
      item.unit_price = safeNumber(item.unit_price);
      item.total = item.qty * item.unit_price;
    }

    table.updateItem(rowId, item);
    scheduleSave(table);
  };

  const buildWebixColumns = () => {
    // We already defined `cols` with the complex header structure structure above.
    // However, we need to inject the "Excel Letters" row (A, B, C...) as the *second* row?
    // The image has:
    // Row 1: Group ("Input Fields")
    // Row 2: Letters (A, B, C...) -- Wait, image has Letters at the very top (standard Excel), 
    //        THEN Group ("Input Fields"), 
    //        THEN "Label", 
    //        THEN "Labels to identify", 
    //        THEN "(Required)"
    // Webix allows arbitrary header rows. 
    // Let's create the config manually.

    // We want 5 header rows roughly if we include letters? 
    // Or Letters are usually outside the data grid in real Excel, but in Webix they are headers.
    // Let's stick to the 4 levels defined in `cols` + 1 letter row at index 0.

    const finalCols = cols.map((c, i) => {
      const letter = colLetter(i);
      // c.header is array of 4 objects.
      // We prepend the letter header.
      // And we need to make sure rowspan/colspan logic in Webix holds. 
      // Current cols def has colspan in the first item.

      // Let's adjust:
      // Row 0: Letter
      // Row 1: Group (Input Fields)
      // Row 2: Label
      // Row 3: Description
      // Row 4: Requirement

      const predefinedHeaders = (c.header as any[]) || [];
      const letterHeader = { text: letter, css: "excel-letter" };

      return {
        id: c.id,
        // Spread properties
        width: c.width,
        editor: c.editor,
        template: (c as any).template,
        // Combine headers
        header: [letterHeader, ...predefinedHeaders]
      };
    });

    // Adjust row Number column
    // The row number col needs 5 empty/corner headers to match height
    const rowHeaderCol = {
      id: "__row",
      width: 46,
      css: "excel-rowhdr",
      header: [
        { text: "", css: "excel-corner" },
        { text: "", css: "excel-corner" },
        { text: "", css: "excel-corner" },
        { text: "", css: "excel-corner" },
        { text: "", css: "excel-corner" }
      ],
      template: (_obj: any, _common: any, _val: any, _col: any, index: number) => String(index + 1),
    };

    return [rowHeaderCol, ...finalCols];
  };

  const destroyExisting = () => {
    try {
      const prev = webix?.$$?.("sheet");
      if (prev) prev.destructor();
    } catch { }
  };

  const buildTable = () => {
    destroyExisting();

    // Optional locale
    try {
      webix.i18n.setLocale("id-ID");
    } catch { }

    const initialRows = loadRows();
    const data = initialRows.length ? initialRows : exampleRows; // Use array of examples

    webix.ui(
      {
        view: "datatable",
        id: "sheet",
        container: gridHost,
        columns: buildWebixColumns(),
        data,

        editable: true,
        editaction: "click",
        select: "cell",
        navigation: true,
        clipboard: "block",
        resizeColumn: true,

        rowHeight: 24,
        headerRowHeight: 24, // Base height, might adjust automatically or we fix it if too small for 3-line text


        scheme: {
          $init(obj: any) {
            obj.qty = safeNumber(obj.qty);
            obj.unit_price = safeNumber(obj.unit_price);
            obj.total = safeNumber(obj.total);
            obj.area = safeNumber(obj.area);
            obj.count = safeNumber(obj.count);
          },
        },

        on: {
          onAfterSelect: function () {
            syncFxFromSelection(this);
          },
          onAfterEditStop: function (_state: any, editor: any) {
            // Recompute totals when qty/unit changes
            if (editor.column === "qty" || editor.column === "unit_price") {
              // @ts-ignore
              const row = this.getItem(editor.row);
              row.qty = safeNumber(row.qty);
              row.unit_price = safeNumber(row.unit_price);
              row.total = row.qty * row.unit_price;
              // @ts-ignore
              this.updateItem(editor.row, row);
            }
            scheduleSave(this);
            syncFxFromSelection(this);
          },
          onAfterAdd: function () {
            scheduleSave(this);
          },
          onAfterDelete: function () {
            scheduleSave(this);
          },
          onDataUpdate: function () {
            scheduleSave(this);
          },
        },
      },
      gridHost
    );

    const t = webix?.$$?.("sheet");
    if (t) {
      const firstRow = t.getFirstId?.();
      if (firstRow) {
        t.select({ row: firstRow, column: cols[0].id });
        syncFxFromSelection(t);
      }
    }
  };

  // Initial render
  buildTable();

  // Actions
  const getTable = () => webix?.$$?.("sheet");

  const addRow = () => {
    const t = getTable();
    if (!t) return;
    const id = t.add({
      date: todayISO(),
      ref: "",
      description: "",
      category: "",
      qty: 0,
      unit_price: 0,
      total: 0,
      notes: "",
      entered_by: "",
      status: "Draft",
    });
    t.select({ row: id, column: "description" });
    t.editCell(id, "description");
    scheduleSave(t);
  };

  const deleteSelected = () => {
    const t = getTable();
    if (!t) return;
    const sel = t.getSelectedId?.();
    if (!sel) return webix.message?.("Pilih dulu sel/baris yang mau dihapus.");
    const rowId = sel.row || sel;
    webix.confirm?.("Hapus baris terpilih?")?.then(() => {
      t.remove(rowId);
      scheduleSave(t);
    });
  };

  const exportCSV = () => {
    const t = getTable();
    if (!t) return;
    webix.toCSV(t, { filename: `data_masuk_${todayISO()}`, filterHTML: true });
  };

  const resetSheet = () => {
    const t = getTable();
    if (!t) return;
    webix.confirm?.("Reset sheet? (Data di browser akan dihapus)")?.then(() => {
      localStorage.removeItem(cfg.storageKeyData);
      t.clearAll();
      t.parse([exampleRow]);
      scheduleSave(t);
    });
  };

  const importCSV = () => {
    fileInput.value = "";
    fileInput.click();
  };

  // Wire formula bar
  fxEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const t = getTable();
      if (t) applyFx(t);
    }
  });

  formula.querySelector<HTMLButtonElement>('[data-action="applyFx"]')!.addEventListener("click", () => {
    const t = getTable();
    if (t) applyFx(t);
  });

  // File import handler
  fileInput.addEventListener("change", async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    const t = getTable();
    if (!t) return;

    try {
      const rows = rowsFromCSV(webix, text);
      if (!rows.length) return webix.message?.({ type: "error", text: "CSV kosong / format tidak dikenali." });

      t.clearAll();
      t.parse(rows);
      localStorage.setItem(cfg.storageKeyData, JSON.stringify(rows));
      webix.message?.(`Import sukses: ${rows.length} baris`);
    } catch (e) {
      console.error(e);
      webix.message?.({ type: "error", text: "Gagal import CSV." });
    }
  });

  // Ribbon + titlebar actions
  const handleAction = (action: string) => {
    switch (action) {
      case "add":
        addRow();
        break;
      case "delete":
        deleteSelected();
        break;
      case "import":
        importCSV();
        break;
      case "reset":
        resetSheet();
        break;
      case "export":
        exportCSV();
        break;
      case "theme": {
        theme = theme === "dark" ? "light" : "dark";
        applyTheme(theme, cfg.storageKeyTheme);
        ensureWebixSkinLink("webix-skin", theme === "dark" ? cfg.webixCssDark : cfg.webixCssLight);
        // Rebuild table for best skin consistency
        buildTable();
        break;
      }
      default:
        // tombol visual-only (paste/cut/copy/font/alignment...) tidak dihubungkan
        break;
    }
  };

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const action = t?.getAttribute?.("data-action");
    if (action) handleAction(action);
  });

  // Tabs active styling (visual)
  tabs.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".xl-tab") as HTMLElement | null;
    if (!btn) return;
    tabs.querySelectorAll(".xl-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });

  // Return small API (optional)
  return {
    getTable,
    addRow,
    deleteSelected,
    exportCSV,
    importCSV,
    resetSheet,
    setTheme(next: Theme) {
      theme = next;
      applyTheme(theme, cfg.storageKeyTheme);
      ensureWebixSkinLink("webix-skin", theme === "dark" ? cfg.webixCssDark : cfg.webixCssLight);
      buildTable();
    },
    destroy() {
      destroyExisting();
      root.innerHTML = "";
    },
  };
}

/*
USAGE (contoh main.ts):

import { initExcelLikeWebixSheet } from "./webix-excel-like";

initExcelLikeWebixSheet({
  mount: "#app",
  title: "University Learning …",
});

Catatan:
- File ini akan auto-load webix.js dari CDN jika window.webix belum ada.
- Kalau kamu sudah install Webix via bundler, kamu bisa:
  - pastikan window.webix tersedia, atau
  - modifikasi bagian loadWebixOnce sesuai setup kamu.
*/
