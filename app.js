const DB_NAME = "trip-timeline-map";
const DB_VERSION = 1;
const STORE = "trips";

const TYPE_ORDER = ["Accommodation", "Transport", "Flights", "Attractions", "Food/Pubs", "Events", "Other"];
const COLORS = {
  "Accommodation": "#8250df",
  "Transport": "#0969da",
  "Flights": "#1f883d",
  "Attractions": "#cf222e",
  "Food/Pubs": "#bf8700",
  "Events": "#d1248f",
  "Other": "#57606a"
};
const ICONS = {
  "Accommodation": "🏨",
  "Transport": "🚗",
  "Flights": "✈️",
  "Attractions": "🏛️",
  "Food/Pubs": "🍽️",
  "Events": "🎟️",
  "Other": "•"
};

const AIRPORT_OFFSETS = { FAO: 60, LCY: 60, LHR: 60, SEA: -420 };
const CITY_HINTS = {
  Seattle: ["Seattle", "(SEA)", " SEA"],
  Faro: ["Faro", "(FAO)", " FAO"],
  London: ["London", "(LHR)", "(LCY)", " LHR", " LCY", "Westminster", "Piccadilly", "Carnaby"],
  Towcester: ["Towcester", "Silverstone"],
  Woodstock: ["Woodstock"],
  Burford: ["Burford"],
  Salisbury: ["Salisbury", "Stonehenge"],
  Swallowcliffe: ["Swallowcliffe"],
  Bath: ["Bath", "Somerset"],
  Westergate: ["Westergate", "Eartham"],
  Chichester: ["Chichester", "Goodwood"],
  Portsmouth: ["Portsmouth"],
  Fishbourne: ["Fishbourne"],
  "New York": ["New York", "NY"]
};

let db;
let trips = [];
let activeTrip = null;
let items = [];
let activeTypes = new Set(TYPE_ORDER);
let activeRouteId = "";
let activeSearchIndex = -1;
let routeRenderToken = 0;

const markerLayer = L.layerGroup();
const routeLayer = L.layerGroup();
const markersById = new Map();
const itemButtonsById = new Map();
const routeCache = new Map();
const routeDetailsById = new Map();
const routeLayersById = new Map();
const visibleRouteLegsById = new Map();

const map = L.map("map", { preferCanvas: true });
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
markerLayer.addTo(map);
routeLayer.addTo(map);
map.setView([51.5, -1.2], 6);

const els = {
  tripSelect: document.getElementById("tripSelect"),
  renameTrip: document.getElementById("renameTrip"),
  refreshTrip: document.getElementById("refreshTrip"),
  deleteTrip: document.getElementById("deleteTrip"),
  importTitle: document.getElementById("importTitle"),
  icsFile: document.getElementById("icsFile"),
  feedUrl: document.getElementById("feedUrl"),
  importStartDate: document.getElementById("importStartDate"),
  importEndDate: document.getElementById("importEndDate"),
  importMode: document.getElementById("importMode"),
  synthesizeDirections: document.getElementById("synthesizeDirections"),
  importTrip: document.getElementById("importTrip"),
  importStatus: document.getElementById("importStatus"),
  viewMode: document.getElementById("viewMode"),
  dayControl: document.getElementById("dayControl"),
  daySelect: document.getElementById("daySelect"),
  rangeControl: document.getElementById("rangeControl"),
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  visibleSummary: document.getElementById("visibleSummary"),
  routedRoutes: document.getElementById("routedRoutes"),
  routeStatus: document.getElementById("routeStatus"),
  filters: document.getElementById("filters"),
  filterSummary: document.getElementById("filterSummary"),
  itinerary: document.getElementById("itinerary"),
  tripSearch: document.getElementById("tripSearch"),
  clearSearch: document.getElementById("clearSearch"),
  searchResults: document.getElementById("searchResults")
};

init().catch(error => setStatus(error.message, true));

async function init() {
  db = await openDb();
  wireControls();
  renderFilters();
  await loadTrips();
  render();
}

function wireControls() {
  els.tripSelect.addEventListener("change", () => selectTrip(els.tripSelect.value));
  els.renameTrip.addEventListener("click", renameActiveTrip);
  els.refreshTrip.addEventListener("click", refreshActiveTrip);
  els.deleteTrip.addEventListener("click", deleteActiveTrip);
  els.importTrip.addEventListener("click", importTrip);
  els.viewMode.addEventListener("change", render);
  els.daySelect.addEventListener("change", render);
  els.startDate.addEventListener("change", render);
  els.endDate.addEventListener("change", render);
  els.routedRoutes.addEventListener("change", render);
  els.tripSearch.addEventListener("input", renderSearchResults);
  els.tripSearch.addEventListener("focus", renderSearchResults);
  els.tripSearch.addEventListener("keydown", handleSearchKeydown);
  els.clearSearch.addEventListener("click", () => {
    els.tripSearch.value = "";
    closeSearchResults();
    els.tripSearch.focus();
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".map-search")) closeSearchResults();
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txStore(mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function getAllTrips() {
  return new Promise((resolve, reject) => {
    const request = txStore().getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    request.onerror = () => reject(request.error);
  });
}

function saveTrip(trip) {
  return new Promise((resolve, reject) => {
    const request = txStore("readwrite").put(trip);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function removeTrip(id) {
  return new Promise((resolve, reject) => {
    const request = txStore("readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function loadTrips(selectedId = null) {
  trips = await getAllTrips();
  activeTrip = trips.find(trip => trip.id === selectedId) || trips[0] || null;
  items = activeTrip?.items || [];
  renderTripSelect();
}

function renderTripSelect() {
  els.tripSelect.replaceChildren();
  if (!trips.length) {
    els.tripSelect.append(new Option("No stored trips", ""));
  } else {
    for (const trip of trips) {
      els.tripSelect.append(new Option(`${trip.title} (${trip.items.length})`, trip.id));
    }
    els.tripSelect.value = activeTrip.id;
  }
  els.renameTrip.disabled = !activeTrip;
  els.deleteTrip.disabled = !activeTrip;
  els.refreshTrip.disabled = !activeTrip || activeTrip.sourceType !== "url";
}

function renderFilters() {
  els.filters.replaceChildren();
  for (const type of TYPE_ORDER) {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(type)}" checked> <span class="pill" style="background:${COLORS[type]}">${type}</span>`;
    label.querySelector("input").addEventListener("change", event => {
      if (event.target.checked) activeTypes.add(type);
      else activeTypes.delete(type);
      updateFilterSummary();
      render();
    });
    els.filters.append(label);
  }
  updateFilterSummary();
}

function updateFilterSummary() {
  if (els.filterSummary) {
    els.filterSummary.textContent = `Filters (${activeTypes.size}/${TYPE_ORDER.length} active)`;
  }
}

async function selectTrip(id) {
  activeTrip = trips.find(trip => trip.id === id) || null;
  items = activeTrip?.items || [];
  renderTripSelect();
  resetDateControls();
  render();
}

async function renameActiveTrip() {
  if (!activeTrip) return;
  const title = prompt("New trip title", activeTrip.title);
  if (!title?.trim()) return;
  activeTrip = { ...activeTrip, title: title.trim(), updatedAt: new Date().toISOString() };
  await saveTrip(activeTrip);
  await loadTrips(activeTrip.id);
  render();
}

async function deleteActiveTrip() {
  if (!activeTrip) return;
  if (!confirm(`Delete "${activeTrip.title}" from this browser?`)) return;
  await removeTrip(activeTrip.id);
  await loadTrips();
  resetDateControls();
  render();
}

async function refreshActiveTrip() {
  if (!activeTrip || activeTrip.sourceType !== "url") return;
  els.feedUrl.value = activeTrip.sourceValue;
  els.importTitle.value = activeTrip.title;
  els.importMode.value = "overwrite";
  await importTrip();
}

async function importTrip() {
  try {
    setStatus("Importing...");
    const source = await readImportSource();
    const events = parseIcs(source.text);
    const builtItems = buildItems(events, {
      startDate: els.importStartDate.value || null,
      endDate: els.importEndDate.value || null,
      synthesizeDirections: els.synthesizeDirections.checked
    });
    if (!builtItems.length) throw new Error("No trip items were found for the selected source/date range.");

    const mode = els.importMode.value;
    const now = new Date().toISOString();
    const title = els.importTitle.value.trim() || source.title || extractCalendarTitle(source.text) || "Imported trip";
    let trip;

    if (mode === "new" || !activeTrip) {
      trip = {
        id: crypto.randomUUID(),
        title,
        sourceType: source.type,
        sourceValue: source.value,
        items: builtItems,
        createdAt: now,
        updatedAt: now
      };
    } else if (mode === "overwrite") {
      trip = {
        ...activeTrip,
        title,
        sourceType: source.type,
        sourceValue: source.value,
        items: builtItems,
        updatedAt: now
      };
    } else {
      trip = {
        ...activeTrip,
        title,
        sourceType: source.type,
        sourceValue: source.value,
        items: mergeItems(activeTrip.items, builtItems),
        updatedAt: now
      };
    }

    await saveTrip(trip);
    await loadTrips(trip.id);
    resetDateControls();
    render();
    setStatus(`Imported ${builtItems.length} items into "${trip.title}".`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function readImportSource() {
  const file = els.icsFile.files[0];
  const url = els.feedUrl.value.trim();
  if (file) {
    return {
      type: "file",
      value: file.name,
      title: file.name.replace(/\.ics$/i, ""),
      text: await file.text()
    };
  }
  if (!url) throw new Error("Choose an ICS file or enter a calendar feed URL.");
  let response;
  try {
    response = await fetch(url, { headers: { Accept: "text/calendar,*/*" } });
  } catch {
    throw new Error("The browser could not read that calendar feed. Many private calendar feeds, including some TripIt feeds, block browser fetches with CORS. Download the .ics file and import it here, or use a CORS-enabled feed URL.");
  }
  if (!response.ok) throw new Error(`Calendar feed request failed: ${response.status}`);
  return { type: "url", value: url, title: "", text: await response.text() };
}

function mergeItems(existing, incoming) {
  const byId = new Map(existing.map(item => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => (a.startDateTime || "").localeCompare(b.startDateTime || ""));
}

function setStatus(message, isError = false) {
  els.importStatus.textContent = message || "";
  els.importStatus.style.color = isError ? "#cf222e" : "";
}

function unfoldIcsLines(text) {
  const lines = [];
  for (const rawLine of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (/^[ \t]/.test(rawLine) && lines.length) lines[lines.length - 1] += rawLine.slice(1);
    else lines.push(rawLine);
  }
  return lines;
}

function unescapeIcsText(value) {
  return value
    .replaceAll("\\n", "\n")
    .replaceAll("\\N", "\n")
    .replaceAll("\\,", ",")
    .replaceAll("\\;", ";")
    .replaceAll("\\\\", "\\")
    .trim();
}

function parseProperty(line) {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(";");
  return {
    name: parts[0].toUpperCase(),
    params: new Set(parts.slice(1).map(part => part.toUpperCase())),
    value: unescapeIcsText(value)
  };
}

function parseIcs(text) {
  const events = [];
  let current = null;
  for (const line of unfoldIcsLines(text)) {
    if (line === "BEGIN:VEVENT") {
      current = {};
    } else if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const property = parseProperty(line);
      if (property) current[property.name] = property;
    }
  }
  return events;
}

function prop(event, name) {
  return event[name]?.value || "";
}

function extractCalendarTitle(text) {
  const line = unfoldIcsLines(text).find(value => value.startsWith("X-WR-CALNAME:"));
  return line ? unescapeIcsText(line.slice("X-WR-CALNAME:".length)) : "";
}

function bracketedType(description) {
  return description.match(/\[([^\]]+)\]/)?.[1]?.trim() || "";
}

function inferEventType(summary, description) {
  const explicit = bracketedType(description);
  if (explicit) return explicit;
  const text = `${summary} ${description}`.toLowerCase();
  if (/drive to|travel to|directions|route/.test(text)) return "Directions";
  if (/check-in|check-out|lodging/.test(text)) return "Lodging";
  if (/flight|\b[A-Z]{2}\d{1,4}\b/.test(summary)) return "Flight";
  if (/restaurant|pub/.test(text)) return "Restaurant";
  if (/ferry/.test(text)) return "Ferry";
  if (/car rental/.test(text)) return "Car Rental";
  if (/parking/.test(text)) return "Parking";
  if (/activity/.test(text)) return "Activity";
  return "Other";
}

function isDirectionEvent(eventType, title, notes) {
  const text = `${eventType} ${title} ${notes}`.toLowerCase();
  if (/directions?|route/.test(eventType.toLowerCase())) return true;
  if (/\[(?:driving |walking |transit )?directions?\]/i.test(notes)) return true;
  if (/^(?:drive|travel|walk|transit)\s+to\b/i.test(title)) return true;
  return /\b(?:directions?|route)\s+(?:from|between|to)\b/.test(text);
}

function inferLayer(eventType, summary, location, description) {
  const text = `${eventType} ${summary} ${location} ${description}`.toLowerCase();
  if (/directions?|route|drive to|travel to/.test(text)) return "Transport";
  if (text.includes("flight") || /\b(airport|terminal|gate|lhr|lcy|sea|fao)\b/.test(text)) return "Flights / Airports";
  if (/hotel|lodging|check-in|check-out|airbnb|accommodation/.test(text)) return "Accommodation";
  if (/restaurant|pub|dining|food|tea salon/.test(text)) return "Food / Pubs";
  if (/train|ferry|car rental|transfer|parking|rental car/.test(text)) return "Transport";
  if (/activity|attraction|tour|event|grand prix|festival|museum|market|stonehenge/.test(text)) return "Attractions / Events";
  return "Other";
}

function appType(eventType, layer, title, isDirection) {
  if (isDirection) return "Transport";
  const text = `${eventType} ${title}`.toLowerCase();
  if (layer === "Flights / Airports") return "Flights";
  if (layer === "Accommodation") return "Accommodation";
  if (layer === "Food / Pubs") return "Food/Pubs";
  if (layer === "Transport") return "Transport";
  if (/grand prix|festival|race|event/.test(text)) return "Events";
  if (layer === "Attractions / Events") return "Attractions";
  return "Other";
}

function splitLocation(location) {
  if (location.includes(";")) {
    const [place, ...rest] = location.split(";");
    return [place.trim(), rest.join(";").trim()];
  }
  return ["", location.trim()];
}

function cityFromText(text) {
  for (const [city, hints] of Object.entries(CITY_HINTS)) {
    if (hints.some(hint => text.includes(hint))) return city;
  }
  return "";
}

function inferCity(address, summary, location) {
  return cityFromText(`${address} ${location}`) || cityFromText(summary);
}

function inferCountry(address, summary) {
  const text = `${address} ${summary}`;
  if (/United Kingdom| UK|, UK|, GB|London|LHR|LCY/.test(text)) return "United Kingdom";
  if (/Seattle|SEA/.test(text)) return "United States";
  if (/Faro|FAO/.test(text)) return "Portugal";
  if (/New York|NY/.test(text)) return "United States";
  return "";
}

function parseGeo(value) {
  const parts = value.split(";");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

function routeAirports(summary, description) {
  const match = `${summary}\n${description}`.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/);
  return match ? [match[1], match[2]] : [null, null];
}

function timezoneOffset(summary, location, description, end = false) {
  const [startAirport, endAirport] = routeAirports(summary, description);
  const airport = end ? endAirport : startAirport;
  if (airport && AIRPORT_OFFSETS[airport] != null) return AIRPORT_OFFSETS[airport];
  const text = `${summary} ${location} ${description}`;
  for (const [code, offset] of Object.entries(AIRPORT_OFFSETS)) {
    if (text.includes(`(${code})`) || text.includes(` ${code}`)) return offset;
  }
  return 60;
}

function offsetSuffix(minutes) {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function localDateTime(propValue, params, offsetMinutes, end = false) {
  if (!propValue) return "";
  if (params.has("VALUE=DATE") || /^\d{8}$/.test(propValue)) {
    const year = Number(propValue.slice(0, 4));
    const month = Number(propValue.slice(4, 6));
    const day = Number(propValue.slice(6, 8));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (end) date.setUTCDate(date.getUTCDate() - 1);
    return `${date.toISOString().slice(0, 10)}T${end ? "23:59" : "00:00"}${offsetSuffix(offsetMinutes)}`;
  }
  const year = Number(propValue.slice(0, 4));
  const month = Number(propValue.slice(4, 6));
  const day = Number(propValue.slice(6, 8));
  const hour = Number(propValue.slice(9, 11));
  const minute = Number(propValue.slice(11, 13));
  if (propValue.endsWith("Z")) {
    const utc = Date.UTC(year, month - 1, day, hour, minute);
    const local = new Date(utc + offsetMinutes * 60000);
    return `${local.toISOString().slice(0, 16)}${offsetSuffix(offsetMinutes)}`;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}${offsetSuffix(offsetMinutes)}`;
}

function reviewReason(address, location, title, layer) {
  if (!address && !location) return "Missing location/address";
  if (!address) return "Missing address";
  if (/^[A-Za-z .'-]+,\s*(UK|GB|United Kingdom|United States|Portugal)$/.test(address)) return "City or country only";
  if (/^[A-Za-z .'-]+(?:\s*\([A-Z]{3}\))?$/.test(address)) return "Place name or airport code only";
  if (/\b[A-Z]{3}\s+to\s+[A-Z]{3}\b/.test(title) && layer === "Flights / Airports") return "Flight endpoint only";
  const hasPostcode = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(address) || /\b\d{5}(?:-\d{4})?\b/.test(address);
  const hasNumber = /\d/.test(address);
  return !hasPostcode && !hasNumber ? "No street number or postcode" : "";
}

function buildItems(events, options) {
  const built = [];
  for (const [index, event] of events.entries()) {
    const title = prop(event, "SUMMARY");
    const notes = prop(event, "DESCRIPTION");
    const rawLocation = prop(event, "LOCATION");
    const [locationName, address] = splitLocation(rawLocation);
    const eventType = inferEventType(title, notes);
    const isDirections = isDirectionEvent(eventType, title, notes);
    let layer = inferLayer(eventType, title, rawLocation, notes);
    if (isDirections) layer = "Transport";
    const startOffset = timezoneOffset(title, rawLocation, notes, false);
    const endOffset = timezoneOffset(title, rawLocation, notes, true);
    const start = localDateTime(prop(event, "DTSTART"), event.DTSTART?.params || new Set(), startOffset);
    const end = localDateTime(prop(event, "DTEND"), event.DTEND?.params || new Set(), endOffset, true);
    if (!dateInWindow(start, options.startDate, options.endDate)) continue;
    const reason = isDirections ? "" : reviewReason(address, locationName, title, layer);
    const geo = parseGeo(prop(event, "GEO"));
    built.push({
      id: prop(event, "UID") || `event-${index + 1}`,
      title,
      type: appType(eventType, layer, title, isDirections),
      startDateTime: start,
      endDateTime: end,
      locationText: rawLocation,
      addressText: address,
      city: inferCity(address, title, rawLocation),
      country: inferCountry(address, title),
      notes,
      latitude: geo?.[0] ?? null,
      longitude: geo?.[1] ?? null,
      coordinateSource: geo ? "ics" : "",
      reviewReason: reason,
      isDirections,
      synthesizeDirections: options.synthesizeDirections
    });
  }
  return built.sort((a, b) => (a.startDateTime || "").localeCompare(b.startDateTime || ""));
}

function dateInWindow(value, startDate, endDate) {
  if (!value) return true;
  const date = value.slice(0, 10);
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function resetDateControls() {
  const days = [...new Set(items.map(dayKey).filter(Boolean))].sort();
  els.daySelect.replaceChildren();
  for (const day of days) els.daySelect.append(new Option(formatDay(day), day));
  els.startDate.value = days[0] || "";
  els.endDate.value = days.at(-1) || "";
}

function dayKey(item) {
  return (item.startDateTime || "").slice(0, 10);
}

function formatDay(day) {
  if (!day) return "";
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(value) {
  if (!value) return "All day";
  return value.slice(11, 16) || "All day";
}

function itemHasCoords(item) {
  return Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
}

function categoryIcon(type, selected) {
  const size = selected ? 46 : 38;
  const pinSize = selected ? 40 : 32;
  return L.divIcon({
    className: "category-marker-wrapper",
    html: `<div class="category-marker${selected ? " selected" : ""}" style="--pin-color:${COLORS[type] || COLORS.Other}"><span>${ICONS[type] || ICONS.Other}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, pinSize],
    popupAnchor: [0, -pinSize]
  });
}

function visibleItems() {
  return items.filter(item => activeTypes.has(item.type) && itemInDateWindow(item));
}

function itemInDateWindow(item) {
  const day = dayKey(item);
  if (!day) return false;
  if (els.viewMode.value === "all") return true;
  if (els.viewMode.value === "day") return day === els.daySelect.value;
  return day >= els.startDate.value && day <= els.endDate.value;
}

function render() {
  els.dayControl.style.display = els.viewMode.value === "day" ? "grid" : "none";
  els.rangeControl.style.display = els.viewMode.value === "range" ? "grid" : "none";
  if (!activeTrip) {
    els.itinerary.innerHTML = '<div class="empty-state">Import a TripIt ICS file or calendar feed to get started.</div>';
    markerLayer.clearLayers();
    routeLayer.clearLayers();
    els.visibleSummary.textContent = "No trip selected.";
    els.routeStatus.textContent = "Import a trip to show routes.";
    return;
  }
  const visible = visibleItems();
  visibleRouteLegsById.clear();
  renderItinerary(visible);
  renderMap(visible);
  const markerCount = visible.filter(item => itemHasCoords(item) && !item.isDirections).length;
  els.visibleSummary.textContent = `${visible.length} visible items, ${markerCount} mapped`;
}

function renderItinerary(visible) {
  els.itinerary.replaceChildren();
  itemButtonsById.clear();
  const byDay = new Map();
  for (const item of visible) {
    const day = dayKey(item);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(item);
  }
  for (const [day, dayItems] of [...byDay.entries()].sort()) {
    dayItems.sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
    const routeLegs = routeLegsForDay(dayItems, els.routedRoutes.checked);
    const routeLegsByFromId = new Map();
    const tripitByDirectionId = new Map();
    for (const leg of routeLegs) {
      if (leg.source === "tripit" && leg.directionItem) tripitByDirectionId.set(leg.directionItem.id, leg);
      if (leg.source === "generated" || !leg.directionItem) {
        if (!routeLegsByFromId.has(leg.from.id)) routeLegsByFromId.set(leg.from.id, []);
        routeLegsByFromId.get(leg.from.id).push(leg);
      }
    }
    const section = document.createElement("section");
    section.className = "day";
    const heading = document.createElement("h2");
    heading.textContent = `${formatDay(day)} (${dayItems.length} items${routeLegs.length ? `, ${routeLegs.length} routes` : ""})`;
    section.append(heading);
    for (const item of dayItems) {
      if (item.isDirections) {
        const leg = tripitByDirectionId.get(item.id);
        section.append(leg ? routeEntry(leg) : itemEntry(item));
        continue;
      }
      section.append(itemEntry(item));
      for (const leg of routeLegsByFromId.get(item.id) || []) section.append(routeEntry(leg));
    }
    els.itinerary.append(section);
  }
}

function itemEntry(item) {
  const button = document.createElement("button");
  button.className = `item${itemHasCoords(item) ? "" : " no-marker"}`;
  button.dataset.itemId = item.id;
  button.innerHTML = `
    <div class="item-top">
      <span class="time">${formatTime(item.startDateTime)}</span>
      <span class="title">${escapeHtml(item.title)}</span>
    </div>
    <span class="pill" style="background:${COLORS[item.type] || COLORS.Other}">${escapeHtml(item.type)}</span>
    <div class="meta">${escapeHtml([item.city, item.country].filter(Boolean).join(", "))}</div>
    <div class="meta">${escapeHtml(item.addressText || item.locationText || "No location")}</div>
  `;
  button.addEventListener("click", () => focusItem(item.id, false));
  itemButtonsById.set(item.id, button);
  return button;
}

function routeEntry(leg) {
  const details = routeDetailsById.get(leg.id);
  const button = document.createElement("button");
  button.className = `route-entry${leg.id === activeRouteId ? " active" : ""}${details ? "" : " loading"}`;
  button.dataset.routeId = leg.id;
  const title = leg.directionItem?.title || `${leg.from.title} → ${leg.to.title}`;
  button.innerHTML = `
    <span class="route-title">${leg.source === "tripit" ? "TripIt directions" : "Directions"}: ${escapeHtml(title)}</span>
    <span class="meta">${escapeHtml(leg.from.title)} → ${escapeHtml(leg.to.title)}</span>
    <span class="meta">${escapeHtml(routeDetailsText(leg))}</span>
  `;
  button.addEventListener("click", () => focusRoute(leg.id, true, true, false));
  return button;
}

function updateRouteEntry(routeId) {
  const leg = visibleRouteLegsById.get(routeId);
  const entry = document.querySelector(`[data-route-id="${cssEscape(routeId)}"]`);
  if (!entry || !leg) return;
  const details = routeDetailsById.get(routeId);
  entry.classList.toggle("loading", !details);
  entry.classList.toggle("active", routeId === activeRouteId);
  const metas = entry.querySelectorAll(".meta");
  if (metas[1]) metas[1].textContent = routeDetailsText(leg);
}

function renderMap(visible) {
  markerLayer.clearLayers();
  routeLayer.clearLayers();
  markersById.clear();
  const bounds = [];
  const singleDayMode = els.viewMode.value === "day";
  for (const item of visible) {
    if (!itemHasCoords(item) || item.isDirections) continue;
    const selectedDay = singleDayMode && dayKey(item) === els.daySelect.value;
    const marker = L.marker([item.latitude, item.longitude], { icon: categoryIcon(item.type, selectedDay) });
    marker.bindPopup(popupHtml(item), { maxWidth: 360 });
    marker.addTo(markerLayer);
    markersById.set(item.id, marker);
    bounds.push([item.latitude, item.longitude]);
  }
  const token = ++routeRenderToken;
  drawRoutes(visible, token);
  if (bounds.length) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });
  else map.setView([51.5, -1.2], 6);
}

function routeableItems(dayItems) {
  return dayItems.filter(item => itemHasCoords(item) && item.type !== "Flights" && !item.isDirections);
}

function routePairKey(from, to) {
  return `${from.id}->${to.id}`;
}

function routeLegId(source, day, index, from, to, directionItem = null) {
  return directionItem ? `${source}-${directionItem.id}` : `${source}-${day}-${index}-${from.id}-${to.id}`;
}

function secondsBetween(startValue, endValue) {
  if (!startValue || !endValue) return NaN;
  const seconds = (new Date(endValue).getTime() - new Date(startValue).getTime()) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : NaN;
}

function samePoint(first, second) {
  return itemHasCoords(first) && itemHasCoords(second) && directDistanceMeters(first, second) < 50;
}

function importedDirectionLegsForDay(dayItems) {
  const routeable = routeableItems(dayItems);
  const directions = dayItems.filter(item => item.isDirections);
  const legs = [];
  for (const directionItem of directions) {
    const previous = [...routeable].reverse().find(item => item.startDateTime <= directionItem.startDateTime);
    const next = routeable.find(item => item.startDateTime >= (directionItem.endDateTime || directionItem.startDateTime));
    if (!previous) continue;
    const to = itemHasCoords(directionItem) ? directionItem : next;
    if (!to || previous.id === to.id || samePoint(previous, to)) continue;
    const leg = {
      id: routeLegId("tripit", dayKey(directionItem), legs.length, previous, to, directionItem),
      day: dayKey(directionItem),
      from: previous,
      to,
      sequence: legs.length,
      source: "tripit",
      directionItem,
      matchedNext: next && next.id !== to.id ? next : null,
      scheduledDurationSeconds: secondsBetween(directionItem.startDateTime, directionItem.endDateTime)
    };
    legs.push(leg);
    visibleRouteLegsById.set(leg.id, leg);
  }
  if (!legs.length && dayItems.some(item => item.synthesizeDirections)) {
    for (let index = 0; index < routeable.length - 1; index += 1) {
      const from = routeable[index];
      const to = routeable[index + 1];
      if (samePoint(from, to)) continue;
      const leg = {
        id: routeLegId("tripit", dayKey(from), index, from, to),
        day: dayKey(from),
        from,
        to,
        sequence: index,
        source: "tripit",
        directionItem: null,
        matchedNext: null,
        scheduledDurationSeconds: secondsBetween(from.endDateTime, to.startDateTime)
      };
      legs.push(leg);
      visibleRouteLegsById.set(leg.id, leg);
    }
  }
  return legs;
}

function routeLegsForDay(dayItems, includeGenerated = true) {
  const routeable = routeableItems(dayItems);
  const importedLegs = importedDirectionLegsForDay(dayItems);
  const importedPairs = new Set();
  for (const leg of importedLegs) {
    importedPairs.add(routePairKey(leg.from, leg.to));
    if (leg.matchedNext) importedPairs.add(routePairKey(leg.from, leg.matchedNext));
  }
  const legs = [...importedLegs];
  if (!includeGenerated) return legs;
  for (let index = 0; index < routeable.length - 1; index += 1) {
    const from = routeable[index];
    const to = routeable[index + 1];
    if (samePoint(from, to) || importedPairs.has(routePairKey(from, to))) continue;
    const leg = {
      id: routeLegId("generated", dayKey(from), index, from, to),
      day: dayKey(from),
      from,
      to,
      sequence: index,
      source: "generated",
      directionItem: null,
      matchedNext: null,
      scheduledDurationSeconds: NaN
    };
    legs.push(leg);
    visibleRouteLegsById.set(leg.id, leg);
  }
  return legs;
}

function visibleRouteLegs(visible, includeGenerated = true) {
  const byDay = new Map();
  for (const item of visible) {
    const day = dayKey(item);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(item);
  }
  const legs = [];
  for (const dayItems of byDay.values()) {
    dayItems.sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
    legs.push(...routeLegsForDay(dayItems, includeGenerated));
  }
  return legs;
}

function routeDetailsText(leg) {
  const details = routeDetailsById.get(leg.id);
  const source = leg.source === "tripit" ? "TripIt directions" : "Generated";
  const schedule = Number.isFinite(leg.scheduledDurationSeconds) ? ` • scheduled ${formatDuration(leg.scheduledDurationSeconds)}` : "";
  if (!details) return `${source}${schedule} • loading route distance and travel time...`;
  if (details.status === "fallback") return `${source}${schedule} • routing unavailable; showing straight-line fallback (${formatDistance(details.distanceMeters)} direct).`;
  return `${source}${schedule} • ${formatDistance(details.distanceMeters)} • ${formatDuration(details.durationSeconds)} by road`;
}

async function drawRoutes(visible, token) {
  routeLayersById.clear();
  const legs = visibleRouteLegs(visible, els.routedRoutes.checked);
  const useRouting = els.routedRoutes.checked;
  els.routeStatus.textContent = useRouting
    ? "Loading OSRM road directions for visible route legs..."
    : "TripIt directions use straight fallback lines. Enable OSRM for road geometry and generated gaps.";
  if (!useRouting) {
    for (const leg of legs) {
      routeDetailsById.set(leg.id, { status: "fallback", distanceMeters: directDistanceMeters(leg.from, leg.to), durationSeconds: NaN });
      drawFallbackLeg(leg);
    }
    return;
  }
  const results = await Promise.all(legs.map(leg => drawRoutedLeg(leg, token)));
  if (token !== routeRenderToken) return;
  const routedCount = results.reduce((total, result) => total + result.routed, 0);
  const fallbackCount = results.reduce((total, result) => total + result.fallback, 0);
  els.routeStatus.textContent = `OSRM road directions shown for ${routedCount} route legs.${fallbackCount ? ` ${fallbackCount} fallbacks used.` : ""}`;
}

function osrmRoute(leg) {
  const coordinates = [leg.from, leg.to].map(item => `${item.longitude.toFixed(6)},${item.latitude.toFixed(6)}`).join(";");
  const key = `driving:${coordinates}`;
  if (!routeCache.has(key)) {
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;
    routeCache.set(key, fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`OSRM request failed: ${response.status}`);
        return response.json();
      })
      .then(json => {
        if (json.code !== "Ok" || !json.routes?.[0]?.geometry) throw new Error(json.message || json.code || "OSRM route failed");
        const route = json.routes[0];
        return { geometry: route.geometry, distanceMeters: route.distance, durationSeconds: route.duration };
      }));
  }
  return routeCache.get(key);
}

async function drawRoutedLeg(leg, token) {
  try {
    const route = await osrmRoute(leg);
    if (token !== routeRenderToken) return { routed: 0, fallback: 0 };
    routeDetailsById.set(leg.id, { status: "routed", distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds });
    const layer = L.geoJSON({ type: "Feature", geometry: route.geometry }, { style: normalRouteStyle() });
    wireRouteLayer(leg, layer);
    return { routed: 1, fallback: 0 };
  } catch {
    if (token === routeRenderToken) {
      routeDetailsById.set(leg.id, { status: "fallback", distanceMeters: directDistanceMeters(leg.from, leg.to), durationSeconds: NaN });
      drawFallbackLeg(leg);
    }
    return { routed: 0, fallback: 1 };
  }
}

function drawFallbackLeg(leg) {
  const layer = L.polyline([[leg.from.latitude, leg.from.longitude], [leg.to.latitude, leg.to.longitude]], fallbackRouteStyle(leg.id === activeRouteId));
  wireRouteLayer(leg, layer);
}

function wireRouteLayer(leg, layer) {
  layer.bindTooltip(routeDetailsText(leg), { sticky: true });
  layer.on("click", () => focusRoute(leg.id, false, true, true));
  layer.on("mouseover", () => focusRoute(leg.id, false, false, false));
  layer.addTo(routeLayer);
  routeLayersById.set(leg.id, layer);
  setRouteLayerStyle(leg.id, layer);
  updateRouteEntry(leg.id);
}

function normalRouteStyle() {
  return { color: "#0969da", opacity: els.viewMode.value === "day" ? 0.85 : 0.48, weight: els.viewMode.value === "day" ? 5 : 3 };
}

function activeRouteStyle() {
  return { color: "#cf222e", opacity: 0.95, weight: 7 };
}

function fallbackRouteStyle(active = false) {
  return { ...(active ? activeRouteStyle() : normalRouteStyle()), opacity: active ? 0.85 : 0.35, dashArray: "3 6" };
}

function setRouteLayerStyle(routeId, layer) {
  const active = routeId === activeRouteId;
  const details = routeDetailsById.get(routeId);
  const style = details?.status === "fallback" ? fallbackRouteStyle(active) : active ? activeRouteStyle() : normalRouteStyle();
  if (layer.setStyle) layer.setStyle(style);
}

function focusRoute(routeId, fitRoute = false, showPopup = false, revealEntry = true) {
  activeRouteId = routeId;
  let activeEntry = null;
  for (const [id, layer] of routeLayersById.entries()) setRouteLayerStyle(id, layer);
  for (const entry of document.querySelectorAll(".route-entry")) {
    const active = entry.dataset.routeId === routeId;
    entry.classList.toggle("active", active);
    if (active) activeEntry = entry;
  }
  if (revealEntry && activeEntry) activeEntry.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const layer = routeLayersById.get(routeId);
  const leg = visibleRouteLegsById.get(routeId);
  if (!layer || !leg) return;
  if (fitRoute && layer.getBounds) map.fitBounds(layer.getBounds(), { padding: [48, 48], maxZoom: 14 });
  if (showPopup && layer.getBounds) map.openPopup(routePopupHtml(leg), layer.getBounds().getCenter(), { maxWidth: 360 });
}

function focusItem(itemId, revealEntry = true) {
  const item = items.find(candidate => candidate.id === itemId);
  if (!item) return;
  if (ensureItemVisible(item)) {
    requestAnimationFrame(() => focusItem(itemId, revealEntry));
    return;
  }
  for (const button of document.querySelectorAll(".item")) button.classList.toggle("active", button.dataset.itemId === itemId);
  const entry = itemButtonsById.get(itemId);
  if (revealEntry && entry) entry.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const marker = markersById.get(itemId);
  if (marker) {
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 14), { animate: true });
    marker.openPopup();
  } else if (item.isDirections) {
    const route = [...visibleRouteLegsById.values()].find(leg => leg.directionItem?.id === item.id);
    if (route) focusRoute(route.id, true, true, false);
  }
}

function ensureItemVisible(item) {
  let changed = false;
  if (!activeTypes.has(item.type)) {
    activeTypes.add(item.type);
    for (const checkbox of els.filters.querySelectorAll("input[type='checkbox']")) {
      if (checkbox.value === item.type) checkbox.checked = true;
    }
    updateFilterSummary();
    changed = true;
  }
  if (!itemInDateWindow(item)) {
    els.viewMode.value = "all";
    changed = true;
  }
  if (changed) render();
  return changed;
}

function popupHtml(item) {
  const location = [item.locationText, item.addressText].filter(Boolean).map(escapeHtml).join("<br>");
  return `
    <div class="popup">
      <h3>${escapeHtml(item.title)}</h3>
      <p><strong>${escapeHtml(item.type)}</strong> ${escapeHtml(formatDay(dayKey(item)))} ${escapeHtml(formatTime(item.startDateTime))}</p>
      <p>${escapeHtml([item.city, item.country].filter(Boolean).join(", "))}</p>
      <p>${location}</p>
      <pre>${escapeHtml(item.notes)}</pre>
    </div>`;
}

function routePopupHtml(leg) {
  return `
    <div class="popup">
      <h3>Directions</h3>
      <p><strong>${escapeHtml(leg.directionItem?.title || `${leg.from.title} → ${leg.to.title}`)}</strong></p>
      <p>${escapeHtml(leg.from.title)} → ${escapeHtml(leg.to.title)}</p>
      <p>${escapeHtml(routeDetailsText(leg))}</p>
      <p>${escapeHtml(formatDay(leg.day))}</p>
    </div>`;
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "unknown distance";
  const miles = meters / 1609.344;
  return miles < 0.1 ? `${Math.round(meters)} m` : `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "unknown time";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
}

function directDistanceMeters(from, to) {
  const earthRadiusMeters = 6371000;
  const toRadians = degrees => degrees * Math.PI / 180;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderSearchResults() {
  const query = els.tripSearch.value.trim();
  els.searchResults.replaceChildren();
  activeSearchIndex = -1;
  if (!query) return closeSearchResults();
  const matches = matchingItems(query);
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "search-result";
    empty.textContent = "No matching trip items";
    els.searchResults.append(empty);
    els.searchResults.classList.add("open");
    return;
  }
  for (const [index, item] of matches.entries()) {
    const button = document.createElement("button");
    button.className = "search-result";
    button.type = "button";
    button.dataset.itemId = item.id;
    button.dataset.index = String(index);
    button.innerHTML = `
      <span class="search-result-title">${escapeHtml(item.title)}</span>
      <span class="meta">${escapeHtml([formatDay(dayKey(item)), formatTime(item.startDateTime), item.type].filter(Boolean).join(" • "))}</span>
      <span class="meta">${escapeHtml(item.addressText || item.locationText || "No location")}</span>`;
    button.addEventListener("click", () => selectSearchItem(item.id));
    els.searchResults.append(button);
  }
  els.searchResults.classList.add("open");
}

function matchingItems(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    const text = [item.title, item.type, item.locationText, item.addressText, item.city, item.country, item.notes].filter(Boolean).join(" ").toLowerCase();
    return terms.every(term => text.includes(term));
  }).slice(0, 12);
}

function closeSearchResults() {
  els.searchResults.classList.remove("open");
  els.searchResults.replaceChildren();
  activeSearchIndex = -1;
}

function handleSearchKeydown(event) {
  const buttons = [...els.searchResults.querySelectorAll(".search-result[data-item-id]")];
  if (event.key === "Escape") return closeSearchResults();
  if (!buttons.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeSearchIndex = Math.min(activeSearchIndex + 1, buttons.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeSearchIndex = Math.max(activeSearchIndex - 1, 0);
  } else if (event.key === "Enter") {
    event.preventDefault();
    selectSearchItem(buttons[Math.max(activeSearchIndex, 0)]?.dataset.itemId);
  }
  buttons.forEach((button, index) => button.classList.toggle("active", index === activeSearchIndex));
  buttons[activeSearchIndex]?.scrollIntoView({ block: "nearest" });
}

function selectSearchItem(itemId) {
  if (!itemId) return;
  closeSearchResults();
  els.tripSearch.value = "";
  focusItem(itemId, true);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}
