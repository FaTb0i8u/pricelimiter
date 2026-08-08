/**
 * Test bootstrap.
 *
 * The extension modules are plain scripts that attach themselves to
 * `globalThis.PPP`, so they must be required in dependency order. There is no
 * bundler and no npm dependency: run with `node --test test/`.
 */
'use strict';

const units = require('../src/common/units.js');
const price = require('../src/common/parse-price.js');
const quantity = require('../src/common/parse-quantity.js');
const settings = require('../src/common/settings.js');
const sites = require('../src/content/sites.js');
const adapter = require('../src/content/site-adapter.js');

module.exports = { units, price, quantity, settings, sites, adapter, PPP: globalThis.PPP };
