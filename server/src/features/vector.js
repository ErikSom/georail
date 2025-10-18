export class Vec3 {
	constructor(x, y, z) {
		this.x = x;
		this.y = y;
		this.z = z;
	}
	set(x, y, z) {
		this.x = x;
		this.y = y;
		this.z = z;
		return this;
	}
	sub2(a, b) {
		this.x = a.x - b.x;
		this.y = a.y - b.y;
		this.z = a.z - b.z;
		return this;
	}
	copy(v) {
		this.x = v.x;
		this.y = v.y;
		this.z = v.z;
		return this;
	}
}
