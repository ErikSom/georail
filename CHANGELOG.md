# Changelog

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
