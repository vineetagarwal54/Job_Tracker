export const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #111; }
  ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
  input, select, textarea { outline: none; font-family: inherit; }
  .btn { cursor: pointer; border: none; font-family: inherit; transition: all 0.15s; }
  .btn:active { transform: scale(0.97); }
  .job-row { transition: background 0.15s; cursor: pointer; border-radius: 8px; }
  .job-row:hover { background: #14141f !important; }
  .tag { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 6px; font-size: 12px; letter-spacing: 0.03em; font-weight: 600; }
  .filter-select {
    background: #12121c; border: 1px solid #222233; color: #c8cdd5;
    padding: 8px 12px; border-radius: 8px; font-size: 13px; font-family: inherit;
    cursor: pointer; transition: border-color 0.15s;
  }
  .filter-select:focus { border-color: #6366f1; }
  .form-input {
    width: 100%; background: #12121c; border: 1px solid #222233; color: #e2e8f0;
    padding: 10px 14px; border-radius: 8px; font-size: 14px; font-family: inherit;
    transition: border-color 0.15s;
  }
  .form-input:focus { border-color: #6366f1; }
  .form-input::placeholder { color: #4a4f5c; }
  .form-select {
    width: 100%; background: #12121c; border: 1px solid #222233; color: #e2e8f0;
    padding: 10px 14px; border-radius: 8px; font-size: 14px; font-family: inherit; cursor: pointer;
  }
  .action-btn { opacity: 0; transition: opacity 0.15s; }
  .job-row:hover .action-btn { opacity: 1; }
  .action-btn:disabled { cursor: default; pointer-events: none; }
  .tab-btn {
    cursor: pointer; border: none; background: transparent; font-family: inherit;
    font-size: 13px; font-weight: 600; letter-spacing: 0.04em;
    padding: 10px 18px; border-bottom: 2px solid transparent; color: #5a6070;
    transition: all 0.15s;
  }
  .tab-btn.active { color: #a5b4fc; border-bottom-color: #6366f1; }
  .tab-btn:hover { color: #e2e8f0; }
  .jd-box {
    background: #08080d; border: 1px solid #1e1e2e; border-radius: 8px;
    padding: 16px; font-size: 14px; color: #b0b8c8; line-height: 1.8;
    white-space: pre-wrap; max-height: 300px; overflow-y: auto;
  }
  .stat-card {
    padding: 12px 22px; border-right: 1px solid #1a1a2e; min-width: fit-content;
    cursor: pointer; transition: background 0.15s; user-select: none;
  }
  .stat-card:hover { background: #111119; }
`;
