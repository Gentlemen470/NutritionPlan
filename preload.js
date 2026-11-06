const { contextBridge, ipcRenderer } = require('electron');

// Keep Node.js APIs out of the page. Expose only the functions the renderer needs.
const nutritionAPI = Object.freeze({
  searchFoods: (searchTerm) => ipcRenderer.invoke('nutrition:search', searchTerm),
  getGuides: () => ipcRenderer.invoke('nutrition:get-guides')
});

try {
  contextBridge.exposeInMainWorld('nutritionAPI', nutritionAPI);
  console.info('NutritionPlan preload bridge is ready.');
} catch (error) {
  console.error('NutritionPlan could not expose its preload bridge:', error);
}
