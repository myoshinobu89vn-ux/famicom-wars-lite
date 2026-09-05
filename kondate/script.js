'use strict';

const STORAGE_KEY_INGREDIENTS = 'kondate_ingredients_v1';
const STORAGE_KEY_HISTORY = 'kondate_history_v1';
const GENRES = ['和', '洋', '中', '他'];
const TIME_OPTIONS = [10, 20, 30, 45];
const RECENT_EXCLUDE_COUNT = 5;

// ----- 永続化 -----

function loadIngredients() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY_INGREDIENTS)) || {};
  } catch (e) {
    saved = {};
  }
  return saved;
}

function saveIngredient(key, value) {
  const ingredients = loadIngredients();
  ingredients[key] = value;
  localStorage.setItem(STORAGE_KEY_INGREDIENTS, JSON.stringify(ingredients));
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || [];
  } catch (e) {
    return [];
  }
}

function addHistoryEntry(name) {
  const history = loadHistory();
  history.unshift({ name, date: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
}

function getRecentDishNames() {
  const history = loadHistory();
  const names = [];
  for (const entry of history) {
    if (!names.includes(entry.name)) names.push(entry.name);
    if (names.length >= RECENT_EXCLUDE_COUNT) break;
  }
  return names;
}

// ----- アプリ状態 -----

const state = {
  selectedGenres: new Set(GENRES),
  selectedTime: 30,
  timePriority: false,
};

// ----- 画面切り替え -----

const screens = {
  top: document.getElementById('screen-top'),
  ingredients: document.getElementById('screen-ingredients'),
  result: document.getElementById('screen-result'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== name);
  });
}

// ----- トップ画面: ジャンル・時間 -----

function renderGenreOptions() {
  const container = document.getElementById('genre-options');
  container.innerHTML = '';
  GENRES.forEach((genre) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.selectedGenres.has(genre) ? ' chip-active' : '');
    chip.textContent = genre;
    chip.addEventListener('click', () => {
      if (state.selectedGenres.has(genre)) {
        if (state.selectedGenres.size > 1) state.selectedGenres.delete(genre);
      } else {
        state.selectedGenres.add(genre);
      }
      renderGenreOptions();
    });
    container.appendChild(chip);
  });
}

function renderTimeOptions() {
  const container = document.getElementById('time-options');
  container.innerHTML = '';
  TIME_OPTIONS.forEach((time) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.selectedTime === time ? ' chip-active' : '');
    chip.textContent = `${time}分`;
    chip.addEventListener('click', () => {
      state.selectedTime = time;
      renderTimeOptions();
    });
    container.appendChild(chip);
  });
}

document.getElementById('time-priority-toggle').addEventListener('change', (e) => {
  state.timePriority = e.target.checked;
});

// ----- 保有食材ページ -----

let activeSeasoningTab = SEASONING_TABS[0].key;

function renderIngredientCheckbox(key, label, ingredients) {
  const row = document.createElement('label');
  row.className = 'ingredient-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = Boolean(ingredients[key]);
  checkbox.addEventListener('change', () => {
    saveIngredient(key, checkbox.checked);
  });

  const span = document.createElement('span');
  span.textContent = label;

  row.appendChild(checkbox);
  row.appendChild(span);
  return row;
}

function renderIngredientCategories() {
  const ingredients = loadIngredients();
  const container = document.getElementById('ingredient-categories');
  container.innerHTML = '';

  INGREDIENT_CATEGORIES.forEach((category) => {
    const card = document.createElement('section');
    card.className = 'card';

    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = category.label;
    card.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'ingredient-grid';
    category.items.forEach(([key, label]) => {
      grid.appendChild(renderIngredientCheckbox(key, label, ingredients));
    });
    card.appendChild(grid);

    container.appendChild(card);
  });
}

function renderSeasoningTabs() {
  const tabBar = document.getElementById('seasoning-tabs');
  tabBar.innerHTML = '';
  SEASONING_TABS.forEach((tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab' + (tab.key === activeSeasoningTab ? ' tab-active' : '');
    button.textContent = tab.label;
    button.addEventListener('click', () => {
      activeSeasoningTab = tab.key;
      renderSeasoningTabs();
      renderSeasoningPanel();
    });
    tabBar.appendChild(button);
  });
}

function renderSeasoningPanel() {
  const ingredients = loadIngredients();
  const panel = document.getElementById('seasoning-panel');
  panel.innerHTML = '';

  const tab = SEASONING_TABS.find((t) => t.key === activeSeasoningTab);
  const grid = document.createElement('div');
  grid.className = 'ingredient-grid';
  tab.items.forEach(([key, label]) => {
    grid.appendChild(renderIngredientCheckbox(key, label, ingredients));
  });
  panel.appendChild(grid);
}

// ----- 献立決定ロジック -----

function computeCandidates() {
  const ingredients = loadIngredients();
  const recentNames = getRecentDishNames();

  return DISHES
    .filter((dish) => state.selectedGenres.has(dish.genre))
    .filter((dish) => (state.timePriority ? dish.time === state.selectedTime : dish.time <= state.selectedTime))
    .filter((dish) => !recentNames.includes(dish.name))
    .map((dish) => {
      const missing = dish.need.filter((key) => !ingredients[key]);
      return { dish, missing, available: missing.length === 0 };
    })
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (a.dish.time !== b.dish.time) return a.dish.time - b.dish.time;
      return a.dish.name.localeCompare(b.dish.name, 'ja');
    });
}

const ingredientLabelMap = {};
INGREDIENT_CATEGORIES.forEach((c) => c.items.forEach(([key, label]) => (ingredientLabelMap[key] = label)));
SEASONING_TABS.forEach((c) => c.items.forEach(([key, label]) => (ingredientLabelMap[key] = label)));

function renderResultScreen() {
  const candidates = computeCandidates();
  const summary = document.getElementById('result-summary');
  const list = document.getElementById('result-list');

  const genreLabel = GENRES.filter((g) => state.selectedGenres.has(g)).join('・');
  const timeLabel = state.timePriority ? `${state.selectedTime}分ぴったり` : `${state.selectedTime}分以内`;
  summary.textContent = `${genreLabel} / ${timeLabel} — ${candidates.length}件`;

  list.innerHTML = '';

  if (candidates.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = '条件に合う献立が見つかりませんでした。ジャンルや時間を変えてみてください。';
    list.appendChild(empty);
    return;
  }

  candidates.forEach(({ dish, missing, available }) => {
    const card = document.createElement('section');
    card.className = 'card dish-card';

    const header = document.createElement('div');
    header.className = 'dish-header';

    const name = document.createElement('h3');
    name.className = 'dish-name';
    name.textContent = dish.name;

    const badge = document.createElement('span');
    badge.className = 'badge ' + (available ? 'badge-available' : 'badge-need');
    badge.textContent = available ? '作れる' : '調達必要';

    header.appendChild(name);
    header.appendChild(badge);
    card.appendChild(header);

    const meta = document.createElement('p');
    meta.className = 'dish-meta';
    meta.textContent = `${dish.genre} / ${dish.time}分`;
    card.appendChild(meta);

    if (!available) {
      const missingLine = document.createElement('p');
      missingLine.className = 'missing-line';
      const missingLabels = missing.map((key) => ingredientLabelMap[key] || key).join('、');
      missingLine.textContent = `不足材料：${missingLabels}`;
      card.appendChild(missingLine);
    }

    const cookedButton = document.createElement('button');
    cookedButton.type = 'button';
    cookedButton.className = 'cooked-button';
    cookedButton.textContent = '作ったよ';
    cookedButton.addEventListener('click', () => {
      addHistoryEntry(dish.name);
      showToast(`「${dish.name}」を記録しました！`);
      renderResultScreen();
    });
    card.appendChild(cookedButton);

    list.appendChild(card);
  });
}

// ----- トースト通知 -----

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2000);
}

// ----- イベント配線 -----

document.getElementById('decide-button').addEventListener('click', () => {
  renderResultScreen();
  showScreen('result');
});

document.getElementById('ingredients-button').addEventListener('click', () => {
  renderIngredientCategories();
  renderSeasoningTabs();
  renderSeasoningPanel();
  showScreen('ingredients');
});

document.getElementById('back-from-ingredients').addEventListener('click', () => {
  showScreen('top');
});

document.getElementById('back-from-result').addEventListener('click', () => {
  showScreen('top');
});

// ----- 初期化 -----

renderGenreOptions();
renderTimeOptions();
showScreen('top');
