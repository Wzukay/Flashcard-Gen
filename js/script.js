
import { PRESET_TEXTS } from "./presets.js";

const WORKER_URL = "https://flashcard-proxy.flashcard-gen.workers.dev";

const sourceText = document.getElementById("source-text");
const wordCountLabel = document.getElementById("word-count-label");
const generateBtn = document.getElementById("generate-btn");
const btnLabel = document.getElementById("btn-label");
const btnIcon = document.getElementById("btn-icon");
const statusText = document.getElementById("status-text");
const errorBox = document.getElementById("error-box");
const errorMessage = document.getElementById("error-message");
const cardsGrid = document.getElementById("cards-grid");
const resetBtn = document.getElementById("reset-btn");
const presetsList = document.getElementById("presets-list");

const MIN_WORDS = 50;

// Keeps every card front generated so far for the current text, so a
// regenerate can be told what's already been covered and avoid repeats.
// This resets whenever the source text changes, since "don't repeat"
// only makes sense relative to the same passage.
let seenFronts = [];
let lastSourceText = "";

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function updateWordCount() {
  const count = countWords(sourceText.value);
  wordCountLabel.textContent =
    count < MIN_WORDS
      ? `YOUR TEXT (${count} words — need ${MIN_WORDS}+)`
      : `YOUR TEXT (${count} words)`;
  generateBtn.disabled = count < MIN_WORDS;
}

sourceText.addEventListener("input", updateWordCount);

function setLoading(isLoading) {
  generateBtn.disabled = isLoading || countWords(sourceText.value) < MIN_WORDS;
  if (isLoading) {
    btnLabel.textContent = "Generating…";
  } else {
    btnLabel.textContent = seenFronts.length > 0 ? "Generate more" : "Generate cards";
  }
  btnIcon.classList.toggle("spin", isLoading);
  btnIcon.innerHTML = isLoading
    ? '<path d="M21 12a9 9 0 1 1-9-9" stroke-linecap="round"/>'
    : '<path d="M12 3v18M3 12h18" stroke-linecap="round"/>';
  resetBtn.hidden = seenFronts.length === 0;
}

function resetCards() {
  seenFronts = [];
  cardsGrid.innerHTML = "";
  statusText.textContent = "";
  resetBtn.hidden = true;
  btnLabel.textContent = "Generate cards";
}

function showError(message) {
  errorMessage.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
}

// Calls the Gemini API, automatically retrying a few times if the
// server reports it's overloaded (503). Each retry waits longer than
// the last. Any other error (bad key, bad request, etc.) fails right
// away since retrying won't help those.
async function fetchGeminiWithRetry(requestBody) {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error("Worker error response:", errBody);
    throw new Error(`API request failed (${response.status})`);
  }

  return response;
}

async function generateCards() {
  hideError();
  statusText.textContent = "";
  setLoading(true);

  // If the text changed since last time, this is a fresh passage —
  // old "don't repeat" history no longer applies.
  if (sourceText.value !== lastSourceText) {
    seenFronts = [];
    lastSourceText = sourceText.value;
    cardsGrid.innerHTML = "";
  }

  const avoidBlock =
    seenFronts.length > 0
      ? `\n\nDo NOT repeat or closely rephrase any of these already-used flashcard fronts:\n${seenFronts
        .map((f) => `- ${f}`)
        .join("\n")}\n\nCover different facts, terms, or angles from the text instead.`
      : "";

  try {
    const response = await fetchGeminiWithRetry({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Read the following text and produce study flashcards from it. The text may be in Romanian or English — write the flashcards in the same language as the source text. Extract the key facts, terms, and concepts. Return ONLY a JSON array, no preamble, no markdown fences, in this exact shape:
[{"front": "question or term", "back": "answer or definition"}]

Aim for 6-12 cards depending on how much content supports it. Keep fronts short (a question or a term). Keep backs concise (1-2 sentences max).${avoidBlock}

TEXT:
${sourceText.value}`,
            },
          ],
        },
      ],
    });

    const data = await response.json();
    console.log("Full Gemini response:", data);
    const raw = data.candidates[0].content.parts.map((p) => p.text || "").join("").trim();
    console.log("Raw text from Gemini:", raw);
    const cleaned = raw.replace(/^```json\s*|^```\s*|```\s*$/g, "").trim();
    console.log("Cleaned text:", cleaned);
    const cards = JSON.parse(cleaned);

    if (!Array.isArray(cards) || cards.length === 0) {
      throw new Error("No cards came back");
    }

    seenFronts.push(...cards.map((c) => c.front));
    appendCards(cards);
    statusText.textContent = `${cardsGrid.children.length} cards so far · click a card to flip it`;
  } catch (err) {
    console.error(err);
    showError("Couldn't generate cards from that text. Try again, or trim it down.");
  } finally {
    setLoading(false);
  }
}

function appendCards(cards) {
  const startIndex = cardsGrid.children.length;

  cards.forEach((card, offset) => {
    const i = startIndex + offset;
    const scene = document.createElement("div");
    scene.className = "card-scene";

    const flip = document.createElement("div");
    flip.className = "card-flip";
    flip.tabIndex = 0;
    flip.setAttribute("role", "button");
    flip.setAttribute("aria-label", `Flashcard ${i + 1}, click to flip`);

    const num = String(i + 1).padStart(2, "0");

    flip.innerHTML = `
      <div class="card-face card-front">
        <div class="punch"></div>
        <div class="card-rule"></div>
        <p class="card-tag">${num} · FRONT</p>
        <p class="card-front-text"></p>
        <p class="flip-hint">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          tap to flip
        </p>
      </div>
      <div class="card-face card-back">
        <div class="punch"></div>
        <div class="card-rule"></div>
        <p class="card-tag">${num} · BACK</p>
        <p class="card-back-text"></p>
      </div>
    `;

    // Set text via textContent to avoid any HTML injection from the model output
    flip.querySelector(".card-front-text").textContent = card.front || "";
    flip.querySelector(".card-back-text").textContent = card.back || "";

    flip.addEventListener("click", () => flip.classList.toggle("is-flipped"));
    flip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        flip.classList.toggle("is-flipped");
      }
    });

    scene.appendChild(flip);
    cardsGrid.appendChild(scene);
  });
}

function renderPresets() {
  presetsList.innerHTML = "";

  if (!PRESET_TEXTS || PRESET_TEXTS.length === 0) {
    const empty = document.createElement("p");
    empty.className = "presets-empty";
    empty.textContent = "Add entries to presets.js to see them here.";
    presetsList.appendChild(empty);
    return;
  }

  PRESET_TEXTS.forEach((preset) => {
    const li = document.createElement("li");
    li.className = "preset-item";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = preset.title;
    btn.addEventListener("click", () => loadPreset(preset));

    li.appendChild(btn);
    presetsList.appendChild(li);
  });
}

function loadPreset(preset) {
  sourceText.value = preset.text;
  updateWordCount();
  sourceText.focus();
}

generateBtn.addEventListener("click", generateCards);
resetBtn.addEventListener("click", resetCards);
updateWordCount();
renderPresets();