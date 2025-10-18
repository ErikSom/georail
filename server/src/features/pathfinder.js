import geojsonPathFinder from "geojson-path-finder";

import { Vec3 } from "./vector";

export class NodePathFinder {
	constructor(jsonData) {
		this.v1 = new Vec3();
		this.railData = jsonData;

		this.pathFinder = new geojsonPathFinder(this.railData);
		this.coordinateToNodeDataMap = this.createCoordinateToNodeDataMap(this.railData.features);

		this.nodes = this.railData.features.filter(feat => feat.properties['@id'].startsWith('node'));
		this.lines = this.railData.features.filter(feat => feat.geometry?.type === "LineString");
		this.nameStopLookup = {};

		this.nodes.forEach(node => {
			if (node.properties?.public_transport === "stop_position" && node.properties?.ref) {
				const { name, ref } = node.properties;

				if (!Array.isArray(this.nameStopLookup[name])) {
					this.nameStopLookup[name] = [];
				}
				const index = parseInt(ref) - 1;
				this.nameStopLookup[name][index] = node;
			}
		});
	}
	createCoordinateToNodeDataMap = function (originalFeatures) {
		const coordinateMap = {};

		originalFeatures.forEach((feature) => {
			if (feature.geometry.type === "LineString") {
				feature.geometry.coordinates.forEach((coord, index) => {
					const key = this.coordKey(coord);
					coordinateMap[key] = feature.properties;
					feature.properties._arrayIndex = index;
				});
			}
		});

		return coordinateMap;
	}

	setupQuadTree = function () {
		const xGet = d => d.x;
		const yGet = d => d.y;
		const zGet = d => d.z;

		const quadNodes = [];

		this.lines.forEach(line => {
			for (let i = 0; i < line.geometry.coordinates.length; i++) {
				const coord = line.geometry.coordinates[i];
				const localPosition = this.getPositionFromCoordinate(coord[0], coord[1]);

				const node = new pc.Vec3().copy(localPosition);
				node.originalData = line;

				quadNodes.push(node);
			}
		});


		this.quadTree = d3.octree(quadNodes, xGet, yGet, zGet);
	}

	queryQuadTree = function (position, radius) {
		const xmin = position.x - radius;
		const xmax = position.x + radius;
		const ymin = position.y - radius;
		const ymax = position.y + radius;
		const zmin = position.z - radius;
		const zmax = position.z + radius;

		const results = [];
		this.quadTree.visit(function (node, x1, y1, z1, x2, y2, z2) {
			if (!node.length) {
				do {
					const d = node.data;
					if (d.x >= xmin && d.x < xmax && d.y >= ymin && d.y < ymax && d.z >= zmin && d.z < zmax) {
						results.push(d);
					}
				} while (node = node.next);
			}
			return x1 >= xmax || y1 >= ymax || z1 >= zmax || x2 < xmin || y2 < ymin || z2 < zmin;
		});
		return results;
	}


	queryNearbyLineCoords = function (refNode, distance) {
		const refCoord = this.getCoordFromNode(refNode);
		const refPosition = this.getPositionFromCoordinate(refCoord.x, refCoord.y).clone();

		const linesInRange = [];

		this.lines.forEach(line => {
			for (let i = 0; i < line.geometry.coordinates.length; i++) {
				const coord = line.geometry.coordinates[i];

				const localPosition = this.getPositionFromCoordinate(coord[0], coord[1]);

				const dis = this.v1.sub2(refPosition, localPosition);

				const length = dis.length();

				if (length < distance) {
					linesInRange.push(line);
					break;
				}
			}
		});

		return linesInRange;
	}

	coordKey = function (coord, tolerance = 1e-5) {
		return `${Math.round(coord[0] / tolerance) * tolerance},${Math.round(coord[1] / tolerance) * tolerance}`;
	}

	getStationNode = function (name, track) {
		if (Array.isArray(this.nameStopLookup[name])) {
			const trackIndex = track - 1;
			return this.nameStopLookup[name][trackIndex];
		}
		return null;
	}

	findPath = function (a, b) {
		return this.pathFinder.findPath(a, b);
	}

	getCoordFromNode = function (node) {
		if (node._pcCoord) {
			return node._pcCoord;
		}
		const coord = node.geometry.coordinates;
		node._pcCoord = new pc.Vec2(coord[0], coord[1]);
		return node._pcCoord;
	}

	getPositionFromCoordinate = function (lon, lat, alt = 300) {
		const [x, y, z] = earthatile.geodeticToCartesian(lon, lat, alt);
		return this.v1.set(x, z, -y);
	}

	getDataForCoord = function (coord) {
		const key = this.coordKey(coord)
		return this.coordinateToNodeDataMap[key];
	}

	getFloorPositionFromNode = function (node) {
		if (node._pcFloorPosition) {
			return node._pcFloorPosition;
		}

		node._pcFloorPosition = new pc.Vec3();
		const coord = this.getCoordFromNode(node);
		const floorPosition = pc.geolocation.getFloorPosition(coord.x, coord.y);
		node._pcFloorPosition.copy(floorPosition);
		return node._pcFloorPosition;
	}

}
