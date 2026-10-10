/**
 * Problem: 10,000 Images Sequential = 8 Hours
 *
 * .map() fans out all images in parallel. Each gets retries.
 * Finishes in minutes, not hours.
 *
 * Run: node image_processing.js
 */

const { node, graph, deploy } = require("graphingest");

const resizeImage = node({ name: "resize-image", maxRetries: 3 }, async (image) => ({
  id: image.id,
  thumb: `https://cdn.example.com/${image.id}_thumb.webp`,
  large: `https://cdn.example.com/${image.id}_large.webp`,
}));

const optimizeForWeb = node({ name: "optimize", maxRetries: 2 }, async (image) => ({
  ...image, optimized: true, savingsPercent: 42,
}));

const imagePipeline = graph({
  name: "image-pipeline",
  retryPolicy: { maxRetries: 2, delayMs: 1000 },
  timeoutMs: 3_600_000,
}, async (images) => {
  const resized = await resizeImage.map(images);
  const optimized = await optimizeForWeb.map(resized);
  return { totalProcessed: optimized.length };
});

async function main() {
  await deploy();

  const images = Array.from({ length: 100 }, (_, i) => ({
    id: `product-${i}`,
    url: `https://uploads.example.com/${i}.jpg`,
  }));

  const result = await imagePipeline(images);
  console.log(`Processed ${result.totalProcessed} images`);
}

main();
