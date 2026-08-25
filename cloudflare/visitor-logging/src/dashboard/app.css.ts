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
.activity-cell, .counted, .excluded { white-space: nowrap; font-weight: 700; }
.risk-badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.8rem;
  padding: .2rem .45rem;
  border: 1px solid currentColor;
  border-radius: .45rem;
  font-weight: 750;
  white-space: nowrap;
}
.risk-low { color: #166534; background: #f0fdf4; }
.risk-medium { color: #9a6700; background: #fff8db; }
.risk-high { color: #9f2d19; background: #fff0ed; }
.risk-unknown { color: #53615a; background: #f5f7f6; }
.reasons-cell { min-width: 14rem; }
.details-toggle {
  min-height: 2rem;
  padding: .35rem .6rem;
  border: 1px solid #0a6543;
  border-radius: .45rem;
  color: #0a6543;
  background: white;
  font-weight: 700;
  cursor: pointer;
}
.details-toggle:focus { outline: 3px solid rgba(24, 145, 96, .45); outline-offset: 3px; }
.details-row > td { padding: 0; border-bottom: 0; }
.details-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  padding: 1rem;
  border-top: 2px solid #b9d8c9;
  border-bottom: 1px solid #d9e1dc;
  background: #f8fbf9;
}
.detail-group {
  min-width: 0;
  padding: .85rem;
  border: 1px solid #d9e1dc;
  border-radius: .6rem;
  background: white;
}
.detail-group h3 { margin-bottom: .75rem; font-size: .9rem; }
.detail-list { display: grid; grid-template-columns: minmax(7rem, .8fr) minmax(0, 1.2fr); gap: .35rem .7rem; margin: 0; }
.detail-list dt { color: #53615a; font-weight: 700; }
.detail-list dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
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
  .details-panel { grid-template-columns: 1fr; }
  .detail-list { grid-template-columns: 1fr; }
  .detail-list dt { margin-top: .45rem; }
}

@media (max-width: 30rem) {
  .page-header, .section-title-row { align-items: stretch; flex-direction: column; }
  .page-header .button { width: 100%; }
}`;
