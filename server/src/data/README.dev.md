# Developer Notes

go to https://overpass-turbo.eu/

```js
[out:json];
area["name"="Noord-Holland"]->.boundaryarea;
(
  // Select all ways with railway=rail and exclude those with tram=yes
  way(area.boundaryarea)["railway"="rail"]["tram"!~"yes"];
);
out body;
>;
out qt;
```
