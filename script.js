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
  cancelDialogButton: document.getElementById("cancelDialogButton"),
  guideButton: document.getElementById("guideButton"),
  guideDialog: document.getElementById("guideDialog"),
  closeGuideButton: document.getElementById("closeGuideButton")
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
  elements.guideButton.addEventListener("click", openGuide);
  elements.closeGuideButton.addEventListener("click", closeGuide);
  elements.guideDialog.addEventListener("click", handleGuideBackdropClick);
  document.addEventListener("paste", handlePaste);
  window.addEventListener("paste", handlePaste, true);
  elements.uploadZone.addEventListener("paste", handlePaste);
  renderEntries();
}

function openGuide() {
  elements.guideDialog.showModal();
}

function closeGuide() {
  elements.guideDialog.close();
}

function handleGuideBackdropClick(event) {
  if (event.target === elements.guideDialog) {
    closeGuide();
  }
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
  if (event.defaultPrevented) return;

  const clipboard = event.clipboardData || event.originalEvent?.clipboardData;
  const file = getImageFromClipboard(clipboard);

  if (file) {
    event.preventDefault();
    processScreenshot(file);
  }
}

function getImageFromClipboard(clipboard) {
  if (!clipboard) return null;

  const itemFile = Array.from(clipboard.items || [])
    .map((item) => {
      if (item.kind !== "file") return null;
      const file = item.getAsFile();
      return file && file.type.startsWith("image/") ? file : null;
    })
    .find(Boolean);

  if (itemFile) return itemFile;

  return Array.from(clipboard.files || [])
    .find((file) => file.type.startsWith("image/")) || null;
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
      throw new Error("OCR library failed to load.");
    }

    const processedImage = await preprocessImage(file);

    let result = await Tesseract.recognize(processedImage, "eng", {
      logger: ({ status, progress }) => {
        const percent = Math.round((progress || 0) * 100);
        elements.ocrProgress.textContent = `${titleCase(status)} ${percent}%`;
      },
      tessedit_pageseg_mode: 6,
      preserve_interword_spaces: "1"
    });

    if ((result.data.text || "").length < 25) {
      result = await Tesseract.recognize(file, "eng", {
        tessedit_pageseg_mode: 6,
        preserve_interword_spaces: "1"
      });
    }

    state.ocrData = extractMetrics(result.data.text);
    state.ocrData = calculateGrowthFromAccountInfo(state.ocrData);
    logOcrCalculation(state.ocrData);
    updateMetricPreview();
    elements.ocrStatus.textContent = "OCR complete";
    setMessage("Screenshot processed. Review the extracted values.", "success");

  } catch (error) {
    console.error(error);
    state.ocrData = null;
    elements.ocrStatus.textContent = "OCR failed";
    setMessage(error.message || "OCR failed.", "error");
  } finally {
    setLoading(false);
    setButtonsDisabled(false);
  }
}

async function preprocessImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = 4;
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = image.data;
      let total = 0;

      for (let i = 0; i < d.length; i += 4) {
        total += Math.max(d[i], d[i + 1], d[i + 2]);
      }

      const average = total / (d.length / 4);
      const darkBackground = average < 128;
      const threshold = darkBackground
        ? Math.min(245, average + 42)
        : Math.max(10, average - 42);

      for (let i = 0; i < d.length; i += 4) {
        const value = Math.max(d[i], d[i + 1], d[i + 2]);
        const ink = darkBackground ? value > threshold : value < threshold;
        const output = ink ? 0 : 255;

        d[i] = output;
        d[i + 1] = output;
        d[i + 2] = output;
      }
      ctx.putImageData(image, 0, 0);
      canvas.toBlob(resolve);
    };
    img.src = URL.createObjectURL(file);
  });
}

function calculateGrowthFromAccountInfo(ocrData) {
  if (ocrData.balance === null || ocrData.deposits === null || ocrData.deposits === 0) {
    console.warn("Growth not calculated: Balance or Deposits is missing, or Deposits is zero.", {
      balance: ocrData.balance,
      deposits: ocrData.deposits
    });

    return {
      ...ocrData,
      netTradingBalance: null,
      growth: null,
      growthText: ""
    };
  }

  const withdrawals = ocrData.withdrawals ?? 0;
  const netTradingBalance = ocrData.balance - withdrawals;
  const growth = roundToTwo(((netTradingBalance - ocrData.deposits) / ocrData.deposits) * 100);

  return {
    ...ocrData,
    netTradingBalance,
    growth,
    growthText: formatPercent(growth)
  };
}

function roundToTwo(value) {
  return Number(value.toFixed(2));
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

  const balanceMatch = findMoneyValueAndRaw(lines, ["balance"], [], "Balance");
  const closedProfitMatch = findMoneyValueAndRaw(lines, ["profit/loss", "profit loss", "profit"], [], "Closed Profit");
  const equityMatch = findMoneyValueAndRaw(lines, ["equity"], ["equity percentage"], "Equity");
  const depositsMatch = findMoneyValueAndRaw(lines, ["deposits"], [], "Deposits");
  const withdrawalsMatch = findMoneyValueAndRaw(lines, ["withdrawals", "withdrawal"], [], "Withdrawals");

  let balance = balanceMatch.value;
  let closedProfit = closedProfitMatch.value;
  let equity = equityMatch.value;
  let deposits = depositsMatch.value;
  let withdrawals = withdrawalsMatch.value;

  if ([balance, closedProfit, equity].some((value) => value === null)) {
    const money = findAllMoneyValues(rawText);
    if (balance === null && money[1]) balance = parseMoney(money[1], "Balance (fallback)");
    if (closedProfit === null && money[0]) closedProfit = parseMoney(money[0], "Closed Profit (fallback)");
    if (equity === null && money[2]) equity = parseMoney(money[2], "Equity (fallback)");
  }

  const missing = [["Balance", balance], ["Profit/Loss", closedProfit], ["Equity", equity]]
    .filter(([, value]) => value === null)
    .map(([label]) => label);

  if (missing.length) throw new Error(`Could not read ${missing.join(", ")} from this screenshot.`);

  return {
    balance,
    closedProfit,
    equity,
    deposits,
    withdrawals,
    rawBalance: balanceMatch.raw,
    rawDeposits: depositsMatch.raw,
    rawWithdrawals: withdrawalsMatch.raw
  };
}

function normalizeOcrText(rawText) {
  return rawText
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[|]/g, "/").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function findAllMoneyValues(text) {
  return Array.from(text.matchAll(/[-+]?(?:\()?\s*\$?\s*(?:USD\s*)?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?(?:\s*USD)?/gi)).map((match) => match[0].trim());
}

function logOcrCalculation(ocrData) {
  console.log("Raw OCR Balance:", ocrData?.rawBalance ?? null);
  console.log("Raw OCR Deposits:", ocrData?.rawDeposits ?? null);
  console.log("Raw OCR Withdrawals:", ocrData?.rawWithdrawals ?? null);
  console.log("Parsed Balance:", ocrData?.balance ?? null);
  console.log("Parsed Deposits:", ocrData?.deposits ?? null);
  console.log("Parsed Withdrawals:", ocrData?.withdrawals ?? null);
  console.log("Net Trading Balance:", ocrData?.netTradingBalance ?? null);
  console.log("Calculated Growth:", ocrData?.growth ?? null);
  console.log("Final Entry Object:", {
    balance: ocrData?.balance ?? null,
    deposits: ocrData?.deposits ?? null,
    withdrawals: ocrData?.withdrawals ?? null,
    growth: ocrData?.growth ?? null,
    growthText: ocrData?.growthText ?? ""
  });
}

function findMoneyValue(lines, labels, excludedLabels = []) {
  return findMoneyValueAndRaw(lines, labels, excludedLabels).value;
}

function findMoneyValueAndRaw(lines, labels, excludedLabels = [], label = "Value") {
  const raw = findValueNearLabel(lines, labels, moneyPattern(), excludedLabels);
  return {
    value: raw ? parseMoney(raw, label) : null,
    raw
  };
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
      const merged =
    nextLine.replace(/\s+/g, "");

const nextLineValue =
    merged.match(valuePattern) ||
    nextLine.match(valuePattern);
      if (nextLineValue) return nextLineValue[0];
      if (isKnownMetricLabel(nextLine)) break;
    }
  }

  return null;
}

function moneyPattern() {
  return /[-+]?(?:\()?\s*\$?\s*(?:USD\s*)?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?(?:\s*USD)?/i;
}

function percentPattern() {
  return /[-−–—+]?\s*\(?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?\s*%/i;
}

function normalizeLabel(value) {
  return value.toLowerCase().replace(/[^a-z0-9/%]+/g, " ").replace(/\s+/g, " ").trim();
}

function isKnownMetricLabel(value) {
  const normalized = normalizeLabel(value);
  return ["growth", "profit/loss", "profit loss", "profitloss", "balance", "equity", "equity percentage", "deposits", "withdrawals", "withdrawal"]
    .some((label) => normalized.includes(normalizeLabel(label)));
}

function parseMoney(value, label = "Value") {
  const rawValue = String(value || "").trim();
  const normalized = rawValue
    .replace(/\u2212/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-");

  const isNegative = normalized.includes("(") || /^-/.test(normalized);
  const cleanedValue = normalized
    .replace(/\(/g, "")
    .replace(/\)/g, "")
    .replace(/\$/g, "")
    .replace(/USD/gi, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();

  const numericValue = parseFloat(cleanedValue.replace(/-/g, ""));
  const parsedNumber = Number.isNaN(numericValue) ? null : (isNegative ? -numericValue : numericValue);

  console.log(`[Currency Parse] ${label} Raw OCR value:`, rawValue);
  console.log(`[Currency Parse] ${label} Cleaned string:`, cleanedValue);
  console.log(`[Currency Parse] ${label} Parsed float:`, parsedNumber);
  console.log(`[Currency Parse] ${label} Final stored value:`, parsedNumber === null ? null : parsedNumber);

  return parsedNumber;
}

function parsePercent(value) {
  const normalized = String(value || "")
    .replace(/\u2212/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-")
    .replace(/\s+/g, "");

  const negative = /^-/.test(normalized) || normalized.includes("(");
  const numeric = Number(normalized.replace(/[^0-9.]/g, ""));

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
    firstClosedTradeDate: firstCloseDate,
    balance,
    closedProfit: state.ocrData.closedProfit,
    equity,
    floatingPL: equity - balance,
    growth: state.ocrData.growth,
    growthText: state.ocrData.growthText,
    deposits: state.ocrData.deposits,
    withdrawals: state.ocrData.withdrawals,
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
      <td>${formatPercent(entry.growth, entry.growthText)}</td>
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
      growth: entry.growth,
      growthText: entry.growthText,
      deposits: entry.deposits,
      withdrawals: entry.withdrawals
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
    ["Growth", formatPercent(entry.growth, entry.growthText)],
    ["Track Record", entry.trackRecord]
  ];

  return `
    <article class="summary-card ${open ? "open" : ""}">
      <button class="summary-toggle" type="button" aria-label="Toggle ${escapeHtml(entry.system)} summary">
        <strong><span data-indicator>${open ? "▼" : "▶"}</span> ${escapeHtml(entry.system)}</strong>
        <span>${formatMoney(entry.balance)}</span>
        <span>${formatPercent(entry.growth, entry.growthText)}</span>
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
    `Growth: ${formatPercent(entry.growth, entry.growthText)}`,
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
  metricFields.growth.textContent = data ? formatPercent(data.growth, data.growthText) : "--";
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
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  const formatted = Math.abs(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  return value < 0 ? `-${formatted}` : formatted;
}

function formatPercent(value, displayValue = null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return displayValue ?? "";
  }

  if (displayValue) return displayValue;
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


