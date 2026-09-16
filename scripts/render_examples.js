import { renderTemplate } from '../index.js';
debugger;

const configFile = "./examples/config/plots-config.json";
const templateFile = "./template.html";
const outputFile = "./examples/example_dashboard.html";

renderTemplate({configFile: configFile, 
                templateFile: templateFile, 
                outputHTML: outputFile,
                saveUpdatedPlotConfig: true})