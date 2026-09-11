
import fs, { readFileSync } from "fs";
import path from 'path';
import { parse } from 'csv-parse';
import { ROCrate } from "ro-crate";
import * as plotFuns from './allplots.js';
import nunjucks from 'nunjucks';

// https://www.digitalocean.com/community/tutorials/how-to-read-and-write-csv-files-in-node-js-using-node-csv
async function readCSV(inputFile) {
  const parser = fs
    .createReadStream(inputFile)
    .pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true
      })
    );

  let out = [];

  try {
    for await (const row of parser) {
      // Process each row as it arrives, preventing memory accumulation
        out.push(row)
    }
  } catch (error) {
    console.error("Error:", error.message);
    throw error;
  } 
  
  return (out);
}

function validateTabularJson(json) {
    // Check that we have an array
    if (!Array.isArray(json)) {
      throw new Error('Top-level JSON structure is not an array');
    }

    // Handle an empty table (technically a valid 0-row table)
    if (json.length === 0) {
      throw new Error('Dataset is empty');
    }

    // Extract the baseline column headers from the very first row
    const firstRow = json[0];
    if (typeof firstRow !== 'object' || firstRow === null || Array.isArray(firstRow)) {
      return("Row at index 1 is not a JS object; not checking further rows");
    }
    
    // Validate every subsequent row against the baseline columns
    for (const [index, curRow] of json.entries()) {

      // Ensure the row is an object
      if (typeof curRow !== 'object' || curRow === null || Array.isArray(curRow)) {
        report.push(`Row at index ${index} is not a JS object`); 
        // Not returning in this particular case, so that we can report multiple
        // rows which are not objects
        continue;
      }

      const keysMatch = firstRow.length === curRow.length && firstRow.every(key => curRow.hasOwnProperty(key));
      if (!keys.match) {
        report.push(`The set of columns is not identical across rows. First problematic row is at index ${index}; not checking further rows`);
        return(report);
      }
    }

    return(report);
}

// TODO: add validation etc.
/**
 * Validates that a JSON structure represents a clean, uniform table.
 * @param {string} inputFile - Path to the JSON file
 * @returns {Promise<boolean>} - True if valid tabular data, false otherwise
 */
function readTabularJSON(inputFile) {
    const rawData = readFileSync(inputFile, 'utf-8');
    const parsedData = JSON.parse(rawData);

    return(parsedData);
}

async function readPlotDatasets(plotsConfig, configDir) {
    const datasetList = plotsConfig.plots.datasets || {};
    const output = {};

    for (const [datasetName, value] of Object.entries(datasetList)) {
        const curPath = path.resolve(configDir, value);
        // TODO: add the case where the dataset is an roctable config
        const extension = path.extname(curPath).toLowerCase();

        try {
            if (extension === ".csv") {
                output[datasetName] = await readCSV(curPath);
            } else if (extension === ".json") {
                output[datasetName] = readTabularJSON(curPath);
            } else {
                console.warn(`Dataset ${datasetName}: failed to process -- unsupported extension ${extension} (only CSV and JSON files are supported)`);
                continue;
            }
        } catch (error) {
            console.warn(`Dataset ${datasetName}: failed to process file at ${curPath}, with error: ${error.message}`);
            continue;
        }
    }

    return(output);
}

async function generatePlotSpecs(plotsConfig, datasets) {

    const updatedConfig = structuredClone(plotsConfig);
    const plotList = updatedConfig.plotList;

    for (const [index, plot] of plotList.entries()) {
        // If a custom spec is provided in the config, don't do anything --
        // we'll just use it in rendering
        if (plot.customSpec && Object.keys(plot.customSpec).length !== 0) { 
            console.log(`Plot ${index+1}: Custom spec provided, automated spec not generated`);
            continue;
        } else {
            // Otherwise, try to generate the spec from the config info
            let plotFun = plot.makeSpec?.plotFunction;
            let args = plot.makeSpec?.args;

            // --- Check inputs --- 
            // If there are any issues, skip this plot generation

            // No plotting function provided
            if (plotFun === undefined) {
                console.warn(`Plot ${index+1}: No plotting function provided, spec not generated`);
                continue;
            };

            // Plotting function with specified name does not exist
            if (typeof plotFuns[plotFun] !== 'function') {
                console.warn(`Plot ${index+1}: Plotting function ${plotFun} not found, spec not generated`);
                continue;
            };

            // No function args provided (all plotting functions expect some args)  
            if (args === undefined | args === {}) {
                console.warn(`Plot ${index+1}: No arguments for plotting function provided, skipping spec generation`);
                continue;
            };

            // --- Process datasets ---
            const mustEmbedFuns = ["plotMapHeatmap"]

            if (mustEmbedFuns.includes(plotFun)) {
              plot.dataset.embed = true;
            } 
            
            if (plot.dataset.embed) {
              if (plot.dataset.values === undefined | plot.dataset.values === []) {
                args.data = datasets[plot.dataset.name]
              }
            } else {
              args.data = plot.dataset.name;
            }
            
            // --- Try to generate the plot spec ---
            try {
                plot.generatedSpec = await plotFuns[plotFun](args);
                console.log(`Plot ${index+1}: Spec generated`)
            } catch (error) {
                console.warn(`Plot ${index+1}: Spec generation failed with error: ${error.message}`);
                plot.generatedSpec = {};
            };
        };
    }

    return(updatedConfig)
}

export async function renderTemplate({configFile, templateFile, 
                                outputHTML = 'dashboard.html',
                                saveUpdatedPlotConfig = true} = {}) {
    
    const config = JSON.parse(fs.readFileSync(configFile, "utf8")); 
    // Determine config dir to resolve paths to datasets
    const configDir = path.dirname(configFile);

    // The function will just return an empty object if datasets are not 
    // specified in the config
    const datasets = await readPlotDatasets(config, configDir);

    // Generate plot specs
    if (!Object.hasOwn(config, 'plots')) {
        throw new Error("Plot config does not have 'plots' section");
    };
 
    // Save generated specs in the config, in case we want to write them out
    config.plots = await generatePlotSpecs(config.plots, datasets);

    // Prepare datasets
    if (!Object.hasOwn(config.plots, 'datasets')) {
        console.warn("Plot config does not have 'datasets' section");
    };

    // Prepare things for embedding in the template
    const context = {
        datasets: datasets, 
        plots: config.plots
    };

    // Render template into HTML
    const finalHtml = nunjucks.render(templateFile, context);
    
    // Write to disk
    fs.writeFileSync(outputHTML, finalHtml, 'utf8');

    // If requested, update the condfig file with generated plot specs
    if (saveUpdatedPlotConfig) {
        fs.writeFileSync(configFile, 
                         JSON.stringify(config, null, 2), 
                         "utf8");
    };
};


