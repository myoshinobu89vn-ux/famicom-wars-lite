'use strict';

const STORAGE_KEY_INGREDIENTS = 'kondate_ingredients_v1';
const STORAGE_KEY_HISTORY = 'kondate_history_v1';
const STORAGE_KEY_MEMOS = 'kondate_memos_v1';
const STORAGE_KEY_EXCLUDED_SITES = 'kondate_excluded_sites_v1';
const GENRES = ['和', '洋', '中', '他'];
const TIME_OPTIONS = [10, 20, 30, 45];
const SERVINGS_OPTIONS = [1, 2, 3, 4, 5, 6];
const APP_VERSION = 'v2.1';
const APP_VERSION_NOTE = 'キーワード検索を追加（料理名・特徴の説明文・主要食材から絞り込み可能）';

// レシピ検索先サイト（除外されていないものだけ検索対象にする）
const RECIPE_SITES = [
  { key: 'cookpad', label: 'クックパッド', urlTemplate: 'https://cookpad.com/search/{query}' },
  { key: 'kurashiru', label: 'クラシル', urlTemplate: 'https://www.kurashiru.com/search?query={query}' },
  { key: 'delish', label: 'DELISH KITCHEN', urlTemplate: 'https://delishkitchen.tv/search?q={query}' },
  { key: 'youtube', label: 'YouTube', urlTemplate: 'https://www.youtube.com/results?search_query={query}' },
  { key: 'google', label: 'Google', urlTemplate: 'https://www.google.com/search?q={query}' },
  { key: 'bing', label: 'Bing', urlTemplate: 'https://www.bing.com/search?q={query}' },
];

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

function removeMostRecentHistoryEntry(name) {
  const history = loadHistory();
  const index = history.findIndex((entry) => entry.name === name);
  if (index !== -1) history.splice(index, 1);
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
}

function loadMemos() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_MEMOS)) || {};
  } catch (e) {
    return {};
  }
}

function saveMemo(name, text) {
  const memos = loadMemos();
  if (text) {
    memos[name] = text;
  } else {
    delete memos[name];
  }
  localStorage.setItem(STORAGE_KEY_MEMOS, JSON.stringify(memos));
}

function loadExcludedSites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_EXCLUDED_SITES)) || []);
  } catch (e) {
    return new Set();
  }
}

function saveExcludedSites(excludedSet) {
  localStorage.setItem(STORAGE_KEY_EXCLUDED_SITES, JSON.stringify([...excludedSet]));
}

// ----- アプリ状態 -----

const state = {
  selectedGenres: new Set(GENRES),
  selectedTime: 30,
  timePriority: false,
  servings: 2,
  onlyAvailable: false,
  keyword: '',
};

// レシピ検索から除外中のサイト（キーの集合）
let excludedSites = loadExcludedSites();

// 直近に計算した候補一覧（ランダム並べ替え用に保持）
let lastCandidates = [];
// 開いているレシピ（作り方）の料理名一覧
const openRecipeNames = new Set();
// 「作ったよ」で記録済みとしてマークされている料理名一覧（このセッション内の見た目の状態）
const cookedNames = new Set();

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

document.getElementById('only-available-toggle').addEventListener('change', (e) => {
  state.onlyAvailable = e.target.checked;
  if (!screens.result.classList.contains('hidden')) {
    renderResultScreen();
  }
});

document.getElementById('keyword-input').addEventListener('input', (e) => {
  state.keyword = e.target.value.trim();
  if (!screens.result.classList.contains('hidden')) {
    renderResultScreen();
  }
});

function renderServingsOptions() {
  const container = document.getElementById('servings-options');
  container.innerHTML = '';
  SERVINGS_OPTIONS.forEach((n) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.servings === n ? ' chip-active' : '');
    chip.textContent = `${n}人前`;
    chip.addEventListener('click', () => {
      state.servings = n;
      renderServingsOptions();
      if (!screens.result.classList.contains('hidden')) {
        renderCandidateList(lastCandidates);
      }
    });
    container.appendChild(chip);
  });
}

function renderSiteOptions() {
  const container = document.getElementById('site-options');
  container.innerHTML = '';
  RECIPE_SITES.forEach((site) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (excludedSites.has(site.key) ? '' : ' chip-active');
    chip.textContent = site.label;
    chip.addEventListener('click', () => {
      if (excludedSites.has(site.key)) {
        excludedSites.delete(site.key);
      } else {
        excludedSites.add(site.key);
      }
      saveExcludedSites(excludedSites);
      renderSiteOptions();
    });
    container.appendChild(chip);
  });
}

// ----- レシピ外部検索 -----

function openRecipeSearch(dish) {
  const sites = RECIPE_SITES.filter((site) => !excludedSites.has(site.key));
  if (sites.length === 0) {
    showToast('検索サイトを1つ以上選択してください');
    return;
  }
  const keywords = [dish.name, ...getMainIngredientLabels(dish, 2), 'レシピ'];
  const encodedQuery = encodeURIComponent(keywords.join(' '));
  sites.forEach((site) => {
    window.open(site.urlTemplate.replace('{query}', encodedQuery), '_blank');
  });
}

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

function dishMatchesKeyword(dish, keyword) {
  if (!keyword) return true;
  if (dish.name.includes(keyword)) return true;
  if (dish.description.includes(keyword)) return true;
  return dish.need.some((key) => (ingredientLabelMap[key] || '').includes(keyword));
}

function computeCandidates() {
  const ingredients = loadIngredients();

  return DISHES
    .filter((dish) => state.selectedGenres.has(dish.genre))
    .filter((dish) => (state.timePriority ? dish.time === state.selectedTime : dish.time <= state.selectedTime))
    .filter((dish) => dishMatchesKeyword(dish, state.keyword))
    .map((dish) => {
      const missing = dish.need.filter((key) => !ingredients[key]);
      return { dish, missing, available: missing.length === 0 };
    })
    .filter((item) => !state.onlyAvailable || item.available)
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (a.dish.time !== b.dish.time) return a.dish.time - b.dish.time;
      return a.dish.name.localeCompare(b.dish.name, 'ja');
    });
}

const ingredientLabelMap = {};
INGREDIENT_CATEGORIES.forEach((c) => c.items.forEach(([key, label]) => (ingredientLabelMap[key] = label)));
SEASONING_TABS.forEach((c) => c.items.forEach(([key, label]) => (ingredientLabelMap[key] = label)));

// 検索クエリ用の主要食材抽出時に除外するキー（調味料・とろみ付け・薬味など）
const MAIN_INGREDIENT_EXCLUDE = new Set([
  ...SEASONING_TABS.flatMap((c) => c.items.map(([key]) => key)),
  'katakuriko', 'flour', 'panko', 'oil', 'garlic', 'ginger',
]);

function getMainIngredientLabels(dish, limit) {
  return dish.need
    .filter((key) => !MAIN_INGREDIENT_EXCLUDE.has(key))
    .slice(0, limit)
    .map((key) => ingredientLabelMap[key] || key);
}

// ----- 分量表示（人数に応じてスケーリング） -----

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

function formatNumber(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatIngredientAmount(key) {
  const info = INGREDIENT_SERVING_INFO[key];
  const label = ingredientLabelMap[key] || key;
  if (!info) return label;
  if (info.fixed) return `${label} ${info.fixed}`;

  const raw = info.amount * state.servings;
  let step = 0.5;
  if (info.unit === 'g' || info.unit === 'ml') step = 10;
  const rounded = Math.max(step, roundToStep(raw, step));
  return `${label} ${formatNumber(rounded)}${info.unit}`;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function renderResultScreen() {
  lastCandidates = computeCandidates();
  const summary = document.getElementById('result-summary');
  const genreLabel = GENRES.filter((g) => state.selectedGenres.has(g)).join('・');
  const timeLabel = state.timePriority ? `${state.selectedTime}分ぴったり` : `${state.selectedTime}分以内`;
  const keywordLabel = state.keyword ? ` / 「${state.keyword}」で検索` : '';
  summary.textContent = `${genreLabel} / ${timeLabel} / ${state.servings}人前${keywordLabel} — ${lastCandidates.length}件`;

  renderCandidateList(lastCandidates);
}

function renderCandidateList(candidates) {
  const list = document.getElementById('result-list');
  list.innerHTML = '';

  document.getElementById('shuffle-button').disabled = candidates.length < 2;

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

    const description = document.createElement('p');
    description.className = 'dish-description';
    description.textContent = dish.description;
    card.appendChild(description);

    if (!available) {
      const missingLine = document.createElement('p');
      missingLine.className = 'missing-line';
      const missingLabels = missing.map((key) => ingredientLabelMap[key] || key).join('、');
      missingLine.textContent = `不足材料：${missingLabels}`;
      card.appendChild(missingLine);
    }

    const buttonRow = document.createElement('div');
    buttonRow.className = 'dish-button-row';

    const recipeButton = document.createElement('button');
    recipeButton.type = 'button';
    recipeButton.className = 'recipe-toggle-button';

    const recipePanel = document.createElement('div');
    recipePanel.className = 'recipe-panel';

    function renderRecipePanelContent() {
      recipePanel.innerHTML = '';

      const searchButton = document.createElement('button');
      searchButton.type = 'button';
      searchButton.className = 'search-sites-button';
      searchButton.textContent = '🔍 レシピサイトで検索';
      searchButton.addEventListener('click', () => openRecipeSearch(dish));
      recipePanel.appendChild(searchButton);

      const ingredientTitle = document.createElement('p');
      ingredientTitle.className = 'recipe-subtitle';
      ingredientTitle.textContent = `材料（${state.servings}人前）`;
      recipePanel.appendChild(ingredientTitle);

      const ingredientList = document.createElement('ul');
      ingredientList.className = 'recipe-ingredient-list';
      dish.need.forEach((key) => {
        const li = document.createElement('li');
        li.textContent = formatIngredientAmount(key);
        ingredientList.appendChild(li);
      });
      recipePanel.appendChild(ingredientList);

      const stepsTitle = document.createElement('p');
      stepsTitle.className = 'recipe-subtitle';
      stepsTitle.textContent = '作り方';
      recipePanel.appendChild(stepsTitle);

      const stepsList = document.createElement('ol');
      stepsList.className = 'recipe-steps-list';
      dish.steps.forEach((step) => {
        const li = document.createElement('li');
        li.textContent = step;
        stepsList.appendChild(li);
      });
      recipePanel.appendChild(stepsList);

      const tipsTitle = document.createElement('p');
      tipsTitle.className = 'recipe-subtitle';
      tipsTitle.textContent = '💡 プロのコツ';
      recipePanel.appendChild(tipsTitle);

      const tipsList = document.createElement('ul');
      tipsList.className = 'recipe-tips-list';
      dish.tips.forEach((tip) => {
        const li = document.createElement('li');
        li.textContent = tip;
        tipsList.appendChild(li);
      });
      recipePanel.appendChild(tipsList);

      const memoTitle = document.createElement('p');
      memoTitle.className = 'recipe-subtitle';
      memoTitle.textContent = 'メモ';
      recipePanel.appendChild(memoTitle);

      const memoInput = document.createElement('textarea');
      memoInput.className = 'recipe-memo-input';
      memoInput.placeholder = '味の調整や感想など、次に作るときのメモを残せます';
      memoInput.value = loadMemos()[dish.name] || '';
      let memoSaveTimer = null;
      memoInput.addEventListener('input', () => {
        clearTimeout(memoSaveTimer);
        memoSaveTimer = setTimeout(() => saveMemo(dish.name, memoInput.value), 400);
      });
      memoInput.addEventListener('blur', () => {
        clearTimeout(memoSaveTimer);
        saveMemo(dish.name, memoInput.value);
      });
      recipePanel.appendChild(memoInput);
    }

    function setRecipeOpen(open) {
      recipePanel.classList.toggle('hidden', !open);
      recipeButton.textContent = open ? '簡易レシピを閉じる' : '簡易レシピを見る';
      if (open) {
        openRecipeNames.add(dish.name);
        renderRecipePanelContent();
      } else {
        openRecipeNames.delete(dish.name);
      }
    }

    recipeButton.addEventListener('click', () => {
      setRecipeOpen(recipePanel.classList.contains('hidden'));
    });

    setRecipeOpen(openRecipeNames.has(dish.name));

    const cookedButton = document.createElement('button');
    cookedButton.type = 'button';
    cookedButton.className = 'cooked-button';

    function setCookedState(cooked) {
      cookedButton.classList.toggle('cooked-active', cooked);
      cookedButton.textContent = cooked ? '✓ 作ったよ' : '作ったよ';
    }

    setCookedState(cookedNames.has(dish.name));

    cookedButton.addEventListener('click', () => {
      if (cookedNames.has(dish.name)) {
        cookedNames.delete(dish.name);
        removeMostRecentHistoryEntry(dish.name);
        setCookedState(false);
        showToast(`「${dish.name}」の記録を取り消しました`);
      } else {
        cookedNames.add(dish.name);
        addHistoryEntry(dish.name);
        setCookedState(true);
        showToast(`「${dish.name}」を記録しました！`);
      }
    });

    buttonRow.appendChild(recipeButton);
    buttonRow.appendChild(cookedButton);
    card.appendChild(buttonRow);
    card.appendChild(recipePanel);

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

document.getElementById('back-from-result-top').addEventListener('click', () => {
  showScreen('top');
});

document.getElementById('shuffle-button').addEventListener('click', () => {
  shuffleArray(lastCandidates);
  renderCandidateList(lastCandidates);
});

// ----- 初期化 -----

const appVersionEl = document.getElementById('app-version');
appVersionEl.textContent = APP_VERSION;
appVersionEl.title = APP_VERSION_NOTE;

renderGenreOptions();
renderTimeOptions();
renderServingsOptions();
renderSiteOptions();
showScreen('top');
