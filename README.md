# Map My Trip

A standalone static web app for importing TripIt `.ics` calendar exports and visualizing trip items on a Leaflet/OpenStreetMap timeline map.

## Use locally

Serve the folder with any static file server, then open `index.html`.

```powershell
python -m http.server 8000
```

The app runs entirely in the browser. Imported trips are stored locally in IndexedDB. It does not call paid APIs or automatically geocode locations.

## GitHub Pages

This repository is configured to publish from the `main` branch at the repository root.
