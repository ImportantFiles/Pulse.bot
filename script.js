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
    state.ocrData.growth = await refineGrowthValue(file, processedImage, result, state.ocrData.growth);
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

async function refineGrowthValue(originalFile, processedImage, result, currentGrowth) {
  try {
    const crop = await cropAroundGrowth(processedImage, result);
    if (crop) {
      const cropText = await recognizeGrowthCrop(crop);
      const cropGrowth = extractGrowthFromText(cropText);

      if (cropGrowth !== null && (cropGrowth < 0 || currentGrowth === null)) {
        return cropGrowth;
      }
    }

    if (currentGrowth > 0 && await isGrowthValueRed(originalFile, processedImage, result)) {
      return -Math.abs(currentGrowth);
    }

    return currentGrowth;
  } catch {
    return currentGrowth;
  }
}

async function recognizeGrowthCrop(image) {
  const result = await Tesseract.recognize(image, "eng", {
    tessedit_pageseg_mode: 7,
    tessedit_char_whitelist: "Growthgrowth0123456789.,%-−–—() ",
    preserve_interword_spaces: "1"
  });

  return result.data.text || "";
}

async function cropAroundGrowth(image, result) {
  const growthWord = findGrowthWord(result);

  if (!growthWord) return null;

  const bitmap = await createImageBitmap(image);
  const { x0, y0, x1, y1 } = growthWord.bbox;
  const paddingX = 70;
  const paddingY = 80;
  const sx = Math.max(0, x0 - paddingX);
  const sy = Math.max(0, y0 - paddingY);
  const sw = Math.min(bitmap.width - sx, Math.max(260, x1 - sx + 360));
  const sh = Math.min(bitmap.height - sy, Math.max(130, y1 - sy + 170));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve) => canvas.toBlob(resolve));
}

async function isGrowthValueRed(originalFile, processedImage, result) {
  const growthWord = findGrowthWord(result);
  if (!growthWord) return false;

  const [originalBitmap, processedBitmap] = await Promise.all([
    createImageBitmap(originalFile),
    createImageBitmap(processedImage)
  ]);
  const scaleX = originalBitmap.width / processedBitmap.width;
  const scaleY = originalBitmap.height / processedBitmap.height;
  const { x0, y1 } = growthWord.bbox;
  const sx = Math.max(0, Math.floor((x0 * scaleX) - 8));
  const sy = Math.max(0, Math.floor((y1 * scaleY) + 2));
  const sw = Math.min(originalBitmap.width - sx, 170);
  const sh = Math.min(originalBitmap.height - sy, 54);
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(originalBitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  const { data } = ctx.getImageData(0, 0, sw, sh);
  let redPixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const red = data[i];
    const green = data[i + 1];
    const blue = data[i + 2];

    if (red > 130 && red > green * 1.35 && red > blue * 1.25 && green < 145) {
      redPixels += 1;
    }
  }

  return redPixels >= 12;
}

function findGrowthWord(result) {
  return (result.data.words || [])
    .find((word) => /growth/i.test(word.text || "") && word.bbox);
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

  let balance = findMoneyValue(lines, ["balance"]);
  let closedProfit = findMoneyValue(lines, ["profit/loss","profit loss","profit"]);
  let equity = findMoneyValue(lines, ["equity"], ["equity percentage"]);
  let growth = null;

for (let i = 0; i < lines.length; i++) {

    if (!/growth/i.test(lines[i])) continue;

    // kunin ang susunod na 3 lines
    const block = lines.slice(i, i + 4).join(" ");

    // check kung may minus bago ang percent
    const m = block.match(/([-−–—]?)\s*(\d+(?:\.\d+)?)\s*%/);

    if (m) {

        growth = parseFloat(m[2]);

        if (m[1])
            growth *= -1;

        break;
    }
}

  if ([balance, closedProfit, equity, growth].some(v => v === null)) {
    const money = rawText.match(/[-−–—]?\d[\d,]*\.\d+\s?USD/g) || [];
    const percent = rawText.match(/[-−–—]?\d+(?:\.\d+)?\s?%/g) || [];
    if (balance === null && money[1]) balance = parseMoney(money[1]);
    if (closedProfit === null && money[0]) closedProfit = parseMoney(money[0]);
    if (equity === null && money[2]) equity = parseMoney(money[2]);
    if (growth === null && percent[0]) growth = parsePercent(percent[0]);
  }

  const missing = [["Balance",balance],["Profit/Loss",closedProfit],["Equity",equity],["Growth",growth]]
    .filter(([,v])=>v===null).map(([k])=>k);

  if (missing.length) throw new Error(`Could not read ${missing.join(", ")} from this screenshot.`);

  return { balance, closedProfit, equity, growth };
}

function normalizeOcrText(rawText) {
  return rawText
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[|]/g, "/").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractGrowthFromText(rawText) {
  const lines = normalizeOcrText(rawText);

  for (let i = 0; i < lines.length; i += 1) {
    if (!/growth/i.test(lines[i])) continue;

    const block = lines.slice(i, i + 4).join(" ");
    const match = block.match(percentPattern());

    if (match) return parsePercent(match[0]);
  }

  const percent = rawText.match(percentPattern());
  return percent ? parsePercent(percent[0]) : null;
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
  return /[-+]?\(?\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\)?(?:\s?USD)?|[-+]?\(?\$?\s?\d+(?:\.\d{1,2})?\)?(?:\s?USD)?/i;
}

function percentPattern() {
  return /[-−–—+]?\s*\(?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?\s*%/i;
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

  value = value
    .replace(/\u2212/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-");

  const negative =
    value.includes("(") ||
    value.includes("-");

  const numeric = Number(
    value
      .replace(/USD/gi, "")
      .replace(/[$,\s(),-]/g, "")
  );

  if (Number.isNaN(numeric)) return null;

  return negative ? -numeric : numeric;
}

function parsePercent(value) {

    value = value
        .replace(/\u2212/g, "-")
        .replace(/\u2013/g, "-")
        .replace(/\u2014/g, "-")
        .replace(/\s+/g, "");

    const negative = /^-/.test(value) || value.includes("(");

    const numeric = Number(
        value.replace(/[^0-9.]/g, "")
    );

    if (Number.isNaN(numeric))
        return null;

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
    floatingPL: equity - balance,
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


