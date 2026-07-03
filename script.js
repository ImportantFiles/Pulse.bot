const state = {
  entries: [],
  ocrData: null,
  screenshotFile: null,
  previewUrl: null,
  summaryGenerated: false,
  editingId: null
};

const elements = {
  entryForm: document.getElementById("entryForm"),
  uploadZone: document.getElementById("uploadZone"),
  screenshotInput: document.getElementById("screenshotInput"),
  uploadEmpty: document.getElementById("uploadEmpty"),
  previewImage: document.getElementById("previewImage"),
  systemSelect: document.getElementById("systemSelect"),
  firstCloseDate: document.getElementById("firstCloseDate"),
  balanceValue: document.getElementById("balanceValue"),
  closedProfitValue: document.getElementById("closedProfitValue"),
  equityValue: document.getElementById("equityValue"),
  growthValue: document.getElementById("growthValue"),
  formMessage: document.getElementById("formMessage"),
  addEntryButton: document.getElementById("addEntryButton"),
  ocrStatus: document.getElementById("ocrStatus"),
  entryCount: document.getElementById("entryCount"),
  entriesBody: document.getElementById("entriesBody"),
  generateButton: document.getElementById("generateButton"),
  copyButton: document.getElementById("copyButton"),
  summaryContainer: document.getElementById("summaryContainer"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  ocrProgress: document.getElementById("ocrProgress"),
  copyDialog: document.getElementById("copyDialog"),
  startNewButton: document.getElementById("startNewButton"),
  cancelDialogButton: document.getElementById("cancelDialogButton")
};

const metricFields = {
  balance: elements.balanceValue,
  closedProfit: elements.closedProfitValue,
  equity: elements.equityValue,
  growth: elements.growthValue
};

document.addEventListener("DOMContentLoaded", initializeApp);

function initializeApp() {
  elements.uploadZone.addEventListener("click", () => elements.screenshotInput.click());
  elements.uploadZone.addEventListener("keydown", handleUploadKeydown);
  elements.uploadZone.addEventListener("dragover", handleDragOver);
  elements.uploadZone.addEventListener("dragleave", handleDragLeave);
  elements.uploadZone.addEventListener("drop", handleDrop);
  elements.screenshotInput.addEventListener("change", handleFileSelection);
  elements.entryForm.addEventListener("submit", handleEntrySubmit);
  elements.generateButton.addEventListener("click", generateSummary);
  elements.copyButton.addEventListener("click", copySummaryToClipboard);
  elements.startNewButton.addEventListener("click", startNewReview);
  elements.cancelDialogButton.addEventListener("click", () => elements.copyDialog.close());
  document.addEventListener("paste", handlePaste);
  renderEntries();
}

function handleUploadKeydown(event) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.screenshotInput.click();
  }
}

function handleDragOver(event) {
  event.preventDefault();
  elements.uploadZone.classList.add("dragging");
}

function handleDragLeave() {
  elements.uploadZone.classList.remove("dragging");
}

function handleDrop(event) {
  event.preventDefault();
  elements.uploadZone.classList.remove("dragging");
  const file = event.dataTransfer.files[0];
  if (file) processScreenshot(file);
}

function handleFileSelection(event) {
  const file = event.target.files[0];
  if (file) processScreenshot(file);
}

function handlePaste(event) {
  const imageItem = Array.from(event.clipboardData?.items || []).find((item) => item.type.startsWith("image/"));
  if (imageItem) {
    processScreenshot(imageItem.getAsFile());
  }
}

async function processScreenshot(file) {
  if (!file || !["image/png", "image/jpeg"].includes(file.type)) {
    setMessage("Please upload a PNG, JPG, or JPEG screenshot.", "error");
    return;
  }

  resetOcrData();
  state.screenshotFile = file;
  showPreview(file);
  setLoading(true, "Preparing screenshot...");
  setButtonsDisabled(true);

  try {
    if (!window.Tesseract) {
      throw new Error("OCR library failed to load. Please check your connection and refresh.");
    }

    const result = await Tesseract.recognize(file, "eng", {
      logger: ({ status, progress }) => {
        const percent = Math.round((progress || 0) * 100);
        elements.ocrProgress.textContent = `${titleCase(status)} ${percent}%`;
      }
    });

    state.ocrData = extractMetrics(result.data.text);
    updateMetricPreview();
    elements.ocrStatus.textContent = "OCR complete";
    setMessage("Screenshot processed. Review the extracted values, then add the entry.", "success");
  } catch (error) {
    state.ocrData = null;
    elements.ocrStatus.textContent = "OCR failed";
    setMessage(error.message || "OCR failed. Please try a clearer screenshot.", "error");
  } finally {
    setLoading(false);
    setButtonsDisabled(false);
  }
}

function showPreview(file) {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(file);
  elements.previewImage.src = state.previewUrl;
  elements.previewImage.hidden = false;
  elements.uploadEmpty.hidden = true;
}

function extractMetrics(rawText) {
  const lines = normalizeOcrText(rawText);
  const balance = findMoneyValue(lines, ["balance"]);
  const closedProfit = findMoneyValue(lines, ["profit/loss", "profit loss", "profitloss", "profit/l0ss", "profit"]);
  const equity = findMoneyValue(lines, ["equity"], ["equity percentage"]);
  const growth = findPercentValue(lines, ["growth"]);
  const missing = [
    ["Balance", balance],
    ["Profit/Loss", closedProfit],
    ["Equity", equity],
    ["Growth", growth]
  ].filter(([, value]) => value === null).map(([label]) => label);

  if (missing.length) {
    throw new Error(`Could not read ${missing.join(", ")} from this screenshot. Try a sharper crop or brighter screenshot.`);
  }

  return { balance, closedProfit, equity, growth };
}

function normalizeOcrText(rawText) {
  return rawText
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[|]/g, "/").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function findMoneyValue(lines, labels, excludedLabels = []) {
  const value = findValueNearLabel(lines, labels, moneyPattern(), excludedLabels);
  return value ? parseMoney(value) : null;
}

function findPercentValue(lines, labels, excludedLabels = []) {
  const value = findValueNearLabel(lines, labels, percentPattern(), excludedLabels);
  return value ? parsePercent(value) : null;
}

function findValueNearLabel(lines, labels, valuePattern, excludedLabels = []) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeLabel(line);

    if (excludedLabels.some((label) => normalizedLine.includes(normalizeLabel(label)))) {
      continue;
    }

    const matchedLabel = labels.find((label) => normalizedLine.includes(normalizeLabel(label)));
    if (!matchedLabel) continue;

    const sameLineValue = line.slice(normalizedLine.indexOf(normalizeLabel(matchedLabel)) + matchedLabel.length).match(valuePattern);
    if (sameLineValue) return sameLineValue[0];

    for (let offset = 1; offset <= 4 && index + offset < lines.length; offset += 1) {
      const nextLine = lines[index + offset];
      const nextLineValue = nextLine.match(valuePattern);
      if (nextLineValue) return nextLineValue[0];
      if (isKnownMetricLabel(nextLine)) break;
    }
  }

  return null;
}

function moneyPattern() {
  return /[-+]?\(?\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\)?(?:\s?USD)?|[-+]?\(?\$?\s?\d+(?:\.\d{1,2})?\)?(?:\s?USD)?/i;
}

function percentPattern() {
  return /[-+]?\(?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?\s?%/i;
}

function normalizeLabel(value) {
  return value.toLowerCase().replace(/[^a-z0-9/%]+/g, " ").replace(/\s+/g, " ").trim();
}

function isKnownMetricLabel(value) {
  const normalized = normalizeLabel(value);
  return ["growth", "profit/loss", "profit loss", "profitloss", "balance", "equity", "equity percentage"]
    .some((label) => normalized.includes(normalizeLabel(label)));
}

function parseMoney(value) {
  const negative = value.includes("(") || value.trim().startsWith("-");
  const numeric = Number(value.replace(/USD/gi, "").replace(/[$,\s()+-]/g, ""));
  if (Number.isNaN(numeric)) return null;
  return negative ? -numeric : numeric;
}

function parsePercent(value) {
  const negative = value.includes("(") || value.trim().startsWith("-");
  const numeric = Number(value.replace(/[,%()\s+-]/g, ""));
  if (Number.isNaN(numeric)) return null;
  return negative ? -numeric : numeric;
}

function handleEntrySubmit(event) {
  event.preventDefault();
  const validation = validateEntryForm();

  if (!validation.valid) {
    setMessage(validation.message, "error");
    return;
  }

  const entry = buildEntry(validation.date);

  if (state.editingId) {
    state.entries = state.entries.map((item) => (item.id === state.editingId ? { ...entry, id: state.editingId } : item));
    state.editingId = null;
    elements.addEntryButton.textContent = "+ Add Entry";
  } else {
    state.entries.push(entry);
  }

  resetEntryForm();
  state.summaryGenerated = false;
  elements.summaryContainer.hidden = true;
  elements.copyButton.disabled = true;
  renderEntries();
  setMessage("Entry saved.", "success");
}

function validateEntryForm() {
  if (!state.screenshotFile) return { valid: false, message: "Upload a screenshot before adding an entry." };
  if (!state.ocrData) return { valid: false, message: "OCR must complete successfully before adding an entry." };
  if (!elements.systemSelect.value) return { valid: false, message: "Select a trading system." };

  const date = parseTradeDate(elements.firstCloseDate.value);
  if (!date) return { valid: false, message: "Enter a valid first closed trade date, such as 2/18/2025." };

  return { valid: true, date };
}

function buildEntry(firstCloseDate) {
  const balance = state.ocrData.balance;
  const equity = state.ocrData.equity;

  return {
    id: crypto.randomUUID(),
    system: elements.systemSelect.value,
    balance,
    closedProfit: state.ocrData.closedProfit,
    equity,
    floatingPL: balance - equity,
    growth: state.ocrData.growth,
    trackRecord: calculateTrackRecord(firstCloseDate)
  };
}

function parseTradeDate(value) {
  const match = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

function calculateTrackRecord(firstCloseDate) {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const firstCloseMidnight = new Date(firstCloseDate.getFullYear(), firstCloseDate.getMonth(), firstCloseDate.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(0, Math.round((todayMidnight - firstCloseMidnight) / dayMs));
  return `${days} Days`;
}

function renderEntries() {
  elements.entryCount.textContent = `${state.entries.length} saved`;

  if (!state.entries.length) {
    elements.entriesBody.innerHTML = '<tr class="empty-row"><td colspan="8">No entries added yet.</td></tr>';
    return;
  }

  elements.entriesBody.innerHTML = state.entries.map((entry) => `
    <tr>
      <td>${escapeHtml(entry.system)}</td>
      <td>${formatMoney(entry.balance)}</td>
      <td>${formatMoney(entry.closedProfit)}</td>
      <td>${formatMoney(entry.equity)}</td>
      <td>${formatMoney(entry.floatingPL)}</td>
      <td>${formatPercent(entry.growth)}</td>
      <td>${escapeHtml(entry.trackRecord)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" type="button" data-action="edit" data-id="${entry.id}">Edit</button>
          <button class="danger-button" type="button" data-action="delete" data-id="${entry.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");

  elements.entriesBody.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", handleEntryAction);
  });
}

function handleEntryAction(event) {
  const { action, id } = event.currentTarget.dataset;
  const entry = state.entries.find((item) => item.id === id);

  if (action === "delete") {
    state.entries = state.entries.filter((item) => item.id !== id);
    state.summaryGenerated = false;
    elements.summaryContainer.hidden = true;
    elements.copyButton.disabled = true;
    renderEntries();
    return;
  }

  if (action === "edit" && entry) {
    state.editingId = id;
    state.ocrData = {
      balance: entry.balance,
      closedProfit: entry.closedProfit,
      equity: entry.equity,
      growth: entry.growth
    };
    state.screenshotFile = new File(["edited"], "existing-entry.png", { type: "image/png" });
    elements.systemSelect.value = entry.system;
    elements.firstCloseDate.value = "";
    elements.previewImage.hidden = true;
    elements.uploadEmpty.hidden = false;
    elements.ocrStatus.textContent = "Editing values";
    elements.addEntryButton.textContent = "Save Entry";
    updateMetricPreview();
    setMessage("Editing selected entry. Re-enter the first closed trade date to recalculate track record.", "success");
  }
}

function generateSummary() {
  if (!state.entries.length) {
    setMessage("Add at least one entry before generating a summary.", "error");
    return;
  }

  state.summaryGenerated = true;
  elements.summaryContainer.hidden = false;
  elements.copyButton.disabled = false;
  elements.summaryContainer.innerHTML = state.entries.map((entry, index) => renderSummaryCard(entry, index === 0)).join("");

  elements.summaryContainer.querySelectorAll(".summary-toggle").forEach((button) => {
    button.addEventListener("click", () => toggleSummaryCard(button));
  });
}

function toggleSummaryCard(button) {
  const card = button.closest(".summary-card");
  card.classList.toggle("open");
  const indicator = button.querySelector("[data-indicator]");
  indicator.textContent = card.classList.contains("open") ? "▼" : "▶";
}

function renderSummaryCard(entry, open) {
  const fields = [
    ["System", entry.system],
    ["Balance", formatMoney(entry.balance)],
    ["Closed Profit", formatMoney(entry.closedProfit)],
    ["Equity", formatMoney(entry.equity)],
    ["Floating P/L", formatMoney(entry.floatingPL)],
    ["Growth", formatPercent(entry.growth)],
    ["Track Record", entry.trackRecord]
  ];

  return `
    <article class="summary-card ${open ? "open" : ""}">
      <button class="summary-toggle" type="button" aria-label="Toggle ${escapeHtml(entry.system)} summary">
        <strong><span data-indicator>${open ? "▼" : "▶"}</span> ${escapeHtml(entry.system)}</strong>
        <span>${formatMoney(entry.balance)}</span>
        <span>${formatPercent(entry.growth)}</span>
      </button>
      <div class="summary-content">
        <div class="summary-inner">
          <div class="summary-fields">
            ${fields.map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
          </div>
        </div>
      </div>
    </article>
  `;
}

async function copySummaryToClipboard() {
  if (!state.summaryGenerated) return;

  try {
    await navigator.clipboard.writeText(buildPlainTextSummary());
    elements.copyDialog.showModal();
  } catch {
    setMessage("Clipboard access was blocked. Please generate again and retry in a secure browser context.", "error");
  }
}

function buildPlainTextSummary() {
  return state.entries.map((entry) => [
    `System: ${entry.system}`,
    `Balance: ${formatMoney(entry.balance)}`,
    `Closed Profit: ${formatMoney(entry.closedProfit)}`,
    `Equity: ${formatMoney(entry.equity)}`,
    `Floating P/L: ${formatMoney(entry.floatingPL)}`,
    `Growth: ${formatPercent(entry.growth)}`,
    `Track Record: ${entry.trackRecord}`
  ].join("\n")).join("\n\n───────────────────\n\n");
}

function startNewReview() {
  state.entries = [];
  state.summaryGenerated = false;
  state.editingId = null;
  resetEntryForm();
  elements.summaryContainer.innerHTML = "";
  elements.summaryContainer.hidden = true;
  elements.copyButton.disabled = true;
  elements.copyDialog.close();
  renderEntries();
  setMessage("", "");
}

function resetEntryForm() {
  state.screenshotFile = null;
  resetOcrData();
  elements.screenshotInput.value = "";
  elements.systemSelect.value = "";
  elements.firstCloseDate.value = "";
  elements.previewImage.src = "";
  elements.previewImage.hidden = true;
  elements.uploadEmpty.hidden = false;
  elements.ocrStatus.textContent = "Awaiting screenshot";
  elements.addEntryButton.textContent = "+ Add Entry";
}

function resetOcrData() {
  state.ocrData = null;
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
  updateMetricPreview();
}

function updateMetricPreview() {
  const data = state.ocrData;
  metricFields.balance.textContent = data ? formatMoney(data.balance) : "--";
  metricFields.closedProfit.textContent = data ? formatMoney(data.closedProfit) : "--";
  metricFields.equity.textContent = data ? formatMoney(data.equity) : "--";
  metricFields.growth.textContent = data ? formatPercent(data.growth) : "--";
}

function setLoading(active, text = "Reading screenshot...") {
  elements.loadingOverlay.hidden = !active;
  elements.ocrProgress.textContent = text;
}

function setButtonsDisabled(disabled) {
  elements.addEntryButton.disabled = disabled;
  elements.generateButton.disabled = disabled;
  elements.copyButton.disabled = disabled || !state.summaryGenerated;
}

function setMessage(message, type) {
  elements.formMessage.textContent = message;
  elements.formMessage.className = `message ${type || ""}`.trim();
}

function formatMoney(value) {
  const formatted = Math.abs(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  return value < 0 ? `-${formatted}` : formatted;
}

function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}

function titleCase(value = "") {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
