# Changelog

## 0.7.2 (2026-05-27)

### docs

* update changelog 

### Performance

* **hud:** cut update churn 

### Features

* **Game:** add graphics presets

## 0.7.1 (2026-05-26)

### Bug Fixes
* **app:** Performance improvements 

## 0.7.0 (2026-05-26)

### Features

* **live trains:** show live NS traffic in the game without a URL flag
* **live trains:** click a train dot to follow another service across the map
* **live trains:** switch from map dots to lightweight 3D train proxies when zoomed in
* **live trains:** use NS consist data where available for more realistic train lengths
* **map:** load nearby rail chunks so close-up live trains can stay on the rails

### Improvements

* **camera:** keep far-away followed trains stable when the map recenters
* **map:** keep the fallback floor local so it does not cut through distant terrain
* **train:** prevent the player train from overlapping itself at route edges

### Bug Fixes

* **live trains:** keep stopped trains visible at stations
* **live trains:** reduce stop-start motion caused by repeated NS snapshots

## 0.6.0 (2026-05-14)

### style

* **picker:** white active state for cards/tabs and taller back button 

### refactor

* **picker:** inline per-locale description on train config with English fallback 

### Performance

* **hud:** scale Maps2D car icons via transform to avoid SVG re-rasterization 
* **routes:** lower statement_timeout from 60s to 30s 
* **routes:** set local statement_timeout to 60s for long multi-stop journeys 

### Features

* **editor:** edit areas, multi-select with marquee, per-track colors 
* **editor:** R snaps the whole selection to terrain with smarter sampling 
* **faq:** add /faq and /nl/faq pages with footer and early-access links 
* **Game:** persisted metric/imperial unit toggle 
* **hud:** F3 panel shows current track segment 
* **hud:** warn when stopped at a station with doors closed 
* **i18n:** EN/NL multi-language routing with persisted preference 
* **i18n:** finish translating in-game HUD and station picker 
* **i18n:** localize app screens to English and Dutch 
* **overpass:** search rail routes by name or relation id with type filters 
* **picker:** add train picker between route selection and journey start 
* **picker:** localize train picker strings via i18n 
* **rail:** trains follow real terrain across the Netherlands 
* **routes:** expose rail point override source (manual/seed) via API and DB 
* **seed:** replace AHN with ProRail PVS_Verticale_Elementen as altitude source 
* **tiles:** look-ahead camera, LRU caps, and rail corrector wiring 
* **Train Editor:** enable debug visualization via ?trainDebug URL param 
* **Train Editor:** expose ready promise resolved on initial model load 
* **Train Editor:** rail corrector snaps path Y to terrain at runtime 
* **travel:** map-based station picker with mobile two-tap select 

### Bug Fixes

* **archive:** dedupe in-progress sessions for same route and cap visible history at 20 
* **Game:** ensure max speed sign is inside viewport 
* **hud:** keep coordinates and tile credits in sync with the camera 
* **routing:** tolerate trailing slash on /faq and /credits route checks 
* **Train Editor:** only apply downward rail corrections, never upward 
* **Train Editor:** restore bounded upward rail corrections (1m rise cap, 1.5m kink guard) 
* **Train Editor:** revert rail corrector bounds to original 5m up-kink threshold 
* **travel:** anchor archive badge to its label

## 0.5.0 (2026-05-02)

### Features

* **rail:** trains follow real terrain across the Netherlands
* **editor:** edit areas, multi-select with marquee, per-track colors
* **hud:** F3 panel shows current track segment

## 0.4.1 (2026-04-27)

### Features

* **i18n:** finish translating in-game HUD and station picker 
* **travel:** map-based station picker with mobile two-tap select 

### Bug Fixes

* **archive:** dedupe in-progress sessions for same route and cap visible history at 20 
* **travel:** anchor archive badge to its label

## 0.4.0 (2026-04-26)

### Features

* **Game:** persisted metric/imperial unit toggle 
* **i18n:** localize app screens to English and Dutch

## 0.3.2 (2026-04-24)

### Features

* **editor:** auto height and key node improvements 
* **Game:** pause & resume journeys from the archive 
* **Game:** sub-path segmentation with hard stops at terminal buffers 
* **hud:** f3 debug panel with station jump 
* **stations:** restore missing stations and platform detail 
* **user-routes:** drive and share with play counts 
* **user-routes:** itinerary-driven traversal for terminal reversals 
* **user-routes:** osm-backed path editor with save and edit 

### Bug Fixes

* **user-routes:** preserve turnaround_indices on edit save

## 0.3.1 (2026-04-19)

### Features

* **Game:** filter for live departures 
* **Game:** history + round trips 
* **Game:** max speed indication 
* **Game:** proper 3d-tiles loading state 

### Bug Fixes

* **Game:** early access notice

## 0.3.0 (2026-04-11)

### docs

* **Config:** comment cleanup 

### Features

* **Game:** ability to lock compass to north + fix rotation issues 
* **Game:** added in-game menu 
* **Game:** improve travel picker look 
* **Game:** let it rain 
* **Train Editor:** added coasting and gear shifting 
* **Train Editor:** improved controls for reverse 
* **Train Editor:** train sounds for doors and horn 

### Bug Fixes

* **Config:** ability to show indicator at start station 
* **Game:** better initial positions for components 
* **Game:** fix distance for routes 
* **Game:** fix editor bug with shared coords 
* **Game:** fix editor with multi stops and long distance corrections 
* **Game:** fix journey issues 
* **Game:** fix routing bugs 
* **Game:** less frame allocations 
* **Game:** optimize draw calls 
* **Game:** performance improvements 
* **Game:** simplify new station logic

## 0.2.0 (2026-02-22)

### refactor

* **Config:** security + support for multi country 

### style

* **Core:** visualize regular travel picker 

### docs

* **Config:** fix the changelog code 

### Features

* **Core:** added maxspeed to journey data 
* **Core:** journey fetching from NS 
* **Game:** ability to hide gui elements 
* **Game:** add info on coverage and user participation 
* **Game:** added timescale 
* **Game:** analog speedometer 
* **Game:** boundary / wrong direction indicators and auto breaks 
* **Game:** configurable dwell times 
* **Game:** improved transit component 
* **Game:** new game camera 
* **Game:** station indicator 
* **Game:** support for multi stop routes 
* **Game:** tracking stations and distance travelled for users 
* **Game:** transit feature 
* **Train Editor:** door open and close with error feedback 
* **Train Editor:** emmisive lights 
* **Train Editor:** further improve emmisive light textures 
* **Train Editor:** train flares and more light configuration 

### Bug Fixes

* **Config:** improve database speed for pathfinding 
* **Core:** prevent journeys from being flagged wrongly 
* **Game:** added caching to journey fetching 
* **Game:** allow for irregular scaling of maps 
* **Game:** better looking station indicators 
* **Game:** fix dragging of the speedometer not working 
* **Game:** fix regular travel picker not working 
* **Map Editor:** fix editor not loading routes 
* **Train Editor:** prevent lag with turning lights on

## 0.1.0 (2026-01-28)

### Features

* **Game:** added the speedometer
