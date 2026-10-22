export const LOBBY_STYLE = `
.bb-lobby{position:fixed;inset:0;z-index:10;overflow-y:auto;background:#1b1b2f;color:#fff;
  font:16px/1.5 system-ui,'Noto Sans Thai','Sarabun',sans-serif;
  padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));box-sizing:border-box}
.bb-lobby *{box-sizing:border-box}
.bb-wrap{max-width:420px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.bb-title{margin:8px 0 0;font:700 28px/1.2 monospace;text-align:center;letter-spacing:1px}
.bb-sub{margin:0;text-align:center;color:#9aa0c8;font-size:12px;font-family:monospace}
.bb-label{display:block;margin-bottom:4px;font-weight:600}
.bb-input{width:100%;min-height:48px;padding:8px 12px;font:inherit;color:#fff;background:#262645;
  border:2px solid #4a4a7a;border-radius:6px}
.bb-input:focus{outline:none;border-color:#7fd1ff}
.bb-input[aria-invalid=true]{border-color:#ff7a7a}
.bb-error{min-height:1.5em;margin:4px 0 0;color:#ff9a9a;font-size:14px}
.bb-btn{min-height:48px;padding:8px 16px;font:inherit;font-weight:700;color:#1b1b2f;background:#ffd84d;
  border:0;border-radius:6px;cursor:pointer;touch-action:manipulation}
.bb-btn:disabled{opacity:.5;cursor:not-allowed}
.bb-btn:focus-visible{outline:3px solid #7fd1ff;outline-offset:2px}
.bb-btn.bb-ghost{color:#fff;background:#33335c;border:2px solid #4a4a7a}
.bb-h2{margin:8px 0 0;font-size:16px;font-weight:700}
.bb-rooms{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.bb-room{display:flex;width:100%;justify-content:space-between;align-items:center;gap:8px;text-align:left}
.bb-note{margin:0;color:#9aa0c8;font-size:14px}
.bb-card{display:flex;flex-direction:column;gap:12px;padding:16px;background:#262645;border:2px solid #4a4a7a;border-radius:8px}
.bb-card h2{margin:0;font-size:20px;line-height:1.3}
.bb-card p{margin:0}
.bb-actions{display:flex;flex-direction:column;gap:8px}
.bb-hint{margin:0;color:#ffd84d;font-size:14px}
.bb-link{display:flex;align-items:center;justify-content:center;text-decoration:none}
.bb-tabs{display:flex;gap:8px}
.bb-tab{flex:1;min-height:48px;padding:8px;font:inherit;font-weight:700;color:#fff;background:#33335c;
  border:2px solid #4a4a7a;border-radius:6px;cursor:pointer;touch-action:manipulation}
.bb-tab[aria-selected=true]{color:#1b1b2f;background:#ffd84d;border-color:#ffd84d}
.bb-tab:focus-visible{outline:3px solid #7fd1ff;outline-offset:2px}
.bb-rank{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.bb-row{display:grid;grid-template-columns:2em 1fr auto;column-gap:8px;align-items:baseline;padding:8px 12px;
  background:#262645;border:2px solid #4a4a7a;border-radius:6px}
.bb-pos{font-weight:700;color:#ffd84d;font-family:monospace}
.bb-name{overflow-wrap:anywhere}
.bb-val{font-weight:700;text-align:right}
.bb-matches{grid-column:2 / 4;color:#9aa0c8;font-size:12px}
`;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
