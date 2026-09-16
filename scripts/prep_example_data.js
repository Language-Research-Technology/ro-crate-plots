#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ROCrate } from 'ro-crate';
import { extractTables } from 'roctable/lib/extract.js';
import { tablesToCsvStrings, writeCsvFiles } from 'roctable/lib/csv.js';

function readLocalJson(filePath) {
  try {
    const rawData = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(rawData);
  } catch (error) {
    console.error("Error reading local JSON file:", error);
  }
}

// Set paths ====
const repoRoot = path.join(import.meta.dirname, "..");
const examplesDir = path.join(repoRoot, "examples");
const dataDir = path.join(examplesDir, "data");
const configDir = path.join(examplesDir, "config");
fs.mkdirSync(dataDir, {recursive : true});

const dataFile = path.join(dataDir, "ro-crate-metadata.json");
const roctableConfigFile = path.join(configDir, "roctable-config.json");

// Download Sydney Speaks metadata ====
const url =
  "https://data.ldaca.edu.au/api/object/meta?resolve-parts&noUrid&id=arcp%3A%2F%2Fname%2Chdl10.25911~m03c-yz22";

if (!fs.existsSync(dataFile)) {
  console.log(`Downloading Sydney Speaks metadata from: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  };
  fs.writeFileSync(dataFile, JSON.stringify(await response.json(), null, 2), 'utf-8');
  console.log("Downloaded Sydney Speaks metadata");
} else {
  console.log(`Sydney Speaks ro-crate already exists at: ${dataFile}`)
}

console.log("Extracting tables from the ro-crate");
// Load the RO-Crate
const rawData = readLocalJson(dataFile);
const crate = new ROCrate(rawData, {array: true, link: true});

// Read roctable config
const roctableConfig = JSON.parse(fs.readFileSync(roctableConfigFile, 'utf8'));

// Extract tables from the crate
const tables = await extractTables(crate, roctableConfig, {
  crateDir: dataDir
});
const csvStrings = tablesToCsvStrings(tables);
const files = writeCsvFiles(csvStrings, dataDir, 'ro-crate');
console.log("Done extracting tables");


