import assetsString from './temp.secure.json?raw';

const assets = JSON.parse(assetsString);

export default {
    train1: assets,
}

export const protectedAssetLookup = JSON.parse("{\"train/NS-SGM/ns-sgmm3-bk2.glb\":\"39b0d1cdd747.bin\",\"train/NS-SGM/ns-sgmm3-bk1.glb\":\"0c60cdca95c9.bin\",\"train/NS-SGM/ns-sgmm3-ab.glb\":\"b1a564823b8b.bin\",\"train/APT/apt-wip.glb\":\"1a446d6f930f.bin\",\"train/APT/apt-std-carriage.glb\":\"419d3af46833.bin\"}");