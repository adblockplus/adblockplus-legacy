/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = "chrome://adblockplus-modules/content/";
Cu.import(baseURL + "AppIntegration.jsm");
Cu.import(baseURL + "ContentPolicy.jsm");
Cu.import(baseURL + "FilterClasses.jsm");
Cu.import(baseURL + "FilterListener.jsm");
Cu.import(baseURL + "FilterStorage.jsm");
Cu.import(baseURL + "FilterNotifier.jsm");
Cu.import(baseURL + "IO.jsm");
Cu.import(baseURL + "Matcher.jsm");
Cu.import(baseURL + "Prefs.jsm");
Cu.import(baseURL + "RequestNotifier.jsm");
Cu.import(baseURL + "SubscriptionClasses.jsm");
Cu.import(baseURL + "Synchronizer.jsm");
Cu.import(baseURL + "Sync.jsm");
Cu.import(baseURL + "Utils.jsm");

/**
 * Shortcut for document.getElementById(id)
 */
function E(id)
{
  return document.getElementById(id);
}
