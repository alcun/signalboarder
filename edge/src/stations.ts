import data from "./stations.json";

export interface Station { name: string; crs: string }

function normalise(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/&/g, " and ").replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

// Loaded once from the checked-in dataset; no web root or provider required.
const stations = data.map(([name, crs]) => ({ name: name!, crs: crs!, search: normalise(name!) }));

export function stationByCrs(crs: string): Station | undefined {
  const station = stations.find((station) => station.crs === crs.toUpperCase());
  return station ? { name: station.name, crs: station.crs } : undefined;
}

export function findStations(query: string, limit = 5): Station[] {
  const search = normalise(query);
  if (!search) return [];
  const short = search.replace(/ /g, "").length < 3;
  return stations.map((station) => {
    const rank = station.crs.toLowerCase() === search.replace(/ /g, "") ? 0
      : station.search === search ? 1
      : station.search.startsWith(search) ? 2
      : short ? (station.crs.toLowerCase().startsWith(search.replace(/ /g, "")) ? 2 : 5)
      : station.search.includes(` ${search}`) ? 3
      : station.search.includes(search) ? 4 : 5;
    return { station, rank };
  }).filter(({ rank }) => rank < 5)
    .sort((a, b) => a.rank - b.rank || a.station.name.localeCompare(b.station.name, "en-GB"))
    .slice(0, limit).map(({ station: { name, crs } }) => ({ name, crs }));
}

export function stationHint(query: string): string {
  let matches = findStations(query, 20).filter(({ crs }) => crs !== query.toUpperCase()).slice(0, 3);
  // A single mistyped letter is useful evidence; do not suggest arbitrary codes.
  if (!matches.length && /^[a-z]{3}$/i.test(query)) {
    const code = query.toUpperCase();
    matches = stations.filter(({ crs }) => [...crs].filter((letter, i) => letter !== code[i]).length === 1)
      .slice(0, 3).map(({ name, crs }) => ({ name, crs }));
  }
  return `Use find_station with a station name.${matches.length ? ` Possible stations: ${matches.map(({ name, crs }) => `${name} (${crs})`).join("; ")}.` : ""}`;
}
