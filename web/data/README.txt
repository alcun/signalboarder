UK railway stations, name to CRS code.

Source:  https://github.com/davwheat/uk-railway-stations
Pinned:  e6131cf3c674d286140155b22740da1064479b63
Fetched: 12 August 2026

Licensed under the Open Database License (ODbL). Attribution is required to
Dav Wheat, to Trainline EU (https://github.com/trainline-eu/stations), and to
their sources, which are listed on the Trainline repository. That credit is
rendered in the board's footer.

The dataset lists only stations that can be queried through the National Rail
Darwin API. That is why this doubles as a validity check: a well-formed code
that is not in this file cannot return a board, so the picker can say so
without spending an API request.

stations.csv is the upstream file, unmodified. public/stations.json is
generated from it by scripts/build-stations.mjs and is checked in, so a build
never depends on the network. Under the ODbL that generated file is a derived
database and carries the same licence and attribution.
