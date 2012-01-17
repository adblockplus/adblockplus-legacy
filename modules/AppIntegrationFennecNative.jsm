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
Cu.import(baseURL.spec + "Utils.jsm");
Cu.import(baseURL.spec + "Prefs.jsm");
Cu.import(baseURL.spec + "FilterClasses.jsm");
Cu.import(baseURL.spec + "ContentPolicy.jsm");
Cu.import(baseURL.spec + "AppIntegration.jsm");

/**
 * Fennec-specific app integration functions.
 * @class
 */
var AppIntegrationFennec =
{
  initWindow: function(wrapper)
  {
    updateFennecStatusUI.apply(wrapper)
  },

  updateState: updateFennecStatusUI,

  openFennecSubscriptionDialog: function(/**WindowWrapper*/ wrapper, /**String*/ url, /**String*/ title)
  {
  }
};

function updateFennecStatusUI()
{
  if ("fennecMenuItem" in this)
  {
    this.window.NativeWindow.menu.remove(this.fennecMenuItem);
    delete this.fennecMenuItem;
  }

  let status = "disabled";
  let host = null;
  if (Prefs.enabled)
  {
    status = "enabled";
    let location = this.getCurrentLocation();
    if (location instanceof Ci.nsIURL && Policy.isBlockableScheme(location))
    {
      try
      {
        host = location.host.replace(/^www\./, "");
      } catch (e) {}
    }

    if (host && Policy.isWhitelisted(location.spec))
      status = "disabled_site";
    else if (host)
      status = "enabled_site";
  }

  let statusText = Utils.getString("fennec_status_" + status);
  if (host)
    statusText = statusText.replace(/\?1\?/g, host);

  this.fennecMenuItem = this.window.NativeWindow.menu.add(statusText, null, toggleFennecWhitelist.bind(this));
}

function toggleFennecWhitelist(event)
{
  if (!Prefs.enabled)
    return;

  let location = this.getCurrentLocation();
  let host = null;
  if (location instanceof Ci.nsIURL && Policy.isBlockableScheme(location))
  {
    try
    {
      host = location.host.replace(/^www\./, "");
    } catch (e) {}
  }

  if (!host)
    return;

  if (Policy.isWhitelisted(location.spec))
    this.removeWhitelist();
  else
    AppIntegration.toggleFilter(Filter.fromText("@@||" + host + "^$document"));

  updateFennecStatusUI.apply(this);
}
