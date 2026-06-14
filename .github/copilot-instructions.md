# Copilot instructions for Map My Trip

Map My Trip is a standalone static browser app for importing TripIt `.ics` calendar exports and visualizing trip items over time on a Leaflet/OpenStreetMap map.

## App shape

- There is no build step and no package manager dependency. Keep the app runnable as plain static files.
- Main files:
  - `index.html` defines the UI shell.
  - `styles.css` contains all layout and visual styling.
  - `app.js` contains ICS parsing, IndexedDB storage, rendering, map behavior, routes, filters, and search.
- Serve locally with any static file server, for example:

  ```powershell
  dnx dotnet-serve --port 8000
  ```

## Privacy and data handling

- Do not commit TripIt exports, calendar feed URLs, generated trip data, CSV review files, or other personal travel data.
- The app should continue to process imports entirely in the browser.
- Imported trips are stored locally in IndexedDB for that browser/user.
- Do not add automatic geocoding or paid API dependencies.
- Do not use public CORS proxy services for private TripIt feed URLs. Treat private calendar feed URLs as bearer secrets.

## Mapping and routing behavior

- Use Leaflet with OpenStreetMap tiles.
- Show markers only for items with usable coordinates.
- Manual latitude/longitude enrichment should remain supported by importing updated data rather than calling geocoding APIs automatically.
- Imported/explicit TripIt direction items should take precedence over generated route legs.
- The OSRM road-directions toggle may generate route geometry/details, but avoid duplicate routes when imported direction items already cover the same leg.
- Keep straight-line fallback behavior when routed geometry is unavailable.

## UI expectations

- The map should fit the viewport and not scroll with the itinerary.
- The left pane should have independently scrollable control and itinerary areas.
- Keep import/trip-management controls compact so itinerary items remain easy to browse.
- Search should stay as a map overlay and selecting a result should focus the same item as clicking it in the itinerary.
- Filters should cover these categories: Accommodation, Transport, Flights, Attractions, Food/Pubs, Events, Other.

## Code style

- Prefer small, focused changes in the existing files over introducing frameworks or tooling.
- Keep JavaScript browser-compatible without transpilation.
- Preserve the no-build static hosting model for GitHub Pages from `main` at the repository root.
- Validate JavaScript edits with:

  ```powershell
  node --check .\app.js
  ```
