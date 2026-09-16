/**
 * @fileoverview This file contains functions to generate Vega specs for 
 * plots which need to overlay some data over a map. 
 * 
 * The functions will download a static map image covering a given set of 
 * coordinates; this map will be embedded directly to the plot.
 * 
 * Vega is a JS implementation of Grammar of Graphics (which also underlies
 * ggplot2 in R ecosystem). Vega ecosystem is developed at the Interactive Data 
 * Lab (University of Washington). 
 * 
 * Vega Plots are defined as JSON specs, which can be turned into plots at 
 * rendering time. The plots in this file rely on full Vega as opposed to the
 * simplified Vega-lite, as the latter does not provide enough functionality
 * for them. 
 * 
 * @author Anton Malko
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';
import fsp from 'node:fs/promises';
import path from 'path';

// =============================================================================
//  CONSTANTS 
// =============================================================================

/**
 * @typedef {Object} MapProvider
 * @property {string} name - Provider's name (will be used to name cache and 
 *   similar purposes)
 * @property {string} tileUrl - template of the URL for fetching a single tile
 * @property {Object} headers - HTTP headers to pass with tile download request
 * @property {number} tileSize - length of a tile's side in pixels
 * @property {string} [attribution] - Attribution text to add to the map
 *   (optional)
 * @property {string} [attributionUrl] - URL for the attribution string 
 *   (optional; if provided, the attribution text will be clickable)
 */
const MAP_PROVIDERS = {
  // We use OpenStreetMap by default
  osm: {
    name: 'osm',
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    headers: { 'User-Agent': 'ro-crate-plot-tools' },
    tileSize: 256,
    attribution: "Map data from OpenStreetMap", // Attribution text
    attributionUrl: "https://openstreetmap.org/copyright"
  }
};

// Cache life time for cached tiles: 30 days (in milliseconds)
// (OpenStreetMap policy requires to use caching, see
// https://operations.osmfoundation.org/policies/tiles/)
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// =============================================================================
//  HELPER MATH FUNCTIONS 
// =============================================================================
 
/**
 * Convert longitude to tile X coordinate
 * See: {@link https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames}
 * 
 * @param {number} lon - longitude
 * @param {number} zoom - Zoom level, typically from 0 to 20 (see 
 *   {@link https://wiki.openstreetmap.org/wiki/Zoom_levels})
 * @returns {number} - tile X coordinate
 */
function lon2tilePx(lon, zoom) { 
  return ((lon + 180) / 360) * Math.pow(2, zoom); 
}

/**
 * Convert latitude to tile Y coordinate
 * See: {@link https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames}
 * 
 * @param {number} lat - latitude
 * @param {number} zoom - Zoom level
 * @returns {number} - tile Y coordinate
 */
function lat2tilePx(lat, zoom) {
  return ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * Math.pow(2, zoom);
}

/**
 * Calculate best zoom level to cover a given bounding rectangle and produce
 * an image with a given size in pixels
 * 
 * @param {number} minLat - coordinate of the southern boundary of the bounding
 *   rectangle
 * @param {number} maxLat - northern boundary
 * @param {number} minLng - western boundary
 * @param {number} maxLng - eastern boundary
 * @param {number} targetSizePx - length of one side of the target image, in 
 *   pixels (target image will be square)
 * @param {number} tileSize - length of one side of the tiles served by the map
 *   provider, in pixels
 * @returns {number} - chosen zoom level (0-20). 0 is entire world; at 20 
     the map would be able to show individual buildings, which is more than 
     enough for our purposes. 
     (See {@link https://wiki.openstreetmap.org/wiki/Zoom_levels})
 */
function getBestZoom(minLat, maxLat, minLng, maxLng, targetSizePx, tileSize) { 
  // Get best level of horizontal zoom
  const lngDiff = maxLng - minLng;
  const zoomX = Math.log2((targetSizePx * 360) / (lngDiff * tileSize));
 
  // Get best level of vertical zoom
  const minLatRad = (minLat * Math.PI) / 180;
  const maxLatRad = (maxLat * Math.PI) / 180;
  const latDiffProjected = Math.abs(Math.log(Math.tan(Math.PI / 4 + maxLatRad / 2)) - Math.log(Math.tan(Math.PI / 4 + minLatRad / 2)));
  const zoomY = Math.log2((targetSizePx * (2 * Math.PI)) / (latDiffProjected * tileSize));
 
  // Pick the smallest, so that the entire bounding rectangle fits in the 
  // target image; limit zoom value between 0 and 20. 
  return Math.max(0, Math.min(20, Math.floor(Math.min(zoomX, zoomY))));
}
 
// =============================================================================
//  MAP DOWNLOAD FUNCTIONS 
// =============================================================================

/**
 * Fetch a map tile from a remote server or local cache
 *
 * @param {string} url - The URL to fetch the tile from.
 * @param {Object} [headers={}] - Optional HTTP headers for the network request.
 * @param {string} [providerName='default'] - The subfolder name for caching 
 *   this provider's tiles.
 * @param {number|string} z - The zoom level of the tile.
 * @param {number|string} x - The X coordinate of the tile.
 * @param {number|string} y - The Y coordinate of the tile.
 * @returns {Promise<Object|null>} A promise that resolves to the loaded image 
 *   object, or null on failure.
 */
async function fetchTile(url, headers = {}, providerName = 'default', z, x, y) {
  const cacheDir = path.join('./tile_cache', providerName, String(z), String(x));
  const cachePath = path.join(cacheDir, `${y}.png`);

  let cachedBuffer = null;

  // Try to read the cache and check its freshness
  try {
    // Time since file was last modified
    const stats = await fsp.stat(cachePath);
    const fileAgeMs = Date.now() - stats.mtimeMs;

    // Read the cache
    cachedBuffer = await fsp.readFile(cachePath);
    
    // If the cache is fresh, return it
    if (fileAgeMs < CACHE_TTL_MS) {
      console.log(`Tile ${z}/${x}/${y} taken from local cache...`);
      return await loadImage(cachedBuffer);
    }
  } catch {
    // Cache check failed; proceed to download silently
  }

  // If cache is missing or expired, download a fresh tile
  try {
    if (cachedBuffer) {
      console.log(`Tile cache expired for ${z}/${x}/${y}. Re-downloading...`);
    }

    const response = await fetch(url, { headers });
    // If the download failed, go to 'catch' block
    if (!response.ok) throw new Error(`HTTP ${response.status}`); 
    
    // Get the downloaded tile
    const buffer = Buffer.from(await response.arrayBuffer());

    // Write it to cache
    await fsp.mkdir(cacheDir, { recursive: true });
    await fsp.writeFile(cachePath, buffer);

    return await loadImage(buffer);
  } catch (err) {
    console.error(`Download error: ${err.message}`);
    
    // If download has failed, but we have old cache -- use it
    if (cachedBuffer) {
      console.warn(`Serving expired cache as fallback for ${z}/${x}/${y}`);
      return await loadImage(cachedBuffer);
    }
    
    // If both network and cache are unavailable
    return null;
  }
}


/**
 * Downloads a raw grid of map tiles and stitches them together into a single 
 * canvas. Fills missing or failed tiles with a neutral grey fallback color.
 * 
 * @async
 * @param {Object} params - The grid parameters.
 * @param {number} params.startX - Starting tile X index in the Web Mercator 
 *   grid
 * @param {number} params.endX - Ending tile X index
 * @param {number} params.startY - Starting tile Y index
 * @param {number} params.endY - Ending tile Y index 
 * @param {number} params.zoom - Current map zoom level
 * @param {MapProvider} params.provider - The map provider configuration
 * @returns {Promise<Canvas>} A Promise that resolves to a Canvas object 
 *   containing the full stitched grid.
 */
async function stitchTileGrid(startX, endX, startY, endY, zoom, provider) {
  const TILE_SIZE = provider.tileSize || 256;
  const tileWidthCount = endX - startX + 1;
  const tileHeightCount = endY - startY + 1;

  // Crate temp canvas for the entire set of tiles
  const gridCanvas = createCanvas(tileWidthCount * TILE_SIZE, 
                                  tileHeightCount * TILE_SIZE);
  const gridCtx = gridCanvas.getContext('2d');

  console.log(`Downloading tiles grid ${tileWidthCount}x${tileHeightCount}...`);

  // Iterate over the tiles and try downloading them
  for (let x = startX; x <= endX; x++) {
    for (let y = startY; y <= endY; y++) {
      const tileUrl = provider.tileUrl
        .replace('{z}', zoom)
        .replace('{x}', x)
        .replace('{y}', y);

      const posX = (x - startX) * TILE_SIZE;
      const posY = (y - startY) * TILE_SIZE;

      try {
        const providerName = provider.name || 'default';
        const img = await fetchTile(tileUrl, provider.headers, providerName, 
                                    zoom, x, y);
        
        // Draw tile into canvas; if download failed -- draw a grey rectangle
        if (img) {
          gridCtx.drawImage(img, posX, posY);
        } else {
          gridCtx.fillStyle = '#e0e0e0';
          gridCtx.fillRect(posX, posY, TILE_SIZE, TILE_SIZE);
        }
      } catch (err) {
        console.error(`Error on tile ${x},${y}:`, err.message);
        gridCtx.fillStyle = '#e0e0e0';
        gridCtx.fillRect(posX, posY, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  return gridCanvas;
}


/**
 * Construct the skeleton for a map plot
 * 
 * This function does all the heavy lifting -- downloading and embedding the 
 * map, adjusting the data for plotting, and creating most of the Vega spec.
 * The user-facing functions which wrap it are only responsible for setting
 * how to plot the data -- as points, as a contour map etc.
 * 
 * When downloading the map, the function first stitches together map tiles
 * which completely enclose the data, and then cuts out an image of the 
 * specified size (e.g., 300x300 pixels), centered on the data.
 * 
 * @param {Array} data - an Array of Objects corresponding to data points to
 *   plot. Each Object is assumed to have at least two entries: "lat" and "lon"
 *   for the point coordinates. An optional third entry can be "weight" -- it 
 *   can be used to increase a point's importance, or to represent the result
 *   of aggregation in the original data (indicating the number of points 
 *   which have the exact same coordinates)
 * @param {number}[zoom] - Zoom level of the base map (optional). Typical
 *   values range from 0 (entire world) to 20 (individual buildings). If 
 *   omitted, the function will try to estimate the largest zoom which allows
 *   to show all coordinates in the image of given size (as specified by
 *   `targetSizePx`)
 * @param {MapProvider} provider - map provider configuration. 
 * @param {number} targetSizePx - length of one side of the target image, in 
 *   pixels (target image will be square)
 * @returns {Object} Vega specification for the plot 
 *   ({@link https://vega.github.io/vega/})
 */
async function makeMapPlotSkeleton(
  { data, zoom, provider = MAP_PROVIDERS.osm, targetSizePx = 300,
    title, subtitle } = {}
){
  
  // Ensure tile size is defined
  const TILE_SIZE = provider.tileSize || 256;

  // Get coordinates for the bounding rectangle
  const lats = data.map(p => p.lat);
  const lngs = data.map(p => p.lon);
  const minLat = Math.min(...lats); 
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs); 
  const maxLng = Math.max(...lngs);

  // Guess best zoom level if it was not provided
  if (zoom === undefined) {
    zoom = getBestZoom(minLat, maxLat, minLng, maxLng, targetSizePx, TILE_SIZE);
  }
  
  // Get bounding coordinates in terms of tile indices. Numbers can be 
  // fractional -- e.g., the X coordinate 100.25 means the the point lies 
  // within the tile with the X index = 100
  const minX = lon2tilePx(minLng, zoom);
  const maxX = lon2tilePx(maxLng, zoom);
  // Note that minY comes from maxLat, and maxY comes from minLat. This is 
  // because highest latitude (North) corresponds to *smallest* pixel 
  // coordinates (where (0,0) is the top left corner of the screen)
  const minY = lat2tilePx(maxLat, zoom); 
  const maxY = lat2tilePx(minLat, zoom);

  // Calculate coordinate of the center point (half-way along the X axis, and
  // half-way along the Y axis)
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // Find indices of tiles we want to download

  // First, how many tiles are needed to cover the target size of the image? 
  // (targetSizePx / TILE_SIZE). This can be fractional: tiles are always a 
  // fixed size, but target image size can vary. Then, divide this number by 2 
  // to get how many tiles we need to use *counting from the center coordinate*
  const halfTileSpan = targetSizePx / TILE_SIZE / 2;

  // Get indices of the tiles which completely cover the bounding rectangle (
  // most likely, exceeding its dimensions). E.g., for startTileX we get a 
  // fractional tile coordinate corresponding to the left edge of the image 
  // (counting from the bounding rectangle center), and round it down to 
  // get the X index of the tile containing that point.
  const startTileX = Math.floor(centerX - halfTileSpan);
  const endTileX = Math.ceil(centerX + halfTileSpan);
  const startTileY = Math.floor(centerY - halfTileSpan);
  const endTileY = Math.ceil(centerY + halfTileSpan);

  // Calculate crop parameters 
  // 
  // Logic for the X axis:
  // 1. First, what is the distance between the canvas left edge and the center
  //   of the target area, *in tile units*? 
  //      (centerX - startTileX)
  // 2. Now, what is it in pixels?
  //      (centerX - startTileX) * TILE_SIZE
  // 3. Finally, by how many pixels do we need to move to the right, in order to 
  //   reach the left edge of the targer area? Subtract half the width of the 
  //   target area to get that. 
  //      (centerX - startTileX) * TILE_SIZE - targetSizePx / 2
  const cropOffsetX = (centerX - startTileX) * TILE_SIZE - targetSizePx / 2;
  const cropOffsetY = (centerY - startTileY) * TILE_SIZE - targetSizePx / 2;

  // Create the overall map canvas
  const rawGridCanvas = await stitchTileGrid(
    startTileX, endTileX, startTileY, endTileY, zoom, provider
  );

  // Cut out the target area of the requested size
  const finalCanvas = createCanvas(targetSizePx, targetSizePx);
  const finalCtx = finalCanvas.getContext('2d');

  finalCtx.drawImage(
    rawGridCanvas, 
    // Cut coordinates in the source canvas
    cropOffsetX, cropOffsetY, targetSizePx, targetSizePx, 
    // Paste coordinates in the target canvas
    0, 0, targetSizePx, targetSizePx          
  );

  // Encode the map layer into Base64, so that it can be embedded directly into
  // the Vega spec
  const mapBuffer = finalCanvas.toBuffer('image/png');
  const mapLayerVega = `data:image/png;base64,${mapBuffer.toString('base64')}`;

  // Adjust each point coordinates (lan, lon) to the map layer coordinates (x,y)
  const mapPoints = data.map(point => {
  
    // For each point, get the coordinates in terms of tile units (e.g., 10.1
    // on the X axis would mean that the point lies at 10% of the tile width 
    // from the left edge of tile 10)
    const tX = lon2tilePx(point.lon, zoom);
    const tY = lat2tilePx(point.lat, zoom);

    // Convert points to pixel coordinates in the cropped area
    //  
    // Logic for X axis
    // 1. First, what is the distance between the overall canvas left edge and 
    //    the point *in tile units*? 
    //      (tX - startTileX)
    // 2. Now, what is it in pixels?
    //      (tX - startTileX) * TILE_SIZE
    // 3. Finally, by how many pixels do we need to move to the right, so that 
    //    zero corresponds to the left edge of the cropped area? (Remember that
    //    cropOffsetX is the distance between the left edge of the overall 
    //    canvas and the left edge of the cropped area)
    //      (tX - startTileX) * TILE_SIZE - cropStartX
    const x = (tX - startTileX) * TILE_SIZE - cropOffsetX;
    const y = (tY - startTileY) * TILE_SIZE - cropOffsetY;

    return {
      x: parseFloat(x.toFixed(2)), 
      y: parseFloat(y.toFixed(2)), 
      // If weights are not explicitly specified, each point gets a weight of 1
      weight: point.weight || 1 
    };
  });

  // Make Vega spec
  const attributionFontSize = 9; // Font size of the attribution text

  let vegaSpec = {
    $schema: "https://vega.github.io/schema/vega/v6.json",
    padding: 0,
    width: targetSizePx,
    height: targetSizePx,
    title: {
      title: title,
      subtitle: subtitle
    },
    autosize: {type: "fit", contains: "padding"},
    // Example of binding user input; not used currently
    // signals: [
    //   { name: "bandwidth", value: 15, 
    //     bind: {input: "range", min: 5, max: 80, step: 1, name: "KDE bandwidth:"}  
    //   },
    //   { name: "opacity", value: 0.4, 
    //     bind: {input: "range", min: 0.1, max: 0.9, step: 0.05, name: "Opacity:"} 
    //   }
    // ],
    data: [
      { name: "mapPoints", values: mapPoints }
    ],
    scales: [
      { name: "x", 
        type: "linear", 
        domain: [0, targetSizePx], 
        range: [0, targetSizePx] 
      },
      { name: "y", 
        type: "linear", 
        domain: [0, targetSizePx], 
        range: [0, targetSizePx] 
      }
    ],
    marks: [
      // Base map layer
      {
        type: "image",
        encode: {
          enter: {
            url: {value: mapLayerVega},
            x: {value: 0}, y: {value: 0},
            width: {value: targetSizePx},
            height: {value: targetSizePx}
          }
        }
      }
    ]
  };

  // If the map provider info has attribution string, add it to the plot 
  // (e.g., OpenStreetMap requires to add such an attribution)
  if (provider.attribution) {
    const attributionBar = [
      // Attribution text itself
      {
        name: "attribTextLayer",
        type: "text",
        format: "markdown",
        zindex: 1,
        encode: {
          enter: {
            x: {signal: "width - 2"},
            y: {signal: "height - 2"},
            text: {value: provider.attribution},
            href: {value: provider.attributionUrl || null},
            font: {value: "sans-serif"},
            fontSize: {value: attributionFontSize}, 
            fill: {value: provider.attributionUrl ? "mediumblue" : "#333333"}, 
            cursor: {value: provider.attributionUrl ? "pointer" : null}, 
            align: {value: "right"},
            baseline: {value: "bottom"}
          }
        }
      },
      // White background for the attribution text
      {
        type: "rect",
        from: {"data": "attribTextLayer"},
        encode: {
          enter: {
            fill: {value: "#ffffff"},
            fillOpacity: {value: 0.6}
          },
          update: {
            // See https://github.com/vega/vega/issues/3418 for the source
            // of this example: binding a rectangle to coordinates of another
            // layer (in this case, attribution text)
              x: {"field": "bounds.x1", "offset": -2},
              x2: {"field": "bounds.x2", "offset": 2},
              y: {"field": "bounds.y1", "offset": -2},
              y2: {"field": "bounds.y2", "offset": 2},
          }
        }
      }
    ]
    
    // Update marks array in the Vega spec -- add each subcomponent of the
    // attribution bar separately (instead of adding both as a list), as 
    // required by the spec format
    vegaSpec.marks.push(...attributionBar)
  };

  return vegaSpec;
}

/**
 * Create a heatmap of given points. Each data point
 * @param {Object} params - Function parameters
 * @param {Array.<Object>} params.data - Set of coordinates to plot. An Array of 
 *   Objects with at least two entries: "lat" and "lon" for the point 
 *   coordinates. An optional third entry can be "weight", to represent point
 *   importance or result of aggregation. See {@link makeMapPlotSkeleton}
 * @param {number|Array.<number>} [params.bandwidth=-1] - Bandwidth for the 
 *   kernel density estimation. Can be a number or a one element Array
 *   specifying the same bandwidth along the X and Y axis, or a two element 
 *   array with separate bandwidths. Negative numbers will make Vega to choose 
 *   a value internally.
 *   See: {@link https://vega.github.io/vega/docs/transforms/kde2d/}
 * @param {number} [params.nContours=10] - Number of distinct "bands" in the 
 *   heatmap. The larger the number, the more fine-grained is the heatmap. 
 *   Corresponds to "levels" in the Vega Isocontour transform:
 *   {@link https://vega.github.io/vega/docs/transforms/isocontour/}
 * @param {number} [params.opacity=0.5] - Opacity of the heatmap, from 0 (fully 
 *   transparent) to 1 (fully opaque): 
 * @param {string} [params.palette="turbo"] - Name of the palette to use. 
 *   Accepts names for built-in Vega palettes, see: 
 *   {@link https://vega.github.io/vega/docs/schemes/}
 * @param {string} [params.title] - Plot title
 * @param {string} [params.subtitle] - Plot subtitle
 * @param {number}[zoom] - Zoom level of the base map (optional). Typical
 *   values range from 0 (entire world) to 20 (individual buildings). If 
 *   omitted, the function will try to estimate the largest zoom which allows
 *   to show all coordinates in the image of given size (as specified by
 *   `targetSizePx`)
 * @param {MapProvider} [provider] - map provider configuration. 
 * @param {number} [targetSizePx=300] - length of one side of the target image,
 *   in pixels (target image will be square)
 * @returns {Object} Modified spec with an added variable
 */
export async function plotMapHeatmap(
  { data, 
    bandwidth = -1, nContours = 10,
    opacity = 0.5, palette = "turbo", 
    title, subtitle, 
    zoom, provider = MAP_PROVIDERS.osm, targetSizePx = 300} = {}
){
  let spec = await makeMapPlotSkeleton({
          data: data,
          title: title, 
          subtitle: subtitle, 
          zoom: zoom,
          provider: provider,
          targetSizePx: targetSizePx
      })

  // Ensure that bandwidth is an array, even if a number was passed in
  bandwidth = [].concat(bandwidth);

  // Add derived datasets, computing 2d kernel density estimate, and
  // corresponding contours
  spec.data.push(
    ...[
    {
      name: "density",
      source: "mapPoints",
      transform: [{
        type: "kde2d", 
        x: "x", 
        y: "y", 
        weight: "weight",
        size: [targetSizePx, targetSizePx],
        bandwidth: [bandwidth, bandwidth]
      }]
    },
    {
      name: "contours",
      source: "density",
      transform: [
        {
          type: "isocontour",
          field: "grid",
          levels: nContours
        }
      ]
    }
  ]
  );

  // Add specification of paletter for the contours
  spec.scales.push(
    { 
      name: "color", 
      type: "linear", 
      domain: {
        "data": "contours", "field": "contour.value"
      }, 
      range: {
        scheme: palette
      } 
    }
  );

  // Add plot layer with contours
  spec.marks.push(
    {
      type: "path",
      clip: true,
      from: {data: "contours"},
      encode: {
        enter: {
          fill: {scale: "color", field: "contour.value"},
          fillOpacity: {"value": opacity}
        }
      },
      transform: [
        { type: "geopath", field: "datum.contour" }
      ]
    }
  );

  return(spec);
}