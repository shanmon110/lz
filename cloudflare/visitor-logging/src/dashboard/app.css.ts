export const DASHBOARD_CSS = `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #16211c;
  background: #f4f7f5;
  font-synthesis: none;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; }
a { color: #0a6543; }
button, input { font: inherit; }

.skip-link {
  position: fixed;
  left: 1rem;
  top: -5rem;
  z-index: 10;
  padding: .75rem 1rem;
  border-radius: .5rem;
  color: white;
  background: #0a6543;
}
.skip-link:focus { top: 1rem; }

main {
  width: min(100% - 2rem, 90rem);
  margin: 0 auto;
  padding: 2.5rem 0 4rem;
}

.page-header, .section-title-row, .pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.page-header { margin-bottom: 2.5rem; }
.eyebrow {
  margin: 0 0 .4rem;
  color: #0a6543;
  font-size: .78rem;
  font-weight: 750;
  letter-spacing: .12em;
  text-transform: uppercase;
}
h1, h2, h3, p { margin-top: 0; }
h1 { margin-bottom: .35rem; font-size: clamp(2rem, 4vw, 3.25rem); letter-spacing: -.04em; }
.lede, .section-title-row p { margin-bottom: 0; color: #5d6963; }
.section-heading { margin-bottom: 1rem; font-size: 1.1rem; }

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}
.summary-card, .panel, .error-state {
  border: 1px solid #d9e1dc;
  border-radius: 1rem;
  background: white;
  box-shadow: 0 12px 32px rgba(27, 53, 41, .05);
}
.summary-card { padding: 1.3rem; }
.summary-card h3 { margin-bottom: 1.25rem; color: #53615a; font-size: .9rem; }
.summary-card p:last-child { margin-bottom: 0; color: #53615a; font-size: .85rem; }
.summary-total { margin-bottom: 0; font-size: 2.2rem; font-weight: 750; line-height: 1; }
.summary-caption { margin: .35rem 0 1.2rem; color: #53615a; font-size: .8rem; text-transform: uppercase; }

.panel { margin-bottom: 1.5rem; padding: 1.35rem; }
.section-title-row { margin-bottom: 1.2rem; }
.section-title-row h2 { margin-bottom: .2rem; }
.filter-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(8rem, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}
label { display: grid; gap: .45rem; color: #445149; font-size: .84rem; font-weight: 650; }
input[type="date"], input[type="search"] {
  width: 100%;
  min-height: 2.6rem;
  padding: .55rem .7rem;
  border: 1px solid #bdc9c2;
  border-radius: .55rem;
  color: #16211c;
  background: white;
}
input:focus, a:focus, button:focus { outline: 3px solid rgba(24, 145, 96, .3); outline-offset: 2px; }
.toggle { display: flex; align-items: center; align-self: end; min-height: 2.6rem; }
.toggle input { width: 1.1rem; height: 1.1rem; }

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.55rem;
  padding: .55rem .9rem;
  border: 1px solid #0a6543;
  border-radius: .55rem;
  color: white;
  background: #0a6543;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}
.button.secondary { color: #0a6543; background: white; }
.button[hidden] { display: none; }

.error-state { margin-bottom: 1.5rem; padding: 1rem 1.2rem; border-color: #e1b8af; background: #fff8f6; }
.error-state p { margin-bottom: .8rem; }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: .87rem; }
th, td { padding: .8rem .7rem; border-bottom: 1px solid #e6ebe8; text-align: left; vertical-align: top; }
th { color: #53615a; font-size: .75rem; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
td { max-width: 23rem; overflow-wrap: anywhere; }
.time-cell, .ip-cell { white-space: nowrap; }
.bot-marker { color: #913b24; font-weight: 700; }
.pagination { margin-top: 1.25rem; }

@media (max-width: 64rem) {
  .filter-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 44rem) {
  main { width: min(100% - 1rem, 90rem); padding-top: 1.25rem; }
  .page-header { align-items: flex-start; }
  .summary-grid { grid-template-columns: 1fr; }
  .filter-grid { grid-template-columns: 1fr; }
  .toggle { align-self: auto; }
}

@media (max-width: 30rem) {
  .page-header, .section-title-row { align-items: stretch; flex-direction: column; }
  .page-header .button { width: 100%; }
}`;
