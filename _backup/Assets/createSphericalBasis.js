// construct a spherical basis for the position under the assumption sphere is centered
// at 0, 0, 0.
pc.math.constructSphericalBasis =
(
() => {
    const up = new pc.Vec3();
    const right = new pc.Vec3();
    const forward = new pc.Vec3();
    const m = new pc.Mat4();

    return (position, matrix4 = m) => {
        up.copy(position).normalize();
        right.cross(up, new pc.Vec3(0, 1, 0)).normalize();
        forward.cross(right, up);

        matrix4.data[0] = right.x;
        matrix4.data[1] = right.y;
        matrix4.data[2] = right.z;
        matrix4.data[4] = up.x;
        matrix4.data[5] = up.y;
        matrix4.data[6] = up.z;
        matrix4.data[8] = forward.x;
        matrix4.data[9] = forward.y;
        matrix4.data[10] = forward.z;

        return matrix4;
    };
}
)();