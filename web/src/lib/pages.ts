/**
 * The single source of truth for Signalboarder's public pages.
 *
 * Only stations with hand-written, useful copy belong here. Generating a page
 * for every entry in stations.json would create thousands of near-identical
 * doorway pages from nothing more than a name and CRS code.
 */

export const SITE_NAME = "Signalboarder";
export const AUTHOR_URL = "https://alcun.dev";
export const DATA_URL = "https://www.nationalrail.co.uk/";

export interface PageDef {
  /** Route path, empty for the home page. */
  slug: string;
  title: string;
  description: string;
  h1: string;
  navLabel: string;
  body: string[];
  /** A station route opens the board on this CRS code. */
  crs?: string;
}

export const PAGES: PageDef[] = [
  {
    slug: "",
    title: "Signalboarder - turn any device into a live UK train departure board",
    description:
      "Live UK train departures in a full-screen station board. Search any National Rail station, see platforms, expected times and calling points. No account required.",
    h1: "Turn any device into a live UK train departure board",
    navLabel: "Signalboarder home",
    body: [
      "Signalboarder turns any phone, tablet or computer into a live UK train departure board. Search by station name or three-letter CRS code, then leave it open for live departure times, platforms, delays and calling points.",
      "The platform view concentrates on the next three trains and a large clock. Tap the clock for the concourse view when you want the longer list. Full screen and a wake lock make the board useful on a phone or tablet left on a desk.",
      "Departures are fetched in your browser from Signalboarder's small gateway. There is no account and no journey history: Signalboarder does not store the station you view or the trains returned to you.",
    ],
  },
  {
    slug: "london-waterloo",
    crs: "WAT",
    title: "London Waterloo live departures - Signalboarder",
    description:
      "Live departures from London Waterloo (WAT), with platforms, expected times and calling points on a full-screen station board.",
    h1: "London Waterloo departures",
    navLabel: "London Waterloo",
    body: [
      "This board opens on London Waterloo, CRS code WAT. Waterloo is the central London terminus for a broad South Western Railway network, including services through south-west London and out towards Surrey, Hampshire and the south coast.",
      "At a terminus with many platforms, the platform and expected-time columns are often as important as the scheduled time. Signalboarder keeps those beside the destination, marks disruption in red and shows the first train's calling points beneath it.",
    ],
  },
  {
    slug: "london-victoria",
    crs: "VIC",
    title: "London Victoria live departures - Signalboarder",
    description:
      "Live departures from London Victoria (VIC), including platforms, expected times and calling points.",
    h1: "London Victoria departures",
    navLabel: "London Victoria",
    body: [
      "This board opens on London Victoria, CRS code VIC. Victoria serves south London, Surrey, Sussex and Kent, including the main rail route towards Gatwick Airport and Brighton.",
      "The station has separate groups of platforms and a dense peak service. Signalboarder shows the next trains in platform-board form, then switches to a longer concourse list when you tap the clock.",
    ],
  },
  {
    slug: "london-liverpool-street",
    crs: "LST",
    title: "London Liverpool Street live departures - Signalboarder",
    description:
      "Live departures from London Liverpool Street (LST), with platforms, expected times and calling points.",
    h1: "London Liverpool Street departures",
    navLabel: "Liverpool Street",
    body: [
      "This board opens on London Liverpool Street, CRS code LST. The terminus is a main gateway for services into Essex, Hertfordshire, Cambridgeshire and East Anglia, alongside Elizabeth line services through central London.",
      "A busy terminal board changes quickly, so Signalboarder refreshes while the tab is visible and keeps the last good departure list on screen if an update briefly fails. Stale data is labelled rather than silently disappearing.",
    ],
  },
  {
    slug: "london-kings-cross",
    crs: "KGX",
    title: "London King's Cross live departures - Signalboarder",
    description:
      "Live departures from London King's Cross (KGX), including platforms, expected times and calling points.",
    h1: "London King's Cross departures",
    navLabel: "King's Cross",
    body: [
      "This board opens on London King's Cross, CRS code KGX. King's Cross is the London end of the East Coast Main Line, with long-distance services towards Yorkshire, north-east England and Scotland as well as regional trains.",
      "Long-distance calling patterns matter here. Signalboarder rolls the next departure's calling points beneath the main row, while the concourse view gives more departures when you need to compare later trains.",
    ],
  },
  {
    slug: "birmingham-new-street",
    crs: "BHM",
    title: "Birmingham New Street live departures - Signalboarder",
    description:
      "Live departures from Birmingham New Street (BHM), with platforms, expected times and calling points.",
    h1: "Birmingham New Street departures",
    navLabel: "Birmingham New Street",
    body: [
      "This board opens on Birmingham New Street, CRS code BHM. New Street is the central interchange for routes across the West Midlands and for inter-city journeys linking London, the north-west, the north-east and the south-west.",
      "Because many services cross rather than terminate at Birmingham, destination alone may not tell you whether a train is useful. The first departure's calling points provide that context directly on the board.",
    ],
  },
  {
    slug: "manchester-piccadilly",
    crs: "MAN",
    title: "Manchester Piccadilly live departures - Signalboarder",
    description:
      "Live departures from Manchester Piccadilly (MAN), including platforms, expected times and calling points.",
    h1: "Manchester Piccadilly departures",
    navLabel: "Manchester Piccadilly",
    body: [
      "This board opens on Manchester Piccadilly, CRS code MAN. Piccadilly handles local and regional trains across Greater Manchester and northern England, plus inter-city services towards London, Birmingham and beyond.",
      "Through platforms 13 and 14 sit apart from the main train shed, so a platform change can materially affect the walk to a train. Signalboarder keeps the live platform prominent and highlights a delayed or cancelled expectation in red.",
    ],
  },
  {
    slug: "glasgow-central",
    crs: "GLC",
    title: "Glasgow Central live departures - Signalboarder",
    description:
      "Live departures from Glasgow Central (GLC), with platforms, expected times and calling points.",
    h1: "Glasgow Central departures",
    navLabel: "Glasgow Central",
    body: [
      "This board opens on Glasgow Central, CRS code GLC. Central is Glasgow's principal station for routes south of the River Clyde, with a large suburban network and long-distance trains towards England.",
      "The high-level terminus and low-level through platforms serve different flows. Signalboarder presents the platform returned with each live service and lets you expand from the next three trains to the fuller concourse list.",
    ],
  },
  {
    slug: "edinburgh-waverley",
    crs: "EDB",
    title: "Edinburgh Waverley live departures - Signalboarder",
    description:
      "Live departures from Edinburgh Waverley (EDB), including platforms, expected times and calling points.",
    h1: "Edinburgh Waverley departures",
    navLabel: "Edinburgh Waverley",
    body: [
      "This board opens on Edinburgh Waverley, CRS code EDB. Waverley connects Scotland's capital with Glasgow, the east and north of Scotland, the Borders and long-distance routes down both east and west coasts.",
      "Some trains terminate here while others continue across the central belt, so calling points are useful confirmation that you have the right service. Signalboarder shows them beneath the next departure without making you open a separate journey page.",
    ],
  },
  {
    slug: "about",
    title: "About Signalboarder - the board and the browser tab",
    description:
      "How Signalboarder turns National Rail live departure data into a browser board and a physical ESP32-S3 departure board, without storing journeys or personal data.",
    h1: "About Signalboarder",
    navLabel: "About Signalboarder",
    body: [
      "Signalboarder is one departure board with two surfaces. One is this browser tab. The other is a physical board built around an ESP32-S3 and an AMOLED display, designed to sit on a shelf and show the same live trains in the same compact model.",
      "Both surfaces ask a small Signalboarder gateway for a station. The gateway requests live departure data from National Rail's Darwin service, translates the provider response into Signalboarder's bounded departure model and briefly caches that station so many open boards do not all spend an upstream request at once. The browser then renders the returned trains locally.",
      "Signalboarder has no accounts and stores no journeys, station history or personal data. The browser may remember your chosen station and view on that device using local storage; it is not sent to a Signalboarder database because there is no Signalboarder database.",
      "Live departure data is provided by National Rail Enquiries. The searchable station list is derived from work by Dav Wheat and Trainline EU under the Open Database Licence. Signalboarder itself is made by alcun.dev.",
    ],
  },
];

export function pageFor(slug: string): PageDef {
  return PAGES.find((page) => page.slug === slug) ?? PAGES[0]!;
}
