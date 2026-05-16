import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { globSync } from 'glob';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import crypto from 'crypto';

// --- AUDIO DEPENDENCIES ---
// We now only use the static binary, no wrapper library
import ffmpegPath from 'ffmpeg-static';

// CORE LIBRARY
import { NodeIO } from '@gltf-transform/core';

// EXTENSIONS & PLUGINS
import {
  KHRDracoMeshCompression,
  EXTTextureWebP
} from '@gltf-transform/extensions';

import {
  textureCompress,
  prune,
  dedup
} from '@gltf-transform/functions';

import draco3d from 'draco3d';
import sharp from 'sharp';

const require = createRequire(import.meta.url);

// --- SETUP EXTERNAL BINARIES ---
let fbx2gltf = require('fbx2gltf');

if (typeof fbx2gltf !== 'string') {
  const platform = os.platform() === 'darwin' ? 'Darwin' :
    os.platform() === 'win32' ? 'Windows' : 'Linux';

  fbx2gltf = path.resolve(
    process.cwd(),
    'node_modules',
    'fbx2gltf',
    'bin',
    platform,
    platform === 'Windows' ? 'fbx2gltf.exe' : 'fbx2gltf'
  );
}

// --- CONFIGURATION ---
const BASE_DIR = './asset-pipeline';

const CONFIG = {
  srcDir: `${BASE_DIR}/src`,
  outDir: `${BASE_DIR}/build`,
  publicDir: `./public/models`,

  obfuscation: {
    enabled: true,
    key: 16.28,
    strength: 0.5,
    frequency: 10.0,
  },

  dracoOptions: {
    method: 'sequential',
    quantizePosition: 20,
    quantizeNormal: 10,
    quantizeTexcoord: 12,
    quantizeColor: 8,
    quantizeGeneric: 12,
  },

  textureOptions: {
    format: 'webp',
    quality: 82,
    size: [2048, 2048]
  },

  audioOptions: {
    extensions: ['.wav', '.mp3', '.ogg', '.flac', '.aiff'],
    opusBitrate: '64k', // Target bitrate for Opus
    mp3Quality: '4',    // LAME VBR Quality (0=best, 9=worst)
  }
};

// --- UTILITIES ---

const sanitizeName = (fileName) => {
  const nameWithoutExt = path.parse(fileName).name;
  return nameWithoutExt.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
};

const convertFbxToGlb = (srcPath, destPath) => {
  return new Promise((resolve, reject) => {
    const args = ['--binary', '--input', srcPath, '--output', destPath];
    execFile(fbx2gltf, args, (error, stdout, stderr) => {
      if (error) {
        console.error(`\n⚠️  FBX Error ${path.basename(srcPath)}:\n`, stderr);
        reject(error);
      } else {
        resolve(destPath);
      }
    });
  });
};

const getTextureStats = (document) => {
  const stats = [];
  document.getRoot().listTextures().forEach((texture, index) => {
    const image = texture.getImage();
    if (image) {
      stats.push({
        name: texture.getName() || `Texture_${index}`,
        mime: texture.getMimeType(),
        size: image.byteLength
      });
    }
  });
  return stats;
};

// --- AUDIO UTILITIES ---

/**
 * 🎵 TRANSCODER (Native FFmpeg)
 * Uses child_process.execFile to run ffmpeg-static directly.
 */
const transcodeAudio = (src, dest, format, options) => {
  return new Promise((resolve, reject) => {

    // Base arguments: Overwrite output (-y), Input file (-i src)
    const args = ['-y', '-i', src];

    if (format === 'webm') {
      // OPUS settings
      args.push(
        '-c:a', 'libopus',
        '-b:a', options.opusBitrate,
        '-f', 'webm' // force format
      );
    } else {
      // MP3 settings
      args.push(
        '-c:a', 'libmp3lame',
        '-q:a', options.mp3Quality,
        '-f', 'mp3' // force format
      );
    }

    // Output file
    args.push(dest);

    // Execute
    execFile(ffmpegPath, args, (error, stdout, stderr) => {
      if (error) {
        // FFmpeg writes progress to stderr, so we only reject if there's an actual Error object
        // checking the error code is safer
        console.error(`FFmpeg Error on ${path.basename(src)}:`, stderr);
        reject(error);
      } else {
        resolve(dest);
      }
    });
  });
};

const encryptBuffer = (buffer, keyString) => {
  const keyBuffer = Buffer.from(keyString);
  const keyLen = keyBuffer.length;

  const outBuffer = Buffer.from(buffer);

  for (let i = 0; i < outBuffer.length; i++) {
    outBuffer[i] = outBuffer[i] ^ keyBuffer[i % keyLen];
  }
  return outBuffer;
};

/**
 * 🔊 AUDIO PIPELINE
 */
const processAudioFiles = async (srcDir, publicDir) => {
  const audioManifest = {};

  const searchPattern = `${srcDir}/**/*+(${CONFIG.audioOptions.extensions.join('|')})`;
  const files = globSync(searchPattern, { windowsPathsNoEscape: true });

  if (files.length === 0) return {};

  console.log(`\n🎵 Found ${files.length} audio files. Processing...`);

  // Create temp directory for transcoding output
  const tempAudioDir = path.join(os.tmpdir(), 'pipeline-audio-temp');
  await fs.ensureDir(tempAudioDir);

  for (const srcPath of files) {
    const relativePath = path.relative(srcDir, srcPath).split(path.sep).join('/');

    // 1. Read buffer for CONTENT hash
    const fileBuffer = await fs.readFile(srcPath);
    const contentHash = crypto.createHash('md5').update(fileBuffer).digest('hex').slice(0, 12);

    // 2. Temp Paths
    const tempOpus = path.join(tempAudioDir, `${contentHash}.webm`);
    const tempMp3 = path.join(tempAudioDir, `${contentHash}.mp3`);

    process.stdout.write(`   Processing ${path.basename(srcPath)} -> [${contentHash}] ... `);

    try {
      // 3. Transcode (WebM + MP3)
      await Promise.all([
        transcodeAudio(srcPath, tempOpus, 'webm', CONFIG.audioOptions),
        transcodeAudio(srcPath, tempMp3, 'mp3', CONFIG.audioOptions)
      ]);

      // 4. Read Transcoded Files
      const opusBuffer = await fs.readFile(tempOpus);
      const mp3Buffer = await fs.readFile(tempMp3);

      // 5. Encrypt (XOR)
      const encryptedOpus = encryptBuffer(opusBuffer, relativePath);
      const encryptedMp3 = encryptBuffer(mp3Buffer, relativePath);

      // 6. Write to Public Dir
      const opusOutName = `${contentHash}.ewv`;
      const mp3OutName = `${contentHash}.ewv.fb`;

      await fs.writeFile(path.join(publicDir, opusOutName), encryptedOpus);
      await fs.writeFile(path.join(publicDir, mp3OutName), encryptedMp3);

      // 7. Cleanup Temp Files
      await fs.unlink(tempOpus);
      await fs.unlink(tempMp3);

      console.log('✅ Done');

      // 8. Add to Manifest
      audioManifest[relativePath] = opusOutName;

    } catch (err) {
      console.log('❌ Failed');
      console.error(`      Error processing audio: ${err.message}`);
    }
  }

  await fs.remove(tempAudioDir);
  return audioManifest;
};

// --- EXISTING GLB PROCESSOR ---

const compressTextures = async (document) => {
  const textures = document.getRoot().listTextures();
  for (const texture of textures) {
    const mime = texture.getMimeType();
    if (mime === 'image/webp') continue;
    const imageBuffer = texture.getImage();
    if (imageBuffer) {
      const name = texture.getName() || 'unnamed';
      try {
        const newBuffer = await sharp(imageBuffer, { failOn: 'none', unlimited: true })
          .resize({
            width: CONFIG.textureOptions.size[0],
            height: CONFIG.textureOptions.size[1],
            fit: 'inside',
            withoutEnlargement: true
          })
          .webp({ quality: CONFIG.textureOptions.quality })
          .toBuffer();
        texture.setImage(newBuffer);
        texture.setMimeType('image/webp');
      } catch (e) {
        console.warn(`      ⚠️ Could not convert texture ${name}: ${e.message}`);
      }
    }
  }
};

const processGlb = async (filePath) => {
  try {
    const io = new NodeIO()
      .registerExtensions([KHRDracoMeshCompression, EXTTextureWebP])
      .registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
      });

    const document = await io.read(filePath);
    const root = document.getRoot();

    // --- 1. OBFUSCATION ---
    if (CONFIG.obfuscation.enabled) {
      const { key, strength, frequency } = CONFIG.obfuscation;
      for (const mesh of root.listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          const positionAccessor = prim.getAttribute('POSITION');
          if (!positionAccessor) continue;
          const count = positionAccessor.getCount();
          for (let i = 0; i < count; i++) {
            let [x, y, z] = positionAccessor.getElement(i, []);
            x = x + Math.sin(y * frequency + key) * strength;
            y = y + Math.cos(x * frequency + key) * strength;
            z = z + Math.sin((x + y) * frequency + key) * strength;
            positionAccessor.setElement(i, [x, y, z]);
          }
        }
      }
    }

    const preStats = getTextureStats(document);
    await compressTextures(document);

    await document.transform(
      dedup(),
      prune()
    );

    const postStats = getTextureStats(document);

    console.log('\n   📦 Texture Compression Report:');
    if (preStats.length === 0) {
      console.log('      No textures found.');
    } else {
      preStats.forEach((pre, i) => {
        const post = postStats[i] || { size: 0, mime: 'deleted' };
        const saved = pre.size - post.size;
        const percent = pre.size > 0 ? ((saved / pre.size) * 100).toFixed(1) : 0;
        console.log(`      - ${pre.name}: ${pre.mime} -> ${post.mime} Saved: ${percent}%`);
      });
    }

    document.createExtension(KHRDracoMeshCompression)
      .setRequired(true)
      .setEncoderOptions({
        method: CONFIG.dracoOptions.method === 'edgebreaker' ? 1 : 0,
        quantizationBits: {
          POSITION: CONFIG.dracoOptions.quantizePosition,
          NORMAL: CONFIG.dracoOptions.quantizeNormal,
          TEX_COORD: CONFIG.dracoOptions.quantizeTexcoord,
          COLOR: CONFIG.dracoOptions.quantizeColor,
          GENERIC: CONFIG.dracoOptions.quantizeGeneric,
        }
      });

    await io.write(filePath, document);
    return true;

  } catch (err) {
    console.error(`Error processing ${filePath}:`, err);
    throw err;
  }
};

const copyBuildAssets = async (srcDir, outDir, audioManifest) => {
  await fs.ensureDir(outDir);

  const assetFiles = globSync(`${srcDir}/**/*.*`, {
    ignore: [`${srcDir}/**/*.fbx`],
    windowsPathsNoEscape: true
  });

  const manifest = { ...audioManifest };

  for (const srcPath of assetFiles) {
    const relativePath = path.relative(srcDir, srcPath).split(path.sep).join('/');
    const fileBuffer = await fs.readFile(srcPath);
    const encryptedBuffer = encryptBuffer(fileBuffer, relativePath);

    const pathHash = crypto.createHash('md5').update(relativePath).digest('hex').slice(0, 12);
    const mangledFileName = `${pathHash}.clt`;

    const outFilePath = path.join(outDir, mangledFileName);
    await fs.writeFile(outFilePath, encryptedBuffer);

    manifest[relativePath] = mangledFileName;
  }

  const jsonString = JSON.stringify(manifest);
  const escapedStringLiteral = JSON.stringify(jsonString);

  console.log('\n// ----------------------------------------------------');
  console.log('// ✂️  COPY BELOW THIS LINE');
  console.log('// ----------------------------------------------------');
  console.log(`export const assets = JSON.parse(${escapedStringLiteral});`);
  console.log('// ----------------------------------------------------');
  console.log('// ✂️  COPY ABOVE THIS LINE');
  console.log('// ----------------------------------------------------');
};

// --- MAIN PIPELINE ---

const run = async () => {
  console.log('🚀 Starting Asset Pipeline...');
  console.log(`🔒 Obfuscation: ${CONFIG.obfuscation.enabled ? 'ENABLED' : 'DISABLED'}`);

  await fs.ensureDir(CONFIG.outDir);
  await fs.emptyDir(CONFIG.outDir);
  await fs.ensureDir(CONFIG.publicDir);
  await fs.emptyDir(CONFIG.publicDir);

  // 1. Process Audio
  const audioManifest = await processAudioFiles(CONFIG.srcDir, CONFIG.publicDir);

  // 2. Process Models
  const files = globSync(`${CONFIG.srcDir}/**/*.fbx`);

  if (files.length > 0) {
    for (const srcPath of files) {
      const relativePath = path.relative(CONFIG.srcDir, srcPath);
      const dirName = path.dirname(relativePath);
      const sanitizedName = sanitizeName(srcPath);
      const outFolderPath = path.join(CONFIG.outDir, dirName);
      const outFilePath = path.join(outFolderPath, `${sanitizedName}.glb`);
      const fbmFolderPath = srcPath.substring(0, srcPath.lastIndexOf('.')) + '.fbm';

      await fs.ensureDir(outFolderPath);

      process.stdout.write(`Processing: ${path.basename(srcPath)} -> ${sanitizedName}.glb ... `);

      try {
        await convertFbxToGlb(srcPath, outFilePath);
        if (await fs.pathExists(fbmFolderPath)) await fs.remove(fbmFolderPath);
        await processGlb(outFilePath);
        console.log('✅ Done');
      } catch (err) {
        console.log('❌ Failed');
        console.error(err);
      }
    }
  } else {
    console.log('No FBX files found (skipping model processing).');
  }

  console.log('✨ Build Complete.');

  // 3. Package and Encrypt 3D Assets (Merge with Audio Manifest)
  await copyBuildAssets(CONFIG.outDir, CONFIG.publicDir, audioManifest);

  console.log('🎉 All assets are ready in the public directory.');
};

run();
