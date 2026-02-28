/**
 * Video processing: extract frames at configurable fps and get duration.
 * Uses ffmpeg (ffmpeg-static) to sample frames with timestamps.
 */

const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

/**
 * Get video duration in seconds.
 * @param {string} videoPath - Path to MP4 file.
 * @returns {Promise<number>} Duration in seconds.
 */
function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .ffprobe((err, metadata) => {
        if (err) return reject(err);
        const duration = metadata.format.duration;
        resolve(typeof duration === 'number' ? duration : parseFloat(duration) || 0);
      });
  });
}

/**
 * Extract frames from video at given fps. Each frame is saved as PNG with a predictable name
 * so we can map frame index to timestamp. Returns list of { framePath, timestampSeconds, frameIndex }.
 * @param {string} videoPath - Path to MP4 file.
 * @param {number} fps - Frames per second (e.g. 1 = one frame per second).
 * @param {string} outDir - Directory to write frame PNGs (created if needed).
 * @returns {Promise<{ durationSeconds: number, frames: Array<{ framePath: string, timestampSeconds: number, frameIndex: number }> }>}
 */
function extractFrames(videoPath, fps, outDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(videoPath)) {
      return reject(new Error(`Video file not found: ${videoPath}`));
    }

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const framePattern = path.join(outDir, 'frame_%04d.png');

    // -vf fps=1 means 1 frame per second; we use fps from param
    // -vsync vfr would be variable; we want fixed interval
    const cmd = ffmpeg(videoPath)
      .outputOptions([
        `-vf fps=${fps}`,
        '-vsync', 'cfr',
      ])
      .output(framePattern)
      .on('start', (cmdLine) => {})
      .on('error', (err) => reject(err))
      .on('end', async () => {
        const duration = await getVideoDuration(videoPath).catch(() => 0);
        const frameFiles = fs.readdirSync(outDir)
          .filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
          .sort();

        const frames = frameFiles.map((name, index) => {
          const framePath = path.join(outDir, name);
          // timestamp = index / fps (e.g. index 0 -> 0s, index 1 -> 1s at 1fps)
          const timestampSeconds = index / fps;
          return {
            framePath,
            timestampSeconds,
            frameIndex: index,
          };
        });

        resolve({
          durationSeconds: duration,
          frames,
        });
      });

    cmd.run();
  });
}

/**
 * Read a file and return base64-encoded string (for sending images to Claude).
 * @param {string} filePath
 * @returns {string} base64
 */
function readFileAsBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.toString('base64');
}

module.exports = {
  getVideoDuration,
  extractFrames,
  readFileAsBase64,
};
