const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 800,
    minHeight: 650,
    title: 'NutritionPlan',
    backgroundColor: '#f4f7f2',
    webPreferences: {
      // Use an absolute path so Electron can always locate the bridge file.
      preload: path.resolve(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep context isolation enabled, but disable the sandbox for this small
      // CommonJS preload so require('electron') can expose the IPC bridge reliably.
      sandbox: false
    }
  });

  const preloadPath = path.resolve(__dirname, 'preload.js');
  if (!fs.existsSync(preloadPath)) {
    console.error('NutritionPlan preload.js was not found:', preloadPath);
  }

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('NutritionPlan window loaded. Preload path:', preloadPath);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('NutritionPlan page failed to load:', errorCode, errorDescription);
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// Read a small JSON file so the application demonstrates local JSON processing.
ipcMain.handle('nutrition:get-guides', () => {
  try {
    const filePath = path.join(__dirname, 'nutrition-guides.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error('Could not read nutrition-guides.json:', error.message);
    return { tips: [], goals: {} };
  }
});

// Search nutrition information from two online sources, then use a small
// built-in reference list when both services cannot be reached.
// CalorTracker provides USDA FoodData Central nutrition values without an API key.
// Open Food Facts is kept as a secondary source for branded packaged products.
const searchCache = new Map();
const CACHE_DURATION_MS = 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

const offlineFoods = [
  { name: 'Apple, raw, with skin', terms: 'apple', kcal: 52, protein: 0.26, carbs: 13.81, fat: 0.17, sugar: 10.39, category: 'Fruits' },
  { name: 'Banana, raw', terms: 'banana', kcal: 89, protein: 1.09, carbs: 22.84, fat: 0.33, sugar: 12.23, category: 'Fruits' },
  { name: 'Chicken breast, cooked', terms: 'chicken breast chicken', kcal: 165, protein: 31.02, carbs: 0, fat: 3.57, sugar: 0, category: 'Meat' },
  { name: 'Chicken breast, raw', terms: 'chicken breast chicken', kcal: 120, protein: 22.5, carbs: 0, fat: 2.62, sugar: 0, category: 'Meat' },
  { name: 'Oats, dry', terms: 'oats oatmeal oat', kcal: 389, protein: 16.9, carbs: 66.27, fat: 6.9, sugar: 0.99, category: 'Grains' },
  { name: 'Rice, white, cooked', terms: 'rice white rice', kcal: 130, protein: 2.69, carbs: 28.17, fat: 0.28, sugar: 0.05, category: 'Grains' },
  { name: 'Rice, brown, cooked', terms: 'rice brown rice', kcal: 123, protein: 2.74, carbs: 25.58, fat: 0.97, sugar: 0.24, category: 'Grains' },
  { name: 'Egg, whole, cooked', terms: 'egg eggs', kcal: 155, protein: 12.58, carbs: 1.12, fat: 10.61, sugar: 1.12, category: 'Dairy and eggs' },
  { name: 'Broccoli, raw', terms: 'broccoli', kcal: 34, protein: 2.82, carbs: 6.64, fat: 0.37, sugar: 1.7, category: 'Vegetables' },
  { name: 'Milk, whole', terms: 'milk whole milk', kcal: 61, protein: 3.15, carbs: 4.8, fat: 3.25, sugar: 5.05, category: 'Dairy and eggs' },
  { name: 'Yogurt, plain, Greek, nonfat', terms: 'yogurt greek yoghurt', kcal: 59, protein: 10.19, carbs: 3.6, fat: 0.39, sugar: 3.24, category: 'Dairy and eggs' },
  { name: 'Almonds', terms: 'almond almonds', kcal: 579, protein: 21.15, carbs: 21.55, fat: 49.93, sugar: 4.35, category: 'Nuts and seeds' },
  { name: 'Salmon, cooked', terms: 'salmon fish', kcal: 206, protein: 22.1, carbs: 0, fat: 12.35, sugar: 0, category: 'Fish' },
  { name: 'Potato, boiled', terms: 'potato potatoes', kcal: 87, protein: 1.87, carbs: 20.13, fat: 0.1, sugar: 0.91, category: 'Vegetables' },
  { name: 'Sweet potato, baked', terms: 'sweet potato', kcal: 90, protein: 2.01, carbs: 20.71, fat: 0.15, sugar: 6.48, category: 'Vegetables' },
  { name: 'Bread, whole wheat', terms: 'bread whole wheat', kcal: 247, protein: 12.45, carbs: 41.29, fat: 3.5, sugar: 6.39, category: 'Grains' },
  { name: 'Tuna, canned in water, drained', terms: 'tuna', kcal: 116, protein: 25.51, carbs: 0, fat: 0.82, sugar: 0, category: 'Fish' },
  { name: 'Lentils, cooked', terms: 'lentil lentils', kcal: 116, protein: 9.02, carbs: 20.13, fat: 0.38, sugar: 1.8, category: 'Legumes' },
  { name: 'Orange, raw', terms: 'orange oranges', kcal: 47, protein: 0.94, carbs: 11.75, fat: 0.12, sugar: 9.35, category: 'Fruits' },
  { name: 'Avocado, raw', terms: 'avocado', kcal: 160, protein: 2, carbs: 8.53, fat: 14.66, sugar: 0.66, category: 'Fruits' },
  { name: 'Spinach, raw', terms: 'spinach', kcal: 23, protein: 2.86, carbs: 3.63, fat: 0.39, sugar: 0.42, category: 'Vegetables' },
  { name: 'Carrot, raw', terms: 'carrot carrots', kcal: 41, protein: 0.93, carbs: 9.58, fat: 0.24, sugar: 4.74, category: 'Vegetables' },
  { name: 'Tofu, firm', terms: 'tofu', kcal: 144, protein: 17.27, carbs: 2.78, fat: 8.72, sugar: 0.62, category: 'Plant proteins' }
];

function makeProductFromCalorTracker(item) {
  const nutrients = item?.per100g || {};
  return {
    code: `calortracker-${item.slug || item.fdcId || item.name}`,
    product_name: item.name,
    brands: 'USDA reference data',
    quantity: item.category || 'Per 100 g',
    categories_tags: item.category ? [item.category] : [],
    nutriments: {
      'energy-kcal_100g': nutrients.energyKcal,
      proteins_100g: nutrients.proteinG,
      carbohydrates_100g: nutrients.carbsG,
      fat_100g: nutrients.fatG,
      sugars_100g: nutrients.sugarsG
    }
  };
}

function makeProductFromOfflineFood(food) {
  return {
    code: `offline-${food.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    product_name: food.name,
    brands: 'Offline reference estimate',
    quantity: food.category,
    categories_tags: [food.category],
    nutriments: {
      'energy-kcal_100g': food.kcal,
      proteins_100g: food.protein,
      carbohydrates_100g: food.carbs,
      fat_100g: food.fat,
      sugars_100g: food.sugar
    }
  };
}

async function fetchJson(url, userAgent) {
  const response = await net.fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': userAgent
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store'
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  if (!contentType.toLowerCase().includes('json') || body.trim().startsWith('<')) {
    throw new Error('The nutrition service returned a web page instead of JSON data.');
  }

  try {
    return JSON.parse(body);
  } catch (_error) {
    throw new Error('The nutrition service returned unreadable data.');
  }
}

async function searchCalorTracker(term) {
  const endpoint = new URL('https://calortracker.com/api/v1/foods');
  endpoint.search = new URLSearchParams({ q: term.slice(0, 64), limit: '12' }).toString();
  const data = await fetchJson(endpoint.toString(), 'NutritionPlan/2.0 (student nutrition project)');
  if (!Array.isArray(data.data)) throw new Error('Unexpected CalorTracker response.');
  return data.data.map(makeProductFromCalorTracker).filter((item) => item.product_name);
}

async function searchOpenFoodFacts(term) {
  const endpoint = new URL('https://world.openfoodfacts.org/cgi/search.pl');
  endpoint.search = new URLSearchParams({
    search_terms: term,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '12',
    fields: 'code,product_name,brands,quantity,nutriments,image_front_small_url,categories_tags'
  }).toString();
  const data = await fetchJson(endpoint.toString(), 'NutritionPlan/2.0 (student nutrition project)');
  if (!Array.isArray(data.products)) throw new Error('Unexpected Open Food Facts response.');
  return data.products;
}

function findOfflineFoods(term) {
  const words = term.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
  const matched = offlineFoods.filter((food) => {
    const haystack = `${food.name} ${food.terms}`.toLowerCase();
    return words.some((word) => haystack.includes(word));
  });
  return matched.slice(0, 12).map(makeProductFromOfflineFood);
}

function getCachedResult(term) {
  const entry = searchCache.get(term);
  if (!entry || Date.now() - entry.savedAt > CACHE_DURATION_MS) {
    searchCache.delete(term);
    return null;
  }
  return entry.result;
}

function saveCachedResult(term, result) {
  searchCache.set(term, { savedAt: Date.now(), result });
  if (searchCache.size > 30) searchCache.delete(searchCache.keys().next().value);
}

ipcMain.handle('nutrition:search', async (_event, searchTerm) => {
  if (typeof searchTerm !== 'string' || searchTerm.trim().length < 2) {
    throw new Error('Enter at least two characters to search for a food.');
  }

  const safeTerm = searchTerm.trim().slice(0, 80);
  const cacheKey = safeTerm.toLowerCase();
  const cached = getCachedResult(cacheKey);
  if (cached) return cached;

  // First source: USDA reference nutrition data through CalorTracker.
  try {
    const products = await searchCalorTracker(safeTerm);
    if (products.length) {
      const result = {
        products,
        count: products.length,
        source: 'USDA FoodData Central via CalorTracker',
        mode: 'online',
      };
      saveCachedResult(cacheKey, result);
      return result;
    }
  } catch (error) {
    console.warn('CalorTracker search was not available:', error.message);
  }

  // Second source: branded and packaged foods from Open Food Facts.
  try {
    const products = await searchOpenFoodFacts(safeTerm);
    if (products.length) {
      const result = {
        products,
        count: Number(products.length),
        source: 'Open Food Facts',
        mode: 'online',
        notice: 'Nutrition data: Open Food Facts community product database. Product values may be incomplete or differ by brand.'
      };
      saveCachedResult(cacheKey, result);
      return result;
    }
  } catch (error) {
    console.warn('Open Food Facts search was not available:', error.message);
  }

  // Final fallback: common foods remain searchable even when the internet APIs fail.
  const offlineProducts = findOfflineFoods(safeTerm);
  const result = {
    products: offlineProducts,
    count: offlineProducts.length,
    source: 'Offline reference data',
    mode: 'offline',
    notice: offlineProducts.length
      ? 'Online food databases are unavailable right now. Showing approximate offline reference values for common foods, not a specific brand or product.'
      : 'Online food databases are unavailable right now, and this food is not in the small offline reference list. Try apple, banana, oats, rice, egg, broccoli, or chicken breast.'
  };
  return result;
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
