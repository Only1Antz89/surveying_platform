// OpenFreeMap permits commercial use of its public instance without an API key.
// MapLibre displays the style's OpenMapTiles / OpenStreetMap attribution.
export function mapStyleUrl(configured:string|undefined) {
  return configured?.trim() || "https://tiles.openfreemap.org/styles/bright";
}
