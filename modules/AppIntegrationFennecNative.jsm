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
    wrapper.updateState = updateFennecStatusUI;
    wrapper.updateState();
  },

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

  let action;
  let host = null;
  if (Prefs.enabled)
  {
    let location = this.getCurrentLocation();
    if (location instanceof Ci.nsIURL && Policy.isBlockableScheme(location))
    {
      try
      {
        host = location.host.replace(/^www\./, "");
      } catch (e) {}
    }
    if (!host)
      return;

    if (host && Policy.isWhitelisted(location.spec))
      action = "enable_site";
    else if (host)
      action = "disable_site";
  }
  else
    action = "enable";

  let actionText = Utils.getString("mobile_menu_" + action);
  if (host)
    actionText = actionText.replace(/\?1\?/g, host);

  this.fennecMenuItem = this.window.NativeWindow.menu.add(actionText, null, toggleFennecWhitelist.bind(this));
}

function toggleFennecWhitelist(event)
{
  if (!Prefs.enabled)
  {
    Prefs.enabled = true;
    return;
  }

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

  this.updateState();
}
