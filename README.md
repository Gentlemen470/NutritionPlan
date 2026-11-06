# NutritionPlan

NutritionPlan is a simple desktop app for the CSC2923 OOP assignment. It lets you search for food nutrition information, get basic suggestions, calculate a portion, and keep a food diary while the app is open.

## What it does

- **Food Search:** Search nutrition reference data from USDA FoodData Central through CalorTracker. If that service is unavailable, the app tries Open Food Facts for packaged-food results.
- **Offline search fallback:** If both online services are unavailable, common foods such as apple, banana, oats, rice, egg, broccoli, and chicken breast can still be searched using approximate reference values built into the app. A small renderer-side fallback also keeps common-food search working if Electron's preload bridge fails to load. The app labels these as offline estimates.
- **Food suggestions:** Pick Balanced, Higher protein, Lower calorie, Lower carb, or Vegetarian-friendly. The app uses its own JavaScript `if...else` rules to show matches.
- **Portion calculator:** Work out estimated calories, protein, carbs, and fat for a portion. Formula: value per 100 g × portion size ÷ 100.
- **Food Diary:** Add, view, edit, and delete food entries. You can also filter entries by date.
- **JSON tips:** The app reads nutrition tips from `nutrition-guides.json`.
- **Search cache:** Successful online searches are kept in memory for three minutes to avoid sending repeated requests too quickly.

**Local Storage:** The application saves food diary records and the latest food suggestions in the browser Local Storage used by the Electron window. Diary records are loaded when the app starts and saved after each add, edit, or delete operation. The latest search term, selected nutrition focus, matching food details, and suggestion reasons are also saved. The app restores those suggestions when it is reopened. Data remains on the same computer and this project does not use a remote database.

## What you need

- Node.js and npm
- Internet connection for online nutrition searches. Offline reference foods remain available if the online services cannot be reached.

## Run it

1. Extract the ZIP file.
2. Open the `NutritionPlan-Electron` folder in VS Code.
3. Open the terminal in that folder.
4. Run:

   ```bash
   npm install
   npm start
   ```

## Quick tests

1. Search for `apple`, `oats`, or `chicken breast`.
2. Change the food focus and check that the matching results change.
3. Choose **Calculate portion**, change the grams, and check the numbers update.
4. Add a portion to the diary.
5. Add another entry using the form, then try Edit and Delete.
6. Try the date filter.
7. Close the app and open it again. The diary will be empty because entries are not saved after closing.
8. To check the backup behaviour, disconnect from the internet and search for apple, oats, rice, or chicken breast. The app should show offline reference values instead of an API error. Search for an uncommon food while offline to see the offline-list message.

## API

The app tries these sources in order:

1. **CalorTracker API:** `https://calortracker.com/api/v1/foods?q=<food>&limit=12`
   Provides USDA FoodData Central reference values. The app displays the required attribution, “Data: USDA FoodData Central via CalorTracker.”
2. **Open Food Facts:** `https://world.openfoodfacts.org/cgi/search.pl`
   Used as a backup source, especially for packaged and branded products.
3. **Offline reference list:** Used only if both online sources fail. These values are approximate examples for common foods and are not branded-product nutrition labels.

Online responses are cached in memory for three minutes. The app does not save the search cache or diary entries to disk.

Official/API information:
- https://calortracker.com/developers
- https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/
- https://fdc.nal.usda.gov/

## Main files

- `main.js` - opens the app window and requests food data from the API.
- `preload.js` - safely connects the page to the Electron main process. The window uses context isolation with Node integration disabled; the preload sandbox is disabled to avoid compatibility problems with the CommonJS bridge.
- `index.html` - contains the two pages and forms.
- `styles.css` - controls the simple interface.
- `renderer.js` - handles searches, suggestions, calculations, form validation, and the food diary CRUD operations and saved/restored food suggestions with Local Storage persistence.
- `nutrition-guides.json` - contains short nutrition tips.
- `package.json` - contains the Electron setup and start command.

## Before you submit

- Run the app and test each feature yourself.
- Add your name, student ID, class, and lecturer to the report.
- Add your own screenshots of both pages, search results, the calculator, and the diary's add/edit/delete actions.
- Upload the whole project to GitHub and put the real repository link in your report.
- Make sure you understand the code before explaining it in your report.

## Upload to GitHub

Create an empty repository on GitHub, then run these commands in the project folder. Replace the example URL with your repository URL.

```bash
git init
git add .
git commit -m "NutritionPlan project"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

NutritionPlan is for learning and general food planning, not medical advice. Check the actual food label when accuracy matters.


## Troubleshooting the `searchFoods` error

If the app previously showed `Cannot read properties of undefined (reading 'searchFoods')`, the page could not see the Electron preload bridge. This version uses an absolute preload path, keeps context isolation enabled, and disables the preload sandbox for compatibility. It also falls back to the built-in food list instead of crashing if the bridge is still unavailable.

After extracting this version, close every NutritionPlan window and start it from this exact project folder:

```powershell
npm.cmd install
npm.cmd start
```

If the bridge does not load, common foods still use the renderer-side offline list. Online search still requires the main-process bridge and a reachable API.
