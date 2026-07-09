/* ==========================================================
   Ask Jhezel — Floating Chat Widget (Pulse.bot edition)
   Uses your Cloudflare Worker proxy -> Groq (Llama 3.3 70B).
   NO user login required (unlike Puter.js).
   ----------------------------------------------------------
   SETUP: paste your existing Worker URL below (same one from
   the RCSGuide Ask Jhezel widget).
   ========================================================== */
(function () {
  "use strict";

  // >>> PALITAN MO ITO ng Cloudflare Worker URL mo <<<
  const WORKER_URL = "https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev";

  const SYSTEM_PROMPT = `You are "Ask Jhezel", a virtual assistant modeled after Jhezel Clamosa, team lead at Ridge Capital Solutions (RCS). You help Account Managers and Founders when Jhezel is unavailable, here embedded inside Pulse.bot (the RCS trading performance review tool).

Rules:
- Greet in English. Use Taglish only if the user initiates it.
- No "bossing" language.
- Never give a final refund decision; always say it needs Jhezel's confirmation.
- You can help with: RCS trading systems (R-10, R-50, R-C30, R-X5, R-X25, R-A10), STT FAQ, error codes, objection handling, Velantra partnership, refund eligibility guidelines, and how to use Pulse.bot (upload Account Details screenshot, OCR extracts Balance/Closed Profit/Equity/Growth, add entries per system, then Generate Summary and copy for GHL notes).
- Keep answers short, clear, and practical.`;

  const history = [];

  // ---------- UI ----------
  const css = `
    .jz-fab{position:fixed;bottom:22px;right:22px;z-index:9999;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#7c5cff,#43e0c8);color:#fff;font-size:24px;box-shadow:0 8px 24px rgba(0,0,0,.35);transition:transform .15s}
    .jz-fab:hover{transform:scale(1.07)}
    .jz-panel{position:fixed;bottom:90px;right:22px;z-index:9999;width:min(360px,calc(100vw - 32px));height:480px;display:none;flex-direction:column;border-radius:16px;overflow:hidden;background:#12141c;border:1px solid rgba(255,255,255,.12);box-shadow:0 16px 48px rgba(0,0,0,.5);font-family:Inter,system-ui,sans-serif}
    .jz-panel.open{display:flex}
    .jz-head{padding:12px 16px;background:linear-gradient(135deg,#7c5cff,#43e0c8);color:#fff;font-weight:600;display:flex;justify-content:space-between;align-items:center}
    .jz-head small{display:block;font-weight:400;opacity:.85;font-size:11px}
    .jz-close{background:none;border:none;color:#fff;font-size:18px;cursor:pointer}
    .jz-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
    .jz-msg{max-width:85%;padding:9px 12px;border-radius:12px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
    .jz-msg.user{align-self:flex-end;background:#7c5cff;color:#fff;border-bottom-right-radius:4px}
    .jz-msg.bot{align-self:flex-start;background:#1e2230;color:#e8eaf2;border-bottom-left-radius:4px}
    .jz-msg.typing{opacity:.7;font-style:italic}
    .jz-chips{display:flex;gap:6px;flex-wrap:wrap;padding:0 14px 8px}
    .jz-chip{background:#1e2230;color:#c9cde0;border:1px solid rgba(255,255,255,.15);border-radius:999px;padding:5px 11px;font-size:11.5px;cursor:pointer}
    .jz-chip:hover{background:#2a3046}
    .jz-inputbar{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.1)}
    .jz-inputbar input{flex:1;background:#1e2230;border:1px solid rgba(255,255,255,.15);border-radius:10px;color:#fff;padding:9px 12px;font-size:13.5px;outline:none}
    .jz-send{background:#7c5cff;border:none;border-radius:10px;color:#fff;padding:0 14px;cursor:pointer;font-size:15px}
    .jz-send:disabled{opacity:.5;cursor:default}
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  const fab = document.createElement("button");
  fab.className = "jz-fab";
  fab.type = "button";
  fab.title = "Ask Jhezel";
  fab.textContent = "💬";

  const panel = document.createElement("div");
  panel.className = "jz-panel";
  panel.innerHTML = `
    <div class="jz-head">
      <div>Ask Jhezel<small>RCS Virtual Assistant · Pulse.bot</small></div>
      <button class="jz-close" type="button" aria-label="Close">✕</button>
    </div>
    <div class="jz-msgs" id="jzMsgs"></div>
    <div class="jz-chips" id="jzChips"></div>
    <div class="jz-inputbar">
      <input id="jzInput" type="text" placeholder="Type your question..." maxlength="600">
      <button class="jz-send" id="jzSend" type="button">➤</button>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  const msgs = panel.querySelector("#jzMsgs");
  const input = panel.querySelector("#jzInput");
  const sendBtn = panel.querySelector("#jzSend");
  const chipsEl = panel.querySelector("#jzChips");

  const QUICK_REPLIES = [
    "How do I use Pulse.bot?",
    "Growth % looks wrong",
    "Refund eligibility?",
    "Explain R-X25"
  ];
  QUICK_REPLIES.forEach((q) => {
    const b = document.createElement("button");
    b.className = "jz-chip";
    b.type = "button";
    b.textContent = q;
    b.addEventListener("click", () => { input.value = q; send(); });
    chipsEl.appendChild(b);
  });

  fab.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open") && !msgs.childElementCount) {
      addMsg("bot", "Hi! I'm Ask Jhezel. How can I help you with Pulse.bot or RCS systems today?");
    }
  });
  panel.querySelector(".jz-close").addEventListener("click", () => panel.classList.remove("open"));
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

  function addMsg(role, text, typing) {
    const div = document.createElement("div");
    div.className = "jz-msg " + role + (typing ? " typing" : "");
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    input.value = "";
    addMsg("user", text);
    history.push({ role: "user", content: text });
    sendBtn.disabled = true;
    const typingEl = addMsg("bot", "Typing...", true);

    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...history.slice(-12)
          ]
        })
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      // Supports both Groq/OpenAI-style and simple {reply} responses
      const reply =
        data?.choices?.[0]?.message?.content ||
        data?.reply ||
        data?.content ||
        "Sorry, I couldn't get a response. Please try again.";
      typingEl.classList.remove("typing");
      typingEl.textContent = reply;
      history.push({ role: "assistant", content: reply });
    } catch (err) {
      typingEl.classList.remove("typing");
      typingEl.textContent = "Connection error. Check the Worker URL or try again.";
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }
})();
