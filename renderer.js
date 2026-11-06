const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let currentProducts = [];
let visibleProducts = [];
let selectedFood = null;
let intakes = []; // Diary records are loaded from and saved to browser Local Storage.
const INTAKE_STORAGE_KEY = 'nutritionPlan.intakes.v1';
const SUGGESTION_STORAGE_KEY = 'nutritionPlan.suggestions.v1';
let recordDateFilter = '';
let currentTipIndex = 0;
let toastTimeout = null;
const DAILY_CALORIE_EXAMPLE = 2000;

function showToast(message, type = 'success') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast visible ${type === 'success' ? '' : type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 3000);
}

function setApiStatus(text, state = 'ready') {
  $('#statusText').textContent = text;
  $('#statusDot').className = `status-dot${state === 'online' ? ' online' : state === 'error' ? ' error' : ''}`;
}

function switchPage(pageName) {
  $$('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${pageName}`));
  $$('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.page === pageName));
  if (pageName === 'tracker') renderIntakes();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function friendlyDate(dateString) {
  if (!dateString) return 'Date not set';
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function firstAvailable(...values) {
  for (const value of values) {
    const number = safeNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function formatValue(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'N/A';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

// This class keeps a food product's API information in one object.
class FoodProduct {
  constructor(product, index) {
    const nutrients = product.nutriments || {};
    let calories = firstAvailable(nutrients['energy-kcal_100g'], nutrients['energy-kcal_value'], nutrients['energy-kcal']);
    if (calories === null) {
      const energyKj = firstAvailable(nutrients['energy-kj_100g'], nutrients['energy_100g']);
      if (energyKj !== null) calories = energyKj / 4.184;
    }

    this.id = String(product.code || `${product.product_name || 'food'}-${index}`);
    this.name = String(product.product_name || '').trim();
    this.brand = String(product.brands || 'Brand not listed').trim();
    this.quantity = String(product.quantity || 'Quantity not listed').trim();
    this.categories = Array.isArray(product.categories_tags) ? product.categories_tags : [];
    this.calories = calories;
    this.protein = firstAvailable(nutrients.proteins_100g);
    this.carbs = firstAvailable(nutrients.carbohydrates_100g);
    this.fat = firstAvailable(nutrients.fat_100g);
    this.sugar = firstAvailable(nutrients.sugars_100g);
  }

  calculatePortion(grams) {
    return {
      calories: nutrientForPortion(this.calories, grams),
      protein: nutrientForPortion(this.protein, grams),
      carbs: nutrientForPortion(this.carbs, grams),
      fat: nutrientForPortion(this.fat, grams)
    };
  }
}

// This class represents one food diary entry.
class IntakeRecord {
  constructor(data) {
    this.id = data.id || createId();
    this.foodName = data.foodName;
    this.portionGrams = Number(data.portionGrams);
    this.calories = Number(data.calories);
    this.protein = Number(data.protein);
    this.carbs = Number(data.carbs);
    this.fat = Number(data.fat);
    this.logDate = data.logDate;
    this.note = data.note || '';
    this.createdAt = data.createdAt || new Date().toISOString();
  }
}

// Restore diary records when the application starts.
function loadIntakesFromLocalStorage() {
  try {
    const savedRecords = localStorage.getItem(INTAKE_STORAGE_KEY);
    if (!savedRecords) {
      intakes = [];
      return;
    }

    const parsedRecords = JSON.parse(savedRecords);
    if (!Array.isArray(parsedRecords)) {
      throw new Error('Saved diary data is not in the expected format.');
    }

    // Re-create each record as an IntakeRecord object after reading the JSON.
    intakes = parsedRecords.map((record) => new IntakeRecord(record));
  } catch (error) {
    console.error('Could not load diary records from Local Storage:', error);
    intakes = [];
    showToast('Saved diary data could not be loaded. New entries can still be added.', 'warning');
  }
}

// Save the complete diary array after every Create, Update, or Delete operation.
function saveIntakesToLocalStorage() {
  try {
    localStorage.setItem(INTAKE_STORAGE_KEY, JSON.stringify(intakes));
    return true;
  } catch (error) {
    console.error('Could not save diary records to Local Storage:', error);
    showToast('Could not save your diary. Check available storage and try again.', 'warning');
    return false;
  }
}

// Save the latest search and its matching recommendations as structured JSON.
function saveSuggestionsToLocalStorage() {
  const suggestionData = {
    searchTerm: $('#searchInput').value.trim(),
    diet: $('#dietSelect').value,
    savedAt: new Date().toISOString(),
    products: currentProducts.map((food) => ({
      id: food.id,
      name: food.name,
      brand: food.brand,
      quantity: food.quantity,
      categories: food.categories,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      sugar: food.sugar
    })),
    suggestions: visibleProducts.map((food) => ({ id: food.id, reason: food.reason }))
  };

  try {
    localStorage.setItem(SUGGESTION_STORAGE_KEY, JSON.stringify(suggestionData));
    return true;
  } catch (error) {
    console.error('Could not save food suggestions to Local Storage:', error);
    showToast('Food suggestions could not be saved.', 'warning');
    return false;
  }
}

// Retrieve the last saved recommendation set when the application is reopened.
function loadSuggestionsFromLocalStorage() {
  try {
    const savedSuggestions = localStorage.getItem(SUGGESTION_STORAGE_KEY);
    if (!savedSuggestions) return null;

    const parsed = JSON.parse(savedSuggestions);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.products) || !Array.isArray(parsed.suggestions)) {
      throw new Error('Saved suggestion data is not in the expected format.');
    }
    return parsed;
  } catch (error) {
    console.error('Could not load food suggestions from Local Storage:', error);
    showToast('Previously saved suggestions could not be loaded.', 'warning');
    return null;
  }
}

// Rebuild FoodProduct objects from the saved JSON so the portion calculator
// continues to work with restored suggestions after the app is reopened.
function restoreSavedSuggestions() {
  const saved = loadSuggestionsFromLocalStorage();
  if (!saved) return;

  $('#searchInput').value = saved.searchTerm || '';
  if (saved.diet) $('#dietSelect').value = saved.diet;

  currentProducts = saved.products.map((food, index) => {
    const product = new FoodProduct({
      code: food.id,
      product_name: food.name,
      brands: food.brand,
      quantity: food.quantity,
      categories_tags: food.categories,
      nutriments: {
        'energy-kcal_100g': food.calories,
        proteins_100g: food.protein,
        carbohydrates_100g: food.carbs,
        fat_100g: food.fat,
        sugars_100g: food.sugar
      }
    }, index);
    product.reason = food.reason || '';
    return product;
  });
  const savedReasons = new Map(saved.suggestions.map((item) => [String(item.id), item.reason]));
  visibleProducts = currentProducts.filter((food) => savedReasons.has(String(food.id)));
  visibleProducts.forEach((food) => { food.reason = savedReasons.get(String(food.id)) || ''; });

  if (visibleProducts.length) {
    $('#resultsState').classList.add('hidden');
    $('#resultCount').textContent = String(visibleProducts.length);
    $('#resultsSubtitle').textContent = `Restored ${visibleProducts.length} saved food suggestion${visibleProducts.length === 1 ? '' : 's'}.`;
    $('#sourceNote').textContent = 'Showing your most recently saved food suggestions.';
    renderFoodCards(visibleProducts);
  } else if (saved.searchTerm) {
    showEmptyResults('No saved matches', 'Your last search did not have any foods matching that focus.');
    $('#resultCount').textContent = '0';
    $('#resultsSubtitle').textContent = 'Your last suggestion search had no matching foods.';
  }
}

function foodHasAnimalTerms(food) {
  const text = `${food.name} ${food.categories.join(' ')}`.toLowerCase();
  const animalTerms = ['chicken', 'beef', 'pork', 'lamb', 'mutton', 'fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'crab', 'turkey', 'duck', 'meat', 'seafood', 'ham', 'bacon', 'gelatin'];
  return animalTerms.some((term) => text.includes(term));
}

// These are simple student-written rules for matching food to the chosen focus.
function getSuggestionReason(food, diet) {
  if (diet === 'highProtein') {
    if (food.protein !== null && food.protein >= 10 && (food.calories === null || food.calories <= 500)) {
      return `Higher protein: ${formatValue(food.protein)} g per 100 g.`;
    }
    return null;
  } else if (diet === 'lowCalorie') {
    if (food.calories !== null && food.calories <= 150) {
      return `Lower calorie: ${formatValue(food.calories, 0)} kcal per 100 g.`;
    }
    return null;
  } else if (diet === 'lowCarb') {
    if (food.carbs !== null && food.carbs <= 15) {
      return `Lower carb: ${formatValue(food.carbs)} g per 100 g.`;
    }
    return null;
  } else if (diet === 'vegetarian') {
    if (!foodHasAnimalTerms(food) && (food.protein !== null || food.calories !== null)) {
      return 'May be vegetarian-friendly. Check the ingredient list to be sure.';
    }
    return null;
  }

  const hasUsefulData = food.calories !== null && [food.protein, food.carbs, food.fat].some((value) => value !== null);
  const sugarOkay = food.sugar === null || food.sugar <= 15;
  if (hasUsefulData && food.calories <= 400 && sugarOkay) {
    return 'Possible balanced choice. Compare serving size and other nutrients too.';
  }
  return null;
}

function dietLabel(diet) {
  const labels = {
    balanced: 'Balanced',
    highProtein: 'Higher protein',
    lowCalorie: 'Lower calorie',
    lowCarb: 'Lower carb',
    vegetarian: 'Vegetarian-friendly'
  };
  return labels[diet] || 'Balanced';
}

function showEmptyResults(title, message, showQuickSearches = false) {
  $('#resultsGrid').innerHTML = '';
  $('#resultsState').classList.remove('hidden');
  const searches = showQuickSearches
    ? '<div class="quick-searches"><button type="button" class="quick-search" data-search="oats">Oats</button><button type="button" class="quick-search" data-search="apple">Apple</button><button type="button" class="quick-search" data-search="chicken breast">Chicken breast</button></div>'
    : '';
  $('#resultsState').innerHTML = `<div class="empty-icon">🍎</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(message)}</p>${searches}`;
}

function applyDietSuggestions() {
  const diet = $('#dietSelect').value;
  visibleProducts = currentProducts
    .map((food) => ({ food, reason: getSuggestionReason(food, diet) }))
    .filter((item) => item.food.name && item.reason)
    .map((item) => {
      // Keep the original FoodProduct instance so calculatePortion() remains available.
      item.food.reason = item.reason;
      return item.food;
    });
  saveSuggestionsToLocalStorage();

  if (!visibleProducts.length) {
    showEmptyResults('No matches for this focus', 'Try a different food or choose another focus.');
    $('#resultCount').textContent = '0';
    $('#resultsSubtitle').textContent = `No results matched ${dietLabel(diet).toLowerCase()}.`;
    return;
  }

  $('#resultsState').classList.add('hidden');
  $('#resultCount').textContent = String(visibleProducts.length);
  $('#resultsSubtitle').textContent = `${visibleProducts.length} food option${visibleProducts.length === 1 ? '' : 's'} matched ${dietLabel(diet).toLowerCase()}.`;
  renderFoodCards(visibleProducts);
}

function renderFoodCards(foods) {
  $('#resultsGrid').innerHTML = foods.map((food, index) => `
    <article class="food-card">
      <h3>${escapeHTML(food.name)}</h3>
      <p class="food-brand">${escapeHTML(food.brand)}</p>
      <span class="focus-tag">${escapeHTML(food.reason)}</span>
      <div class="food-card-nutrients">
        <div class="food-nutrient"><strong>${formatValue(food.calories, 0)}</strong><span>Calories</span></div>
        <div class="food-nutrient"><strong>${formatValue(food.protein)}</strong><span>Protein (g)</span></div>
        <div class="food-nutrient"><strong>${formatValue(food.carbs)}</strong><span>Carbs (g)</span></div>
      </div>
      <div class="food-card-footer"><span class="food-quantity">${escapeHTML(food.quantity)}</span><button class="food-use-button" type="button" data-select-index="${index}">Calculate portion</button></div>
    </article>
  `).join('');
}

// This small renderer-side list is a last-resort safety net. It allows the
// common food search to keep working even if Electron cannot load preload.js.
const rendererOfflineFoods = [
  { name: 'Apple, raw, with skin', terms: 'apple', kcal: 52, protein: 0.26, carbs: 13.81, fat: 0.17, sugar: 10.39 },
  { name: 'Banana, raw', terms: 'banana', kcal: 89, protein: 1.09, carbs: 22.84, fat: 0.33, sugar: 12.23 },
  { name: 'Chicken breast, cooked', terms: 'chicken chicken breast', kcal: 165, protein: 31.02, carbs: 0, fat: 3.57, sugar: 0 },
  { name: 'Oats, dry', terms: 'oats oatmeal oat', kcal: 389, protein: 16.9, carbs: 66.27, fat: 6.9, sugar: 0.99 },
  { name: 'Rice, white, cooked', terms: 'rice white rice', kcal: 130, protein: 2.69, carbs: 28.17, fat: 0.28, sugar: 0.05 },
  { name: 'Egg, whole, cooked', terms: 'egg eggs', kcal: 155, protein: 12.58, carbs: 1.12, fat: 10.61, sugar: 1.12 },
  { name: 'Broccoli, raw', terms: 'broccoli', kcal: 34, protein: 2.82, carbs: 6.64, fat: 0.37, sugar: 1.7 },
  { name: 'Milk, whole', terms: 'milk whole milk', kcal: 61, protein: 3.15, carbs: 4.8, fat: 3.25, sugar: 5.05 },
  { name: 'Greek yogurt, plain', terms: 'yogurt yoghurt greek', kcal: 59, protein: 10.19, carbs: 3.6, fat: 0.39, sugar: 3.24 },
  { name: 'Almonds', terms: 'almond almonds', kcal: 579, protein: 21.15, carbs: 21.55, fat: 49.93, sugar: 4.35 },
  { name: 'Salmon, cooked', terms: 'salmon fish', kcal: 206, protein: 22.1, carbs: 0, fat: 12.35, sugar: 0 },
  { name: 'Potato, boiled', terms: 'potato potatoes', kcal: 87, protein: 1.87, carbs: 20.13, fat: 0.1, sugar: 0.91 },
  { name: 'Sweet potato, baked', terms: 'sweet potato', kcal: 90, protein: 2.01, carbs: 20.71, fat: 0.15, sugar: 6.48 },
  { name: 'Whole wheat bread', terms: 'bread wheat', kcal: 247, protein: 12.45, carbs: 41.29, fat: 3.5, sugar: 6.39 },
  { name: 'Tuna, canned in water', terms: 'tuna', kcal: 116, protein: 25.51, carbs: 0, fat: 0.82, sugar: 0 },
  { name: 'Lentils, cooked', terms: 'lentil lentils', kcal: 116, protein: 9.02, carbs: 20.13, fat: 0.38, sugar: 1.8 },
  { name: 'Orange, raw', terms: 'orange oranges', kcal: 47, protein: 0.94, carbs: 11.75, fat: 0.12, sugar: 9.35 },
  { name: 'Avocado, raw', terms: 'avocado', kcal: 160, protein: 2, carbs: 8.53, fat: 14.66, sugar: 0.66 },
  { name: 'Spinach, raw', terms: 'spinach', kcal: 23, protein: 2.86, carbs: 3.63, fat: 0.39, sugar: 0.42 },
  { name: 'Carrot, raw', terms: 'carrot carrots', kcal: 41, protein: 0.93, carbs: 9.58, fat: 0.24, sugar: 4.74 },
  { name: 'Tofu, firm', terms: 'tofu', kcal: 144, protein: 17.27, carbs: 2.78, fat: 8.72, sugar: 0.62 }
];

function searchRendererOfflineFoods(term, reason = '') {
  const words = term.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
  const products = rendererOfflineFoods.filter((food) => {
    const haystack = `${food.name} ${food.terms}`.toLowerCase();
    return words.some((word) => haystack.includes(word));
  }).slice(0, 12).map((food, index) => ({
    code: `renderer-offline-${index}-${food.terms.replace(/\s+/g, '-')}`,
    product_name: food.name,
    brands: 'Offline reference estimate',
    quantity: 'Per 100 g',
    categories_tags: ['General foods'],
    nutriments: {
      'energy-kcal_100g': food.kcal,
      proteins_100g: food.protein,
      carbohydrates_100g: food.carbs,
      fat_100g: food.fat,
      sugars_100g: food.sugar
    }
  }));

  return {
    products,
    count: products.length,
    source: 'Built-in offline reference data',
    mode: 'offline',
    notice: products.length
      ? `Showing approximate offline reference values per 100 g. ${reason}`.trim()
      : 'The app could not connect to its nutrition service, and this food is not in its offline list. Try apple, banana, oats, rice, egg, broccoli, milk, or chicken breast.'
  };
}

async function runSearch(searchTerm) {
  const term = String(searchTerm || '').trim();
  if (term.length < 2) {
    showToast('Type at least 2 letters.', 'warning');
    $('#searchInput').focus();
    return;
  }

  $('#searchInput').value = term;
  $('#resultsGrid').innerHTML = '';
  showEmptyResults('Searching...', 'Checking the main nutrition database and backup source.');
  $('#sourceNote').textContent = 'Checking online nutrition sources...';
  $('#resultCount').textContent = '…';
  $('#resultsSubtitle').textContent = `Searching for ${term}.`;
  setApiStatus('Searching', 'ready');

  try {
    let response;
    const bridge = window.nutritionAPI;

    if (bridge && typeof bridge.searchFoods === 'function') {
      try {
        response = await bridge.searchFoods(term);
      } catch (bridgeError) {
        console.error('NutritionPlan IPC search failed:', bridgeError);
        response = searchRendererOfflineFoods(term, 'The desktop API connection was unavailable.');
      }
    } else {
      console.error('NutritionPlan preload bridge is missing. Check main.js and preload.js.');
      response = searchRendererOfflineFoods(term, 'The desktop API bridge did not load.');
    }

$('#sourceNote').textContent =
    response.mode === 'offline' ? (response.notice || '') : '';
    currentProducts = (response.products || []).map((product, index) => new FoodProduct(product, index)).filter((food) => food.name);
    if (!currentProducts.length) {
      if (response.mode === 'offline') {
        showEmptyResults('No offline match', response.notice || 'Try a common food such as apple, oats, rice, egg, or chicken breast.', true);
        setApiStatus('Offline data', 'ready');
      } else {
        showEmptyResults('No food found', 'Try a common name such as apple, oats, or yogurt.', true);
        setApiStatus('No results', 'online');
      }
      $('#resultCount').textContent = '0';
      $('#resultsSubtitle').textContent = `No products found for ${term}.`;
      return;
    }
    if (response.mode === 'offline') {
      setApiStatus('Offline data', 'ready');
      showToast('Using offline reference values. Online databases could not be reached.', 'warning');
    } else {
      setApiStatus('Connected', 'online');
    }
    applyDietSuggestions();
    if (!visibleProducts.length) showToast('No foods matched that focus. Try another one.', 'warning');
  } catch (error) {
    currentProducts = [];
    visibleProducts = [];
    const message = error?.message || 'The food database could not be reached. Try again later.';
    showEmptyResults('Food search failed', message);
    $('#resultCount').textContent = '0';
    $('#resultsSubtitle').textContent = 'Could not load food data.';
    setApiStatus('API unavailable', 'error');
    showToast('Search failed. Read the message shown below the search box.', 'error');
  }
}

function openCalculator(food) {
  selectedFood = food;
  $('#calculatorPanel').classList.remove('hidden');
  $('#selectedFoodName').textContent = food.name;
  $('#selectedFoodMeta').textContent = `${food.brand} · nutrition values per 100 g`;
  $('#selectedFoodImage').textContent = '🥗';
  $('#portionInput').value = '150';
  updateCalculation();
  $('#calculatorPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function nutrientForPortion(per100g, grams) {
  return per100g === null || per100g === undefined ? null : per100g * grams / 100;
}

function updateCalculation() {
  if (!selectedFood) return null;
  const grams = Number($('#portionInput').value);
  const validGrams = Number.isFinite(grams) && grams >= 1 && grams <= 5000;
  const metrics = validGrams ? selectedFood.calculatePortion(grams) : { calories: null, protein: null, carbs: null, fat: null };
  $('#portionCalories').textContent = formatValue(metrics.calories, 0);
  $('#portionProtein').textContent = formatValue(metrics.protein);
  $('#portionCarbs').textContent = formatValue(metrics.carbs);
  $('#portionFat').textContent = formatValue(metrics.fat);
  const complete = validGrams && Object.values(metrics).every((value) => value !== null);
  $('#addSelectedButton').disabled = !complete;
  $('#calculationNote').textContent = complete
    ? `Estimated totals for ${formatValue(grams, 0)} g.`
    : 'Use 1 to 5,000 g. All four nutrition values are needed to add this portion.';
  return { grams, ...metrics, complete };
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 9)}`;
}

function addCalculatedIntake() {
  if (!selectedFood) return;
  const calculation = updateCalculation();
  if (!calculation || !calculation.complete) {
    showToast('This food is missing some nutrition values. Try another result.', 'warning');
    return;
  }
  intakes.unshift(new IntakeRecord({
    foodName: selectedFood.name,
    portionGrams: calculation.grams,
    calories: calculation.calories,
    protein: calculation.protein,
    carbs: calculation.carbs,
    fat: calculation.fat,
    logDate: todayISO(),
    note: `Nutrition reference · ${selectedFood.brand}`
  }));
  const saved = saveIntakesToLocalStorage();
  renderIntakes();
  resetIntakeForm();
  if (saved) showToast('Added to your diary and saved.');
  switchPage('tracker');
}

function resetIntakeForm() {
  $('#intakeForm').reset();
  $('#recordId').value = '';
  $('#logDate').value = todayISO();
  $('#formTitle').textContent = 'Add food';
  $('#saveRecordButton').textContent = 'Add food';
  $('#cancelEditButton').classList.add('hidden');
}

function readFormNumber(selector, label, min, max) {
  const text = $(selector).value.trim();
  if (text === '') throw new Error(`${label} is required.`);
  const number = Number(text);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return number;
}

function saveIntakeRecord(event) {
  event.preventDefault();
  const foodName = $('#foodName').value.trim();
  const logDate = $('#logDate').value;
  if (!foodName) {
    showToast('Enter a food name.', 'warning');
    $('#foodName').focus();
    return;
  }
  if (!logDate) {
    showToast('Choose a date.', 'warning');
    $('#logDate').focus();
    return;
  }

  try {
    const record = new IntakeRecord({
      id: $('#recordId').value || createId(),
      foodName,
      portionGrams: readFormNumber('#portionGrams', 'Portion', 1, 5000),
      calories: readFormNumber('#inputCalories', 'Calories', 0, 20000),
      protein: readFormNumber('#inputProtein', 'Protein', 0, 1000),
      carbs: readFormNumber('#inputCarbs', 'Carbs', 0, 1000),
      fat: readFormNumber('#inputFat', 'Fat', 0, 1000),
      logDate,
      note: $('#recordNote').value.trim()
    });

    const existingIndex = intakes.findIndex((item) => item.id === record.id);
    const editing = existingIndex >= 0;
    if (editing) {
      record.createdAt = intakes[existingIndex].createdAt;
      intakes[existingIndex] = record;
    } else {
      intakes.unshift(record);
    }
    const saved = saveIntakesToLocalStorage();
    resetIntakeForm();
    renderIntakes();
    if (saved) showToast(editing ? 'Food updated and saved.' : 'Food added and saved.');
  } catch (error) {
    showToast(error.message || 'Check the values and try again.', 'warning');
  }
}

function editIntakeRecord(id) {
  const record = intakes.find((item) => item.id === id);
  if (!record) return;
  $('#recordId').value = record.id;
  $('#foodName').value = record.foodName;
  $('#portionGrams').value = record.portionGrams;
  $('#logDate').value = record.logDate;
  $('#inputCalories').value = record.calories;
  $('#inputProtein').value = record.protein;
  $('#inputCarbs').value = record.carbs;
  $('#inputFat').value = record.fat;
  $('#recordNote').value = record.note;
  $('#formTitle').textContent = 'Edit food';
  $('#saveRecordButton').textContent = 'Update food';
  $('#cancelEditButton').classList.remove('hidden');
  $('#foodName').focus();
  $('.intake-form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deleteIntakeRecord(id) {
  const record = intakes.find((item) => item.id === id);
  if (!record || !window.confirm(`Delete ${record.foodName}?`)) return;
  intakes = intakes.filter((item) => item.id !== id);
  const saved = saveIntakesToLocalStorage();
  if ($('#recordId').value === id) resetIntakeForm();
  renderIntakes();
  if (saved) showToast('Food deleted and saved.');
}

function renderIntakes() {
  const today = todayISO();
  const todays = intakes.filter((record) => record.logDate === today);
  const sum = (records, key) => records.reduce((total, record) => total + (Number(record[key]) || 0), 0);
  const calories = sum(todays, 'calories');
  $('#todayCalories').textContent = formatValue(calories, 0);
  $('#todayProtein').textContent = `${formatValue(sum(todays, 'protein'))} g`;
  $('#todayCarbs').textContent = `${formatValue(sum(todays, 'carbs'))} g`;
  $('#todayFoodCount').textContent = String(todays.length);
  $('#todayLabel').textContent = `Today · ${friendlyDate(today)}`;
  $('#calorieProgress').style.width = `${Math.min(100, calories / DAILY_CALORIE_EXAMPLE * 100)}%`;
  $('#calorieGoalText').textContent = `Example target: ${formatValue(DAILY_CALORIE_EXAMPLE, 0)} kcal`;
  $('#navCount').textContent = String(intakes.length);

  const filtered = [...intakes]
    .filter((record) => !recordDateFilter || record.logDate === recordDateFilter)
    .sort((a, b) => String(b.logDate).localeCompare(String(a.logDate)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  $('#recordCount').textContent = String(filtered.length);
  $('#recordsSubtitle').textContent = recordDateFilter
    ? `Showing ${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'} for ${friendlyDate(recordDateFilter)}.`
    : `${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'} saved in your diary.`;

  $('#intakeList').innerHTML = filtered.map((record) => `
    <article class="intake-record">
      <div class="record-main">
        <h3>${escapeHTML(record.foodName)}</h3>
        <div class="record-meta">${friendlyDate(record.logDate)} · ${formatValue(record.portionGrams, 0)} g</div>
        ${record.note ? `<p class="record-note">${escapeHTML(record.note)}</p>` : ''}
        <div class="record-nutrients"><span><strong>${formatValue(record.calories, 0)}</strong> kcal</span><span><strong>${formatValue(record.protein)}</strong> g protein</span><span><strong>${formatValue(record.carbs)}</strong> g carbs</span><span><strong>${formatValue(record.fat)}</strong> g fat</span></div>
      </div>
      <div class="record-actions"><button type="button" data-record-action="edit" data-record-id="${escapeHTML(record.id)}">Edit</button><button type="button" class="delete-button" data-record-action="delete" data-record-id="${escapeHTML(record.id)}">Delete</button></div>
    </article>
  `).join('');
  $('#recordsEmpty').classList.toggle('hidden', filtered.length > 0);
  $('#intakeList').classList.toggle('hidden', filtered.length === 0);
}

function updateGuide(tips) {
  if (!Array.isArray(tips) || !tips.length) return;
  const tip = tips[currentTipIndex % tips.length];
  $('#tipTitle').textContent = tip.title || 'Quick tip';
  $('#tipText').textContent = tip.text || '';
  currentTipIndex = (currentTipIndex + 1) % tips.length;
}

function connectEvents() {
  $$('.nav-button').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.page)));
  $('#searchForm').addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch($('#searchInput').value);
  });
  $('#dietSelect').addEventListener('change', () => {
    if (currentProducts.length) applyDietSuggestions();
  });
  document.addEventListener('click', (event) => {
    const quickSearch = event.target.closest('[data-search]');
    if (quickSearch) {
      $('#searchInput').value = quickSearch.dataset.search;
      switchPage('explorer');
      runSearch(quickSearch.dataset.search);
      return;
    }
    const selectButton = event.target.closest('[data-select-index]');
    if (selectButton) {
      const food = visibleProducts[Number(selectButton.dataset.selectIndex)];
      if (food) openCalculator(food);
    }
  });
  $('#calculateButton').addEventListener('click', updateCalculation);
  $('#portionInput').addEventListener('input', updateCalculation);
  $('#addSelectedButton').addEventListener('click', addCalculatedIntake);
  $('#closeCalculator').addEventListener('click', () => $('#calculatorPanel').classList.add('hidden'));
  $('#intakeForm').addEventListener('submit', saveIntakeRecord);
  $('#cancelEditButton').addEventListener('click', resetIntakeForm);
  $('#intakeList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-record-action]');
    if (!button) return;
    if (button.dataset.recordAction === 'edit') editIntakeRecord(button.dataset.recordId);
    if (button.dataset.recordAction === 'delete') deleteIntakeRecord(button.dataset.recordId);
  });
  $('#recordsDateFilter').addEventListener('change', (event) => {
    recordDateFilter = event.target.value;
    renderIntakes();
  });
  $('#clearSearchFilter').addEventListener('click', () => {
    recordDateFilter = '';
    $('#recordsDateFilter').value = '';
    renderIntakes();
  });
  $('#exploreFromEmpty').addEventListener('click', () => switchPage('explorer'));
}

async function initialize() {
  loadIntakesFromLocalStorage();
  $('#logDate').value = todayISO();
  restoreSavedSuggestions();
  $('#todayLabel').textContent = `Today · ${friendlyDate(todayISO())}`;
  renderIntakes();
  connectEvents();
  try {
    const guideData = window.nutritionAPI && typeof window.nutritionAPI.getGuides === 'function'
      ? await window.nutritionAPI.getGuides()
      : null;
    if (guideData && Array.isArray(guideData.tips)) updateGuide(guideData.tips);
  } catch (error) {
    console.warn('Could not load the nutrition tips:', error.message);
  }
}

document.addEventListener('DOMContentLoaded', initialize);
