(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = global || self, global.geojsonPathFinder = factory());
}(this, (function () { 'use strict';

    /**
     * @module helpers
     */
    /**
     * Earth Radius used with the Harvesine formula and approximates using a spherical (non-ellipsoid) Earth.
     *
     * @memberof helpers
     * @type {number}
     */
    var earthRadius = 6371008.8;
    /**
     * Unit of measurement factors using a spherical (non-ellipsoid) earth radius.
     *
     * @memberof helpers
     * @type {Object}
     */
    var factors = {
        centimeters: earthRadius * 100,
        centimetres: earthRadius * 100,
        degrees: earthRadius / 111325,
        feet: earthRadius * 3.28084,
        inches: earthRadius * 39.37,
        kilometers: earthRadius / 1000,
        kilometres: earthRadius / 1000,
        meters: earthRadius,
        metres: earthRadius,
        miles: earthRadius / 1609.344,
        millimeters: earthRadius * 1000,
        millimetres: earthRadius * 1000,
        nauticalmiles: earthRadius / 1852,
        radians: 1,
        yards: earthRadius * 1.0936,
    };
    /**
     * Wraps a GeoJSON {@link Geometry} in a GeoJSON {@link Feature}.
     *
     * @name feature
     * @param {Geometry} geometry input geometry
     * @param {Object} [properties={}] an Object of key-value pairs to add as properties
     * @param {Object} [options={}] Optional Parameters
     * @param {Array<number>} [options.bbox] Bounding Box Array [west, south, east, north] associated with the Feature
     * @param {string|number} [options.id] Identifier associated with the Feature
     * @returns {Feature} a GeoJSON Feature
     * @example
     * var geometry = {
     *   "type": "Point",
     *   "coordinates": [110, 50]
     * };
     *
     * var feature = turf.feature(geometry);
     *
     * //=feature
     */
    function feature(geom, properties, options) {
        if (options === void 0) { options = {}; }
        var feat = { type: "Feature" };
        if (options.id === 0 || options.id) {
            feat.id = options.id;
        }
        if (options.bbox) {
            feat.bbox = options.bbox;
        }
        feat.properties = properties || {};
        feat.geometry = geom;
        return feat;
    }
    /**
     * Creates a {@link Point} {@link Feature} from a Position.
     *
     * @name point
     * @param {Array<number>} coordinates longitude, latitude position (each in decimal degrees)
     * @param {Object} [properties={}] an Object of key-value pairs to add as properties
     * @param {Object} [options={}] Optional Parameters
     * @param {Array<number>} [options.bbox] Bounding Box Array [west, south, east, north] associated with the Feature
     * @param {string|number} [options.id] Identifier associated with the Feature
     * @returns {Feature<Point>} a Point feature
     * @example
     * var point = turf.point([-75.343, 39.984]);
     *
     * //=point
     */
    function point(coordinates, properties, options) {
        if (options === void 0) { options = {}; }
        if (!coordinates) {
            throw new Error("coordinates is required");
        }
        if (!Array.isArray(coordinates)) {
            throw new Error("coordinates must be an Array");
        }
        if (coordinates.length < 2) {
            throw new Error("coordinates must be at least 2 numbers long");
        }
        if (!isNumber(coordinates[0]) || !isNumber(coordinates[1])) {
            throw new Error("coordinates must contain numbers");
        }
        var geom = {
            type: "Point",
            coordinates: coordinates,
        };
        return feature(geom, properties, options);
    }
    /**
     * Takes one or more {@link Feature|Features} and creates a {@link FeatureCollection}.
     *
     * @name featureCollection
     * @param {Feature[]} features input features
     * @param {Object} [options={}] Optional Parameters
     * @param {Array<number>} [options.bbox] Bounding Box Array [west, south, east, north] associated with the Feature
     * @param {string|number} [options.id] Identifier associated with the Feature
     * @returns {FeatureCollection} FeatureCollection of Features
     * @example
     * var locationA = turf.point([-75.343, 39.984], {name: 'Location A'});
     * var locationB = turf.point([-75.833, 39.284], {name: 'Location B'});
     * var locationC = turf.point([-75.534, 39.123], {name: 'Location C'});
     *
     * var collection = turf.featureCollection([
     *   locationA,
     *   locationB,
     *   locationC
     * ]);
     *
     * //=collection
     */
    function featureCollection(features, options) {
        if (options === void 0) { options = {}; }
        var fc = { type: "FeatureCollection" };
        if (options.id) {
            fc.id = options.id;
        }
        if (options.bbox) {
            fc.bbox = options.bbox;
        }
        fc.features = features;
        return fc;
    }
    /**
     * Convert a distance measurement (assuming a spherical Earth) from radians to a more friendly unit.
     * Valid units: miles, nauticalmiles, inches, yards, meters, metres, kilometers, centimeters, feet
     *
     * @name radiansToLength
     * @param {number} radians in radians across the sphere
     * @param {string} [units="kilometers"] can be degrees, radians, miles, inches, yards, metres,
     * meters, kilometres, kilometers.
     * @returns {number} distance
     */
    function radiansToLength(radians, units) {
        if (units === void 0) { units = "kilometers"; }
        var factor = factors[units];
        if (!factor) {
            throw new Error(units + " units is invalid");
        }
        return radians * factor;
    }
    /**
     * Converts an angle in degrees to radians
     *
     * @name degreesToRadians
     * @param {number} degrees angle between 0 and 360 degrees
     * @returns {number} angle in radians
     */
    function degreesToRadians(degrees) {
        var radians = degrees % 360;
        return (radians * Math.PI) / 180;
    }
    /**
     * isNumber
     *
     * @param {*} num Number to validate
     * @returns {boolean} true/false
     * @example
     * turf.isNumber(123)
     * //=true
     * turf.isNumber('foo')
     * //=false
     */
    function isNumber(num) {
        return !isNaN(num) && num !== null && !Array.isArray(num);
    }

    /**
     * Given a graph of vertices and edges, simplifies the graph so redundant
     * nodes/edges are removed, only preserving nodes which are either:
     *
     *   * Dead ends: end of lines, where you can only go back in the opposite
     *     direction
     *   * Forks, where there is an option to go in multiple directions
     *
     * The idea is to reduce the number of nodes in the graph, which drasticly
     * reduces the complexity of Dijkstra's algorithm.
     *
     * @param sourceVertices the graph's vertices (a lookup of vertex edges and weights)
     * @param vertexCoords the geographic coordinates of the vertices
     * @param edgeData the (optional) data associated with each edge
     * @param options options used for creating and compacting the graph
     * @returns
     */
    function compactGraph(sourceVertices, vertexCoords, sourceEdgeData, options = {}) {
        const result = {
            vertices: Object.keys(sourceVertices).reduce((clonedVertices, vertexKey) => {
                clonedVertices[vertexKey] = { ...sourceVertices[vertexKey] };
                return clonedVertices;
            }, {}),
            coordinates: Object.keys(sourceVertices).reduce((coordinates, vertexKey) => {
                coordinates[vertexKey] = {};
                for (const neighborKey of Object.keys(sourceVertices[vertexKey])) {
                    coordinates[vertexKey][neighborKey] = [vertexCoords[vertexKey]];
                }
                return coordinates;
            }, {}),
            edgeData: "edgeDataReducer" in options
                ? Object.keys(sourceVertices).reduce((compactedEdges, vertexKey) => {
                    compactedEdges[vertexKey] = Object.keys(sourceVertices[vertexKey]).reduce((compactedEdges, targetKey) => {
                        compactedEdges[targetKey] = sourceEdgeData[vertexKey][targetKey];
                        return compactedEdges;
                    }, {});
                    return compactedEdges;
                }, {})
                : {},
        };
        const { vertices, coordinates, edgeData } = result;
        const hasEdgeDataReducer = "edgeDataReducer" in options && edgeData;
        const vertexKeysToCompact = Object.keys(sourceVertices).filter((vertexKey) => shouldCompact(sourceVertices, vertexKey));
        for (const vertexKey of vertexKeysToCompact) {
            const vertex = vertices[vertexKey];
            const edges = Object.keys(vertex);
            // No edges means all other vertices around this one have been compacted
            // and compacting this node would remove this part of the graph; skip compaction.
            if (edges.length === 0)
                continue;
            for (const neighborKey of edges) {
                for (const otherNeighborKey of edges) {
                    if (neighborKey !== otherNeighborKey) {
                        compact(vertexKey, neighborKey, otherNeighborKey);
                        compact(vertexKey, otherNeighborKey, neighborKey);
                    }
                }
            }
            for (const neighborKey of edges) {
                if (!vertices[neighborKey]) {
                    throw new Error(`Missing neighbor vertex for ${neighborKey}`);
                }
                delete vertices[neighborKey][vertexKey];
                delete coordinates[neighborKey][vertexKey];
            }
            delete vertices[vertexKey];
            delete coordinates[vertexKey];
        }
        return result;
        function compact(vertexKey, neighborKey, otherNeighborKey) {
            const vertex = vertices[vertexKey];
            const neighbor = vertices[neighborKey];
            const weightFromNeighbor = neighbor[vertexKey];
            if (!neighbor[otherNeighborKey] && weightFromNeighbor) {
                neighbor[otherNeighborKey] =
                    weightFromNeighbor + vertex[otherNeighborKey];
                coordinates[neighborKey][otherNeighborKey] = [
                    ...coordinates[neighborKey][vertexKey],
                    ...coordinates[vertexKey][otherNeighborKey],
                ];
                let reducedEdge = hasEdgeDataReducer
                    ? edgeData[neighborKey][vertexKey]
                    : undefined;
                const otherEdgeData = hasEdgeDataReducer
                    ? edgeData[vertexKey][otherNeighborKey]
                    : undefined;
                if (hasEdgeDataReducer && reducedEdge && otherEdgeData) {
                    edgeData[neighborKey][otherNeighborKey] = options.edgeDataReducer(reducedEdge, otherEdgeData);
                }
            }
        }
    }
    function compactNode(key, vertices, ends, vertexCoords, edgeData, trackIncoming, options = {}) {
        const neighbors = vertices[key];
        return Object.keys(neighbors).reduce(compactEdge, {
            edges: {},
            incomingEdges: {},
            coordinates: {},
            incomingCoordinates: {},
            reducedEdges: {},
        });
        function compactEdge(result, j) {
            const neighbor = findNextFork(key, j, vertices, ends, vertexCoords, edgeData, trackIncoming, options);
            const weight = neighbor.weight;
            const reverseWeight = neighbor.reverseWeight;
            if (neighbor.vertexKey !== key) {
                if (!result.edges[neighbor.vertexKey] ||
                    result.edges[neighbor.vertexKey] > weight) {
                    result.edges[neighbor.vertexKey] = weight;
                    result.coordinates[neighbor.vertexKey] = [vertexCoords[key]].concat(neighbor.coordinates);
                    result.reducedEdges[neighbor.vertexKey] = neighbor.reducedEdge;
                }
                if (trackIncoming &&
                    !isNaN(reverseWeight) &&
                    (!result.incomingEdges[neighbor.vertexKey] ||
                        result.incomingEdges[neighbor.vertexKey] > reverseWeight)) {
                    result.incomingEdges[neighbor.vertexKey] = reverseWeight;
                    var coordinates = [vertexCoords[key]].concat(neighbor.coordinates);
                    coordinates.reverse();
                    result.incomingCoordinates[neighbor.vertexKey] = coordinates;
                }
            }
            return result;
        }
    }
    function findNextFork(prev, vertexKey, vertices, ends, vertexCoords, edgeData, trackIncoming, options = {}) {
        let weight = vertices[prev][vertexKey];
        let reverseWeight = vertices[vertexKey][prev];
        const coordinates = [];
        const path = [];
        let reducedEdge = "edgeDataReducer" in options ? edgeData[vertexKey][prev] : undefined;
        while (!ends[vertexKey]) {
            var edges = vertices[vertexKey];
            if (!edges) {
                break;
            }
            var next = Object.keys(edges).filter(function notPrevious(k) {
                return k !== prev;
            })[0];
            weight += edges[next];
            if (trackIncoming) {
                reverseWeight += vertices[next]?.[vertexKey] || Infinity;
                if (path.indexOf(vertexKey) >= 0) {
                    ends[vertexKey] = vertices[vertexKey];
                    break;
                }
                path.push(vertexKey);
            }
            const nextEdgeData = edgeData[vertexKey] && edgeData[vertexKey][next];
            if ("edgeDataReducer" in options && reducedEdge && nextEdgeData) {
                reducedEdge = options.edgeDataReducer(reducedEdge, nextEdgeData);
            }
            coordinates.push(vertexCoords[vertexKey]);
            prev = vertexKey;
            vertexKey = next;
        }
        return {
            vertexKey,
            weight: weight,
            reverseWeight: reverseWeight,
            coordinates: coordinates,
            reducedEdge: reducedEdge,
        };
    }
    function shouldCompact(vertices, vertexKey) {
        const vertex = vertices[vertexKey];
        const edges = Object.keys(vertex);
        const numberEdges = edges.length;
        switch (numberEdges) {
            case 1: {
                // A vertex A with a single edge A->B is a fork
                // if B has an edge to A.
                // (It's a fork in the sense that it is a dead end and you can only turn back to B.)
                const other = vertices[edges[0]];
                return !other[vertexKey];
            }
            case 2: {
                // A vertex A which lies between two vertices B and C (only has two edges)
                // is only a fork if you can't go back to A from at least one of them.
                return edges.every((n) => vertices[n][vertexKey]);
            }
            default:
                // A vertex with more than two edges (a fork) is always a fork
                return false;
        }
    }

    class TinyQueue {
        constructor(data = [], compare = defaultCompare) {
            this.data = data;
            this.length = this.data.length;
            this.compare = compare;

            if (this.length > 0) {
                for (let i = (this.length >> 1) - 1; i >= 0; i--) this._down(i);
            }
        }

        push(item) {
            this.data.push(item);
            this.length++;
            this._up(this.length - 1);
        }

        pop() {
            if (this.length === 0) return undefined;

            const top = this.data[0];
            const bottom = this.data.pop();
            this.length--;

            if (this.length > 0) {
                this.data[0] = bottom;
                this._down(0);
            }

            return top;
        }

        peek() {
            return this.data[0];
        }

        _up(pos) {
            const {data, compare} = this;
            const item = data[pos];

            while (pos > 0) {
                const parent = (pos - 1) >> 1;
                const current = data[parent];
                if (compare(item, current) >= 0) break;
                data[pos] = current;
                pos = parent;
            }

            data[pos] = item;
        }

        _down(pos) {
            const {data, compare} = this;
            const halfLength = this.length >> 1;
            const item = data[pos];

            while (pos < halfLength) {
                let left = (pos << 1) + 1;
                let best = data[left];
                const right = left + 1;

                if (right < this.length && compare(data[right], best) < 0) {
                    left = right;
                    best = data[right];
                }
                if (compare(best, item) >= 0) break;

                data[pos] = best;
                pos = left;
            }

            data[pos] = item;
        }
    }

    function defaultCompare(a, b) {
        return a < b ? -1 : a > b ? 1 : 0;
    }

    function findPath(graph, start, end) {
        const costs = { [start]: 0 };
        const initialState = [0, [start], start];
        const queue = new TinyQueue([initialState], (a, b) => a[0] - b[0]);
        while (true) {
            const state = queue.pop();
            if (!state) {
                return undefined;
            }
            const cost = state[0];
            const node = state[2];
            if (node === end) {
                return [state[0], state[1]];
            }
            const neighbours = graph[node];
            Object.keys(neighbours).forEach(function (n) {
                var newCost = cost + neighbours[n];
                if (newCost < Infinity && (!(n in costs) || newCost < costs[n])) {
                    costs[n] = newCost;
                    const newState = [newCost, state[1].concat([n]), n];
                    queue.push(newState);
                }
            });
        }
    }

    /**
     * Unwrap a coordinate from a Point Feature, Geometry or a single coordinate.
     *
     * @name getCoord
     * @param {Array<number>|Geometry<Point>|Feature<Point>} coord GeoJSON Point or an Array of numbers
     * @returns {Array<number>} coordinates
     * @example
     * var pt = turf.point([10, 10]);
     *
     * var coord = turf.getCoord(pt);
     * //= [10, 10]
     */
    function getCoord(coord) {
        if (!coord) {
            throw new Error("coord is required");
        }
        if (!Array.isArray(coord)) {
            if (coord.type === "Feature" &&
                coord.geometry !== null &&
                coord.geometry.type === "Point") {
                return coord.geometry.coordinates;
            }
            if (coord.type === "Point") {
                return coord.coordinates;
            }
        }
        if (Array.isArray(coord) &&
            coord.length >= 2 &&
            !Array.isArray(coord[0]) &&
            !Array.isArray(coord[1])) {
            return coord;
        }
        throw new Error("coord must be GeoJSON Point or an Array of numbers");
    }

    //http://en.wikipedia.org/wiki/Haversine_formula
    //http://www.movable-type.co.uk/scripts/latlong.html
    /**
     * Calculates the distance between two {@link Point|points} in degrees, radians, miles, or kilometers.
     * This uses the [Haversine formula](http://en.wikipedia.org/wiki/Haversine_formula) to account for global curvature.
     *
     * @name distance
     * @param {Coord | Point} from origin point or coordinate
     * @param {Coord | Point} to destination point or coordinate
     * @param {Object} [options={}] Optional parameters
     * @param {string} [options.units='kilometers'] can be degrees, radians, miles, or kilometers
     * @returns {number} distance between the two points
     * @example
     * var from = turf.point([-75.343, 39.984]);
     * var to = turf.point([-75.534, 39.123]);
     * var options = {units: 'miles'};
     *
     * var distance = turf.distance(from, to, options);
     *
     * //addToMap
     * var addToMap = [from, to];
     * from.properties.distance = distance;
     * to.properties.distance = distance;
     */
    function distance(from, to, options) {
        if (options === void 0) { options = {}; }
        var coordinates1 = getCoord(from);
        var coordinates2 = getCoord(to);
        var dLat = degreesToRadians(coordinates2[1] - coordinates1[1]);
        var dLon = degreesToRadians(coordinates2[0] - coordinates1[0]);
        var lat1 = degreesToRadians(coordinates1[1]);
        var lat2 = degreesToRadians(coordinates2[1]);
        var a = Math.pow(Math.sin(dLat / 2), 2) +
            Math.pow(Math.sin(dLon / 2), 2) * Math.cos(lat1) * Math.cos(lat2);
        return radiansToLength(2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)), options.units);
    }

    /**
     * Callback for coordEach
     *
     * @callback coordEachCallback
     * @param {Array<number>} currentCoord The current coordinate being processed.
     * @param {number} coordIndex The current index of the coordinate being processed.
     * @param {number} featureIndex The current index of the Feature being processed.
     * @param {number} multiFeatureIndex The current index of the Multi-Feature being processed.
     * @param {number} geometryIndex The current index of the Geometry being processed.
     */

    /**
     * Iterate over coordinates in any GeoJSON object, similar to Array.forEach()
     *
     * @name coordEach
     * @param {FeatureCollection|Feature|Geometry} geojson any GeoJSON object
     * @param {Function} callback a method that takes (currentCoord, coordIndex, featureIndex, multiFeatureIndex)
     * @param {boolean} [excludeWrapCoord=false] whether or not to include the final coordinate of LinearRings that wraps the ring in its iteration.
     * @returns {void}
     * @example
     * var features = turf.featureCollection([
     *   turf.point([26, 37], {"foo": "bar"}),
     *   turf.point([36, 53], {"hello": "world"})
     * ]);
     *
     * turf.coordEach(features, function (currentCoord, coordIndex, featureIndex, multiFeatureIndex, geometryIndex) {
     *   //=currentCoord
     *   //=coordIndex
     *   //=featureIndex
     *   //=multiFeatureIndex
     *   //=geometryIndex
     * });
     */
    function coordEach(geojson, callback, excludeWrapCoord) {
      // Handles null Geometry -- Skips this GeoJSON
      if (geojson === null) return;
      var j,
        k,
        l,
        geometry,
        stopG,
        coords,
        geometryMaybeCollection,
        wrapShrink = 0,
        coordIndex = 0,
        isGeometryCollection,
        type = geojson.type,
        isFeatureCollection = type === "FeatureCollection",
        isFeature = type === "Feature",
        stop = isFeatureCollection ? geojson.features.length : 1;

      // This logic may look a little weird. The reason why it is that way
      // is because it's trying to be fast. GeoJSON supports multiple kinds
      // of objects at its root: FeatureCollection, Features, Geometries.
      // This function has the responsibility of handling all of them, and that
      // means that some of the `for` loops you see below actually just don't apply
      // to certain inputs. For instance, if you give this just a
      // Point geometry, then both loops are short-circuited and all we do
      // is gradually rename the input until it's called 'geometry'.
      //
      // This also aims to allocate as few resources as possible: just a
      // few numbers and booleans, rather than any temporary arrays as would
      // be required with the normalization approach.
      for (var featureIndex = 0; featureIndex < stop; featureIndex++) {
        geometryMaybeCollection = isFeatureCollection
          ? geojson.features[featureIndex].geometry
          : isFeature
          ? geojson.geometry
          : geojson;
        isGeometryCollection = geometryMaybeCollection
          ? geometryMaybeCollection.type === "GeometryCollection"
          : false;
        stopG = isGeometryCollection
          ? geometryMaybeCollection.geometries.length
          : 1;

        for (var geomIndex = 0; geomIndex < stopG; geomIndex++) {
          var multiFeatureIndex = 0;
          var geometryIndex = 0;
          geometry = isGeometryCollection
            ? geometryMaybeCollection.geometries[geomIndex]
            : geometryMaybeCollection;

          // Handles null Geometry -- Skips this geometry
          if (geometry === null) continue;
          coords = geometry.coordinates;
          var geomType = geometry.type;

          wrapShrink =
            excludeWrapCoord &&
            (geomType === "Polygon" || geomType === "MultiPolygon")
              ? 1
              : 0;

          switch (geomType) {
            case null:
              break;
            case "Point":
              if (
                callback(
                  coords,
                  coordIndex,
                  featureIndex,
                  multiFeatureIndex,
                  geometryIndex
                ) === false
              )
                return false;
              coordIndex++;
              multiFeatureIndex++;
              break;
            case "LineString":
            case "MultiPoint":
              for (j = 0; j < coords.length; j++) {
                if (
                  callback(
                    coords[j],
                    coordIndex,
                    featureIndex,
                    multiFeatureIndex,
                    geometryIndex
                  ) === false
                )
                  return false;
                coordIndex++;
                if (geomType === "MultiPoint") multiFeatureIndex++;
              }
              if (geomType === "LineString") multiFeatureIndex++;
              break;
            case "Polygon":
            case "MultiLineString":
              for (j = 0; j < coords.length; j++) {
                for (k = 0; k < coords[j].length - wrapShrink; k++) {
                  if (
                    callback(
                      coords[j][k],
                      coordIndex,
                      featureIndex,
                      multiFeatureIndex,
                      geometryIndex
                    ) === false
                  )
                    return false;
                  coordIndex++;
                }
                if (geomType === "MultiLineString") multiFeatureIndex++;
                if (geomType === "Polygon") geometryIndex++;
              }
              if (geomType === "Polygon") multiFeatureIndex++;
              break;
            case "MultiPolygon":
              for (j = 0; j < coords.length; j++) {
                geometryIndex = 0;
                for (k = 0; k < coords[j].length; k++) {
                  for (l = 0; l < coords[j][k].length - wrapShrink; l++) {
                    if (
                      callback(
                        coords[j][k][l],
                        coordIndex,
                        featureIndex,
                        multiFeatureIndex,
                        geometryIndex
                      ) === false
                    )
                      return false;
                    coordIndex++;
                  }
                  geometryIndex++;
                }
                multiFeatureIndex++;
              }
              break;
            case "GeometryCollection":
              for (j = 0; j < geometry.geometries.length; j++)
                if (
                  coordEach(geometry.geometries[j], callback, excludeWrapCoord) ===
                  false
                )
                  return false;
              break;
            default:
              throw new Error("Unknown Geometry Type");
          }
        }
      }
    }

    /**
     * Callback for featureEach
     *
     * @callback featureEachCallback
     * @param {Feature<any>} currentFeature The current Feature being processed.
     * @param {number} featureIndex The current index of the Feature being processed.
     */

    /**
     * Iterate over features in any GeoJSON object, similar to
     * Array.forEach.
     *
     * @name featureEach
     * @param {FeatureCollection|Feature|Geometry} geojson any GeoJSON object
     * @param {Function} callback a method that takes (currentFeature, featureIndex)
     * @returns {void}
     * @example
     * var features = turf.featureCollection([
     *   turf.point([26, 37], {foo: 'bar'}),
     *   turf.point([36, 53], {hello: 'world'})
     * ]);
     *
     * turf.featureEach(features, function (currentFeature, featureIndex) {
     *   //=currentFeature
     *   //=featureIndex
     * });
     */
    function featureEach(geojson, callback) {
      if (geojson.type === "Feature") {
        callback(geojson, 0);
      } else if (geojson.type === "FeatureCollection") {
        for (var i = 0; i < geojson.features.length; i++) {
          if (callback(geojson.features[i], i) === false) break;
        }
      }
    }

    /**
     * Takes a feature or set of features and returns all positions as {@link Point|points}.
     *
     * @name explode
     * @param {GeoJSON} geojson input features
     * @returns {FeatureCollection<point>} points representing the exploded input features
     * @throws {Error} if it encounters an unknown geometry type
     * @example
     * var polygon = turf.polygon([[[-81, 41], [-88, 36], [-84, 31], [-80, 33], [-77, 39], [-81, 41]]]);
     *
     * var explode = turf.explode(polygon);
     *
     * //addToMap
     * var addToMap = [polygon, explode]
     */
    function explode(geojson) {
      var points = [];
      if (geojson.type === "FeatureCollection") {
        featureEach(geojson, function (feature) {
          coordEach(feature, function (coord) {
            points.push(point(coord, feature.properties));
          });
        });
      } else {
        coordEach(geojson, function (coord) {
          points.push(point(coord, geojson.properties));
        });
      }
      return featureCollection(points);
    }

    function roundCoord(coord, tolerance) {
        return [
            Math.round(coord[0] / tolerance) * tolerance,
            Math.round(coord[1] / tolerance) * tolerance,
        ];
    }

    function createTopology(network, options = {}) {
        const { key = defaultKey } = options;
        const { tolerance = 1e-5 } = options;
        const lineStrings = featureCollection(network.features.filter((f) => f.geometry.type === "LineString"));
        const points = explode(lineStrings);
        const vertices = points.features.reduce(function buildTopologyVertices(coordinates, feature, index, features) {
            var rc = roundCoord(feature.geometry.coordinates, tolerance);
            coordinates[key(rc)] = feature.geometry.coordinates;
            if (index % 1000 === 0 && options.progress) {
                options.progress("topo:vertices", index, features.length);
            }
            return coordinates;
        }, {});
        const edges = geoJsonReduce(lineStrings, buildTopologyEdges, []);
        return {
            vertices: vertices,
            edges: edges,
        };
        function buildTopologyEdges(edges, f) {
            f.geometry.coordinates.forEach(function buildLineStringEdges(c, i, cs) {
                if (i > 0) {
                    var k1 = key(roundCoord(cs[i - 1], tolerance)), k2 = key(roundCoord(c, tolerance));
                    edges.push([k1, k2, f.properties]);
                }
            });
            return edges;
        }
    }
    function geoJsonReduce(geojson, fn, seed) {
        if (geojson.type === "FeatureCollection") {
            return geojson.features.reduce(function reduceFeatures(a, f) {
                return geoJsonReduce(f, fn, a);
            }, seed);
        }
        else {
            return fn(seed, geojson);
        }
    }
    function defaultKey(c) {
        return c.join(",");
    }

    function preprocess(network, options = {}) {
        const topology = createTopology(network, options);
        const { weight = defaultWeight } = options;
        const graph = topology.edges.reduce(reduceEdges, {
            edgeData: {},
            vertices: {},
        });
        const { vertices: compactedVertices, coordinates: compactedCoordinates, edgeData: compactedEdges, } = compactGraph(graph.vertices, topology.vertices, graph.edgeData, options);
        return {
            vertices: graph.vertices,
            edgeData: graph.edgeData,
            sourceCoordinates: topology.vertices,
            compactedVertices,
            compactedCoordinates,
            compactedEdges,
        };
        function reduceEdges(g, edge, i, es) {
            const [a, b, properties] = edge;
            const w = weight(topology.vertices[a], topology.vertices[b], properties);
            if (w) {
                makeEdgeList(a);
                makeEdgeList(b);
                // If the weight for an edge is falsy, it means the edge is impassable;
                // we still add the edge to the graph, but with a weight of Infinity,
                // since this makes compaction easier.
                // After compaction, we remove any edge with a weight of Infinity.
                if (w instanceof Object) {
                    concatEdge(a, b, w.forward || Infinity);
                    concatEdge(b, a, w.backward || Infinity);
                }
                else {
                    concatEdge(a, b, w || Infinity);
                    concatEdge(b, a, w || Infinity);
                }
            }
            if (i % 1000 === 0 && options.progress) {
                options.progress("edgeweights", i, es.length);
            }
            return g;
            function makeEdgeList(node) {
                if (!g.vertices[node]) {
                    g.vertices[node] = {};
                    g.edgeData[node] = {};
                }
            }
            function concatEdge(startNode, endNode, weight) {
                var v = g.vertices[startNode];
                v[endNode] = weight;
                g.edgeData[startNode][endNode] =
                    "edgeDataReducer" in options
                        ? options.edgeDataSeed(properties)
                        : undefined;
            }
        }
    }
    function defaultWeight(a, b) {
        return distance(point(a), point(b));
    }

    class PathFinder {
        constructor(network, options = {}) {
            this.graph = preprocess(network, options);
            this.options = options;
            // if (
            //   Object.keys(this.graph.compactedVertices).filter(function (k) {
            //     return k !== "edgeData";
            //   }).length === 0
            // ) {
            //   throw new Error(
            //     "Compacted graph contains no forks (topology has no intersections)."
            //   );
            // }
        }
        findPath(a, b) {
            const { key = defaultKey, tolerance = 1e-5 } = this.options;
            const start = key(roundCoord(a.geometry.coordinates, tolerance));
            const finish = key(roundCoord(b.geometry.coordinates, tolerance));
            // We can't find a path if start or finish isn't in the
            // set of non-compacted vertices
            if (!this.graph.vertices[start] || !this.graph.vertices[finish]) {
                return undefined;
            }
            const phantomStart = this._createPhantom(start);
            const phantomEnd = this._createPhantom(finish);
            try {
                const pathResult = findPath(this.graph.compactedVertices, start, finish);
                if (pathResult) {
                    const [weight, path] = pathResult;
                    return {
                        path: path
                            .reduce((coordinates, vertexKey, index, vertexKeys) => {
                            if (index > 0) {
                                coordinates = coordinates.concat(this.graph.compactedCoordinates[vertexKeys[index - 1]][vertexKey]);
                            }
                            return coordinates;
                        }, [])
                            .concat([this.graph.sourceCoordinates[finish]]),
                        weight,
                        edgeDatas: "edgeDataReducer" in this.options
                            ? path.reduce((edges, vertexKey, index, vertexKeys) => {
                                if (index > 0) {
                                    edges.push(this.graph.compactedEdges[vertexKeys[index - 1]][vertexKey]);
                                }
                                return edges;
                            }, [])
                            : undefined,
                    };
                }
                else {
                    return undefined;
                }
            }
            finally {
                this._removePhantom(phantomStart);
                this._removePhantom(phantomEnd);
            }
        }
        _createPhantom(n) {
            if (this.graph.compactedVertices[n])
                return undefined;
            const phantom = compactNode(n, this.graph.vertices, this.graph.compactedVertices, this.graph.sourceCoordinates, this.graph.edgeData, true, this.options);
            this.graph.compactedVertices[n] = phantom.edges;
            this.graph.compactedCoordinates[n] = phantom.coordinates;
            if ("edgeDataReducer" in this.options) {
                this.graph.compactedEdges[n] = phantom.reducedEdges;
            }
            Object.keys(phantom.incomingEdges).forEach((neighbor) => {
                this.graph.compactedVertices[neighbor][n] =
                    phantom.incomingEdges[neighbor];
                if (!this.graph.compactedCoordinates[neighbor]) {
                    this.graph.compactedCoordinates[neighbor] = {};
                }
                this.graph.compactedCoordinates[neighbor][n] = [
                    this.graph.sourceCoordinates[neighbor],
                    ...phantom.incomingCoordinates[neighbor].slice(0, -1),
                ];
                if (this.graph.compactedEdges) {
                    if (!this.graph.compactedEdges[neighbor]) {
                        this.graph.compactedEdges[neighbor] = {};
                    }
                    this.graph.compactedEdges[neighbor][n] = phantom.reducedEdges[neighbor];
                }
            });
            return n;
        }
        _removePhantom(n) {
            if (!n)
                return;
            Object.keys(this.graph.compactedVertices[n]).forEach((neighbor) => {
                delete this.graph.compactedVertices[neighbor][n];
            });
            Object.keys(this.graph.compactedCoordinates[n]).forEach((neighbor) => {
                delete this.graph.compactedCoordinates[neighbor][n];
            });
            if ("edgeDataReducer" in this.options) {
                Object.keys(this.graph.compactedEdges[n]).forEach((neighbor) => {
                    delete this.graph.compactedEdges[neighbor][n];
                });
            }
            delete this.graph.compactedVertices[n];
            delete this.graph.compactedCoordinates[n];
            if (this.graph.compactedEdges) {
                delete this.graph.compactedEdges[n];
            }
        }
    }

    return PathFinder;

})));
