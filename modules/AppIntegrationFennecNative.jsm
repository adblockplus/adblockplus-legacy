/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/**
 * @fileOverview Code specific to integration into Fennec with native UI.
 */

var EXPORTED_SYMBOLS = ["AppIntegrationFennec"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

/**
 * Fennec-specific app integration functions.
 * @class
 */
var AppIntegrationFennec =
{
  initWindow: function(wrapper)
  {
  },

  openFennecSubscriptionDialog: function(/**WindowWrapper*/ wrapper, /**String*/ url, /**String*/ title)
  {
  }
};
