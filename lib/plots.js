/**
 * @fileoverview This file contains functions to generate Vega-lite
 * specs for simple plots, which may frequently be useful for visualising 
 * metadata for an RO-Crate linguistic collection.
 * 
 * Vega is a JS implementation of Grammar of Graphics (which also underlies
 * ggplot2 in R ecosystem). Vega ecosystem is developed at the Interactive Data 
 * Lab (University of Washington). 
 * 
 * Vega Plots are defined as JSON specs, which can be turned into plots at 
 * rendering time. Vega specs are quite low-level. 
 * 
 * Vega-lite is a higher-level library, which provides a more concise way to 
 * describe plots than full Vega in exchange for less flexibility. Vega-lite 
 * and Vega specs are not directly compatible. Instead, Vega-lite is converted 
 * to full Vega specs during plot rendering, by Vega libraries doing the 
 * rendering.
 * 
 * For the purposes of this package, Vega-lite is typically enough. A few plots 
 * have to be built with full Vega, as Vega-lite doesn't provide the required 
 * options (the mapping plots, for example).  
 * 
 * Function documentation tries to consistently differentiate between Vega and
 * Vega-lite. In some cases, it refers to "Vega/Vega-lite", when the differences 
 * between spec formats can be ignored. 
 * 
 * @author Anton Malko
 */


import * as vega from "vega";
import * as vegaLite from "vega-lite";

// =============================================================================
//  HELPER FUNCTIONS 
// =============================================================================

 /**
  * Create Vega/Vega-lite palette specification
  * 
  * Vega palette specs are structured differently depending on the how the 
  * palette is specified (palette name, list of colors etc.) This function 
  * wraps these differences, so that you can just specify the desired palette.
  * 
  * @param {string|string[]|Object<string, string>} palette - Pallete to use,
  *   as described below:
  * 
  *   - If palette is a string, it is taken as the name of a built-in Vega 
  *     palette, see here for possible values: 
  *     https://vega.github.io/vega/docs/schemes/
  *   - If palette is an array of strings, each item is an HTML color name or a
  *     HEX color code. You need to ensure yourself that you provide enough 
  *     values for the data variable that is mapped onto the color scale
  *   - If palette is an Object, each key should correspond to one possible 
  *     value of the data variable you map onto the color scale, and each 
  *     value -- to the color assigned to this variable. With this option you 
  *     can explicitly assign specific colors to specific data groups. 
  *   
  * @returns {Object} Object which can be inserted directly into the "scale" 
  *   property in Vega/Vega-lite spec.
  */
export function makeColorSpec(palette) {
    
    if (typeof palette === 'string') {
        return({ scheme: palette })
    } else if (Array.isArray(palette)) {
        return({ range: palette })
    } else if (typeof palette === 'object' && palette !== null) {
        return({ domain: palette.keys(), range: palette.values() })
    }
}


/**
 * Add data to Vega/Vega-lite spec
 * 
 * We deliberately limit data to either an object embedded into the Vega spec,
 * or a placeholder for an extenally defined dataset, so that the plots can
 * be stand-alone. (Vega itself also allows URLs, CSVs etc.)
 * 
 * @param {Object} spec - Vega/Vega-lite spec
 * @param {string|Array.<Object>} [data] - Data to add. If it's a string, a 
 *   placeholder for an external dataset is added, which will be bound to the 
 *   data later. (The name of the placeholder should correspond to a dataset 
 *   which is embedded in the rendered template).  
 * 
 *   If this is an array of Objects, it should define a tabular dataset. Each 
 *   object corresponds to a row; each field within the object corresponds to a 
 *   column, and each value -- to the data point in this table cell. See here 
 *   for an example: {@link https://vega.github.io/vega-lite/docs/data.html}
 * @returns {Object} Modified spec with 'data' property filled
 */
export function addData(spec, data){

    // Check data types
    if (!(typeof data === 'string' || Array.isArray(data))) {
        console.warn("Warning while generating Vega-lite spec: 'data' should " +
                     "be a string or an array. The spec will have no data, " +
                     "so this plot won't be displayed.")
    }

    spec = structuredClone(spec);

    if (typeof data === "string") {
        spec.data = { name: data }
    } else {
        spec.data.values = data
    };

    return (spec);
}

/**
 * Add variable to a Vega-lite spec. 
 * 
 * This function is a helper. It deliberately limits the options to 
 * a relatively minimal variable definition.
 * 
 * @param {Object} params - Function parameters
 * @param {Object} params.spec - Vega-lite spec
 * @param {string} params.channel - Encoding channel, i.e., name of the plot 
 *   property which should be bound to a specific data field. Possible channels
 *   depend on the plot type (i.e., "mark" type in Vega-lite spec). In this 
 *   script, channel will typically be "x" (x axis variable), "y", or "color".
 *   See: {@link https://vega.github.io/vega-lite/docs/encoding.html}
 * @param {string} params.field - Name of the data field mapped on the given
 *   channel. See: {@link https://vega.github.io/vega-lite/docs/encoding.html}
 * @param {string} params.type - Type of the data field. Can be "quantitative", 
 *   "temporal", "ordinal", or "nominal". See: 
 *   {@link https://vega.github.io/vega-lite/docs/encoding.html}
 * @param {string} [params.title] - Label assigned to the given channel in the 
 *   rendered plot. E.g., for the x axis it will be the axis label, for color - 
 *   the title of the legend. If not specified, the label will be identical to 
 *   the data field name.
 * @param {Object} [params.labels] - Custom labels for the axis or legend. An 
 *   Object where keys correspond to the values in the data, and the values --
 *   the values to be shown in the plots. Data values which are not mentioned 
 *   will come directly from the data unchanged. For example, the following 
 *   input will ask to replace "Mary" with "Maria": {"Mary": "Maria"}
 * @param {string} [params.timeUnit] - Only relevant when 'type' is "temporal".
 *   The time unit (e.g., month or year) to be displayed. This can be used,
 *   for example, to only show the year in the plot when the data actually has
 *   a full date string. For details and possible values, see: 
 *   {@link https://vega.github.io/vega-lite/docs/timeunit.html}
 * @param {string} [params.tooltipTitle] - Label for the variable in the 
 *   tooltip shown on mouse hover. If not specified, will be the same as 
 *   'title' if that is specified, or else as 'field'.
 * @param {string} [params.tooltipTimeUnit] - Only relevant when 'type' is 
 *   "temporal".Time unit to be ised in tooltip. Can be different from time unit 
 *   in the plot, e.g., so that the tooltip shows the full date while the plot 
 *   only shows the year.
 * @returns {Object} Modified spec with an added variable
 */
export function addVar(
    { 
        spec, channel, field, type, title, labels, timeUnit,
        tooltipTitle, tooltipTimeUnit 
    } = {}
) {

    spec = structuredClone(spec);
    
    spec.encoding[channel] = {
        field: field,
        type: type,
        title: title || field,
        timeUnit: timeUnit
    };
    
    if (labels !== undefined) {
        spec.encoding[channel].axis = {
            labelExpr: `${JSON.stringify(labels)}[datum.label] || datum.label`
        }
    }
    
    spec.encoding.tooltip.push(
        {
            field: field,
            type: type,
            title: tooltipTitle || title || field,
            timeUnit: tooltipTimeUnit || timeUnit
        }
    );

    return (spec);
}

/**
 * Add a color variable to a Vega-lite spec. 
 * 
 * This is a helper for adding a color variable -- it is a thin wrapper around
 * {@link addVar}, handling the addition of color palette. For the meaning of
 * most parameters, see {@link addVar}. The 'palette' parameter is passed to 
 * {@link makeColorSpec}, see there for possible values.
 * 
 * @param {Object} params - Function parameters
 * @param {Object} params.spec
 * @param {string} params.field
 * @param {string} params.type
 * @param {string} [params.title]
 * @param {Object} [params.labels] 
 * @param {string} [params.tooltipTitle]
 * @param {Object} [params.palette] 
 * 
 * @returns {Object} Modified spec with an added color variable
 */
export function addColorVar(
    {
        spec, field, type, title, labels, tooltipTitle, palette
    } = {}
){
    spec = addVar({
        spec, 
        channel: "color",
        field: field, 
        type: type,
        title: title,
        tooltipTitle: tooltipTitle
    })

    if (labels !== undefined) {
        spec.encoding.color.legend = {
            labelExpr: `${JSON.stringify(labels)}[datum.label] || datum.label`
        }
    }

    if (palette !== undefined) {
        spec.encoding.color.scale = makeColorSpec(palette)
    };
    
    return (spec);
}

/**
 * Make a basic Vega-lite spec.
 * 
 * The function provides options for specifying different plot types -- not all
 * options make sense at once (e.g., for pie charts, x axis is meaningless; some
 * plots won't have color etc). It is mostly used internally by higher-order
 * functions which take to only specify parameters meaningful for a given plot.
 * 
 * @param {Object} params - Function parameters
 * @param {Array|undefined} [params.data] - Data to add, as in {@link addData}. 
 *   If undefined, a placeholder for an external dataset is added, which can be 
 *   bound to the data later. (The name of the placeholder is internal to a 
 *   particular Vega spec -- actual data object can have any name, which will be
 *   bound to this placeholder name).  
 * 
 *   If this parameter is specified, it should be an array of Objects, defining
 *   a tabular dataset. Each object corresponds to a row; each field within the
 *   object corresponds to a column, and each value -- to the data point in 
 *   this table cell. See here for an example: 
 *   https://vega.github.io/vega-lite/docs/data.html
 * @param {string} [params.xVar] - Name of the data field mapped onto the X axis
 * @param {string} [params.xType] - Type of the data mapped onto the X axis. 
 *   Can be "quantitative", "temporal", "ordinal", or "nominal". See: 
 *   https://vega.github.io/vega-lite/docs/encoding.html
 * @param {string} [params.xTitle] - Label assigned to the x axis. If not 
 *   specified, the label will be identical to the data field name.
 * @param {Object} [params.xLabels] Custom labels for the X axis. An Object 
 *   where keys correspond to the values in the data, and the values --
 *   the values to be shown in the plots. Data values which are not mentioned 
 *   will come directly from the data unchanged. For example, the following 
 *   input will ask to replace "Mary" with "Maria": {"Mary": "Maria"}
 * @param {string} [params.xTimeUnit] - Only relevant when 'xType' is 
 *   "temporal". The time unit (e.g., month or year) to be displayed on the 
 *   X axis. This can be used, for example, to only show the year in the plot 
 *   when the data actually has a full date string. For details and possible 
 *   values, see: 
 *   {@link https://vega.github.io/vega-lite/docs/timeunit.html}
 * @param {string} [params.xTooltipTitle] - Label for the X axis variable in the 
 *   tooltip shown on mouse hover. If not specified, will be the same as 
 *   'xTitle' if that is specified, or else as 'xVar'.
 * @param {string} [params.xTooltipTimeUnit] - Only relevant when 'xType' is 
 *   "temporal".Time unit to be ised in tooltip for the X axis. Can be different 
 *   from time unit in the plot, e.g., so that the tooltip shows the full date 
 *   while the plot only shows the year.
 * @param {string} [params.yVar] - As above, but for the Y axis
 * @param {string} [params.yType]
 * @param {string} [params.yTitle]
 * @param {Object} [params.yLabels]
 * @param {string} [params.yTimeUnit] 
 * @param {string} [params.yTooltipTitle]
 * @param {string} [params.xTooltipTimeUnit]
 * @param {string} [params.colorVar] - As above, but for the color variable
 * @param {string} [params.colorType]
 * @param {string} [params.colorTitle]
 * @param {Object} [params.colorLabels]
 * @param {string} [params.colorTooltipTitle]
 * @param {string|string[]|Object<string, string>} [params.palette] - Pallete
 *   to use, as described in {@link makeColorSpec}.
 * 
 *   - If palette is a string, it is taken as the name of a built-in Vega 
 *     palette, see here for possible values: 
 *     https://vega.github.io/vega/docs/schemes/
 *   - If palette is an array of strings, each item is an HTML color name or a
 *     HEX color code. You need to ensure yourself that you provide enough 
 *     values for the data variable that is mapped onto the color scale
 *   - If palette is an Object, each key should correspond to one possible 
 *     value of the data variable you map onto the color scale, and each 
 *     value -- to the color assigned to this variable. With this option you 
 *     can explicitly assign specific colors to specific data groups. 
 * @param {string} [params.title] - Plot title
 * @param {string} [params.subtitle] - Plot subtitle
 * @param {string} [params.width = "container"] - Plot width; by default adapts
 *   to the HTML container width.
 * @param {string} [params.height = "container"] - Plot height; by default 
 *   adapts to the HTML container height.
 * 
 * @returns {Object} Basic Vega-lite spec
 */
export function makePlotSkeleton(
    {
        data,
        mark,
        xVar, xType, xTitle, xLabels, xTimeUnit, xTooltipTitle, 
        xTooltipTimeUnit, 
        yVar, yType, yTitle, yLabels, yTimeUnit, yTooltipTitle, 
        yTooltipTimeUnit, 
        colorVar, colorType, colorTitle, colorLabels, colorTooltipTitle, 
        palette,
        title = "",
        subtitle = "",
        width = "container",
        height = "container"
    } = {}
) {
    
    let spec = {
        $schema: "https://vega.github.io/schema/vega-lite/v6.json",
        autosize: {
            type: "fit",
            contains: "padding"
        },
        width: width,
        height: height,
        title: {
            text: title,
            subtitle: subtitle,
            offset: 10
        },
        data: {},
        mark: {
            type: mark,
        },
        encoding: {
            tooltip: []
        }
    };
    
    if (xVar !== undefined) {
        spec = addVar({
            spec, 
            channel: "x",
            field: xVar,
            type: xType, 
            title: xTitle,
            labels: xLabels,
            timeUnit: xTimeUnit,
            tooltipTitle: xTooltipTitle,
            tooltipTimeUnit: xTooltipTimeUnit,

        })
    };
    
    if (yVar !== undefined) {
        spec = addVar({
            spec, 
            channel: "y",
            field: yVar, 
            type: yType,
            title: yTitle,
            labels: yLabels,
            timeUnit: yTimeUnit,
            tooltipTitle: yTooltipTitle,
            tooltipTimeUnit: yTooltipTimeUnit
        })
    };

    if (colorVar !== undefined) {
        spec = addColorVar({
            spec: spec, 
            field: colorVar,
            type: colorType,
            title: colorTitle,
            labels: colorLabels,
            tooltipTitle: colorTooltipTitle,
            palette: palette
        })
    };

    if (data !== undefined) {
        spec = addData(spec, data);
    }

    return(spec);
}

// =============================================================================
//  FUNCTIONS FOR PRODUCING SPECIFIC TYPES OF PLOTS
// =============================================================================

// Users are expected to mostly rely on these functions rather than calling
// the helper functions from above. Although in some situations having access
// to helpers may still be useful, that's why they are also exported.

// For most functions, the parameters are a subset of parameters for the 
// 'makePlotSkeleton', refer there for definitions.

/**
 * Make a bar plot of *counts*
 * 
 * It is assumed that the data is unaggregated; the function will produce
 * counts internally: first, within values of the X variable, and then within  
 * values of the color variable, if specified
 * 
 * @param {Object} - Function parameters, see {@link makePlotSkeleton}
 * @returns {Object} Vega-lite spec
 */
export function barPlotCount(
    { data, xVar, xTitle, xLabels, xTimeUnit, xTooltipTitle, xTooltipTimeUnit,
        yTitle, yLabels, yTooltipTitle,
        colorVar, colorType, colorTitle, colorLabels, colorTooltipTitle, 
        palette,  
        title, subtitle} = {}
    ) {

    let spec = makePlotSkeleton({
        data,
        mark: "bar", 
        xVar: xVar, xType: "nominal", xTitle: xTitle, xLabels: xLabels, 
        xTimeUnit: xTimeUnit, xTooltipTitle: xTooltipTitle, 
        xTooltipTimeUnit: xTooltipTimeUnit,
        yTitle: yTitle, yLabels: yLabels, yTooltipTitle: yTooltipTitle,
        colorVar: colorVar, colorType: colorType, colorTitle: colorTitle, 
        colorLabels: colorLabels, colorTooltipTitle: colorTooltipTitle,
        palette,
        title: title, subtitle: subtitle
    })

    spec.encoding.y = {
        aggregate: "count",
        title: yTitle || `Count of ${xTitle || xVar}`
    };

    spec.encoding.tooltip.push({
        aggregate: "count",
        title: yTooltipTitle || yTitle || `Count of ${xTitle || xVar}`
    });
    
    return spec;
}

/**
 * Make a scatter plot
 * 
 * @param {Object} - Function parameters, see {@link makePlotSkeleton}
 * @returns {Object} Vega-lite spec
 */
export function scatterPlot(
    { data, 
        xVar, xType, xTitle, xLabels, xTimeUnit, xTooltipTitle,
        xTooltipTimeUnit,
        yVar, yType, yTitle, yLabels, yTimeUnit, yTooltipTitle,
        yTooltipTimeUnit,
        colorVar, colorType, colorTitle, colorLabels, colorTooltipTitle,
        palette, 
        title, subtitle} = {}
) {

    let spec = makePlotSkeleton({
        data,
        mark: "point", 
        xVar: xVar, xType: xType, xTitle: xTitle,  xLabels: xLabels,
        xTimeUnit: xTimeUnit, xTooltipTitle: xTooltipTitle, 
        xTooltipTimeUnit: xTooltipTimeUnit,
        yVar: yVar, yType: yType, yTitle: yTitle, yLabels, yLabels,
        yTimeUnit: yTimeUnit, yTooltipTitle: yTooltipTitle, 
        yTooltipTimeUnit: yTooltipTimeUnit,
        colorVar: colorVar, colorType: colorType, colorTitle: colorTitle, 
        colorLabels: colorLabels, colorTooltipTitle: colorTooltipTitle,
        palette: palette,
        title: title, subtitle: subtitle
    })
    
    return spec;

}

/**
 * Make a boxplot
 * 
 * The type of the quantitative variable currently has to be explicitly set
 * to "quantitative". If there are two grouping variables and they are not
 * set to the same data fields, the sub-plots by color will be spread 
 * across the axis for the other grouping variable.
 * 
 * Whiskers cover 1.5 inter-quartile range, default in Vega-lite, which is 
 * sensible. 
 * 
 * @param {Object} params- Function parameters, see {@link makePlotSkeleton}
 * @returns {Object} Vega-lite spec
 */
export function boxPlot(
    { data, 
        xVar, xType, xTitle, xLabels, xTimeUnit, xTooltipTitle,
        xTooltipTimeUnit,
        yVar, yType, yTitle, yLabels, yTooltipTitle,
        colorVar, colorType, colorTitle, colorLabels, colorTooltipTitle,
        palette,  
        title, subtitle} = {}
    ) {
    
    let spec = makePlotSkeleton({
        data,
        mark: "boxplot", 
        xVar: xVar, xType: xType, xTitle: xTitle,  xLabels: xLabels,
        xTimeUnit: xTimeUnit, xTooltipTitle: xTooltipTitle, 
        xTooltipTimeUnit: xTooltipTimeUnit,
        yVar: yVar, yType: yType, yTitle: yTitle, yLabels, yLabels,
        yTooltipTitle: yTooltipTitle, 
        colorVar: colorVar, colorType: colorType, colorTitle: colorTitle, 
        colorLabels: colorLabels, colorTooltipTitle: colorTooltipTitle,
        palette: palette,
        title: title, subtitle: subtitle
    });

    // TODO: try to guess which variable should be treated as quantitative?

    // TODO: need to think more about appropriate conditions here
    if (xType === "quantitative" | xType === "temporal") {
        // For boxplots showing zero might make the boxplot unreadable
        // (e.g., if the values are all much bigger or smaller than 0).
        // So here we remove the requirement that the scale includes 0 for
        // the continuous variable
        spec.encoding.x.scale = { zero: false };
        
        if (yVar !== undefined) {
            yType = "nominal"
        };

        if (colorVar !== undefined) {
            colorType = "nominal"
        };

    } else if (yType === "quantitative" |yType === "temporal") {
        spec.encoding.y.scale = { zero: false };

        if (xVar !== undefined) {
            xType = "nominal"
        };

        if (colorVar !== undefined) {
            colorType = "nominal"
        };

    } else {
        console.warn("Boxplot: either xType or yType should be " +
                     "'quantitative' or 'temporal'. Currently they are: " +
                     `xType -- ${xType}, yType -- ${yType}`);
    };

    // If two grouping varaibles are used, and they are NOT both mapped onto 
    // color and one of the axis, make it so that the color specifies 
    // subgrouping
    if (colorVar !== undefined) {
        if (xVar !== undefined & xType === "nominal" & 
            colorType === "nominal" & xVar !== colorVar) {
                spec.encoding.xOffset = {
                    field: colorVar,
                    type: "nominal"
                }
            
        }

        if (yVar !== undefined & yType === "nominal" & 
            colorType === "nominal" & yVar !== colorVar) {
                spec.encoding.yOffset = {
                    field: colorVar,
                    type: "nominal"
                }
        }
    }
    
    return spec;
}

export function histogramPlot(
    { data, 
        xVar, xType, xTitle, xLabels, xTimeUnit, xTooltipTitle,
        xTooltipTimeUnit,
        yVar, yType, yTitle, yLabels, yTooltipTitle,
        colorVar, colorType, colorTitle, colorLabels, colorTooltipTitle,
        palette,
        title, subtitle} = {}
    ) {

    let spec = makePlotSkeleton({
        data,
        mark: "bar", 
        xVar: xVar, xType: xType, xTitle: xTitle,  xLabels: xLabels,
        xTimeUnit: xTimeUnit, xTooltipTitle: xTooltipTitle, 
        xTooltipTimeUnit: xTooltipTimeUnit,
        yVar: yVar, yType: yType, yTitle: yTitle, yLabels, yLabels,
        yTooltipTitle: yTooltipTitle, 
        colorVar: colorVar, colorType: colorType, colorTitle: colorTitle, 
        colorLabels: colorLabels, colorTooltipTitle: colorTooltipTitle,
        palette: palette,
        title: title, subtitle: subtitle
    });

    spec.encoding.x.bin = true;

    spec.encoding.y = {
        aggregate: "count",
        title: yTitle || `Count of ${xTitle || xVar}`
    };

    spec.encoding.tooltip.push({
        aggregate: "count",
        title: yTooltipTitle || yTitle || `Count of ${xTitle || xVar}`
    });
    
    return spec;
}

