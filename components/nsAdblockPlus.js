/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

const ABP_PACKAGE = "/adblockplus.mozdev.org"; 
const ABP_EXTENSION_ID = "{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}";
const ABP_CONTRACTID = "@mozilla.org/adblockplus;1";
const ABP_CID = Components.ID("{79c889f6-f5a2-abba-8b27-852e6fec4d56}");
const ABP_PROT_CONTRACTID = "@mozilla.org/network/protocol;1?name=abp";
const ABP_PROT_CID = Components.ID("{6a5987fd-93d8-049c-19ac-b9bfe88718fe}");
const locales = [
  "{{LOCALE}}",
  null
];

const loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                         .getService(Components.interfaces.mozIJSSubScriptLoader);

/*
 * Module object
 */

const module =
{
  registerSelf: function(compMgr, fileSpec, location, type)
  {
    compMgr = compMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);
    compMgr.registerFactoryLocation(ABP_CID, 
                    "Adblock content policy",
                    ABP_CONTRACTID,
                    fileSpec, location, type);
    compMgr.registerFactoryLocation(ABP_PROT_CID,
                    "ABP protocol handler",
                    ABP_PROT_CONTRACTID,
                    fileSpec, location, type);

    var catman = Components.classes["@mozilla.org/categorymanager;1"]
                           .getService(Components.interfaces.nsICategoryManager);
    catman.addCategoryEntry("content-policy", ABP_CONTRACTID,
              ABP_CONTRACTID, true, true);
  },

  unregisterSelf: function(compMgr, fileSpec, location)
  {
    compMgr = compMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);

    compMgr.unregisterFactoryLocation(ABP_CID, fileSpec);
    compMgr.unregisterFactoryLocation(ABP_PROT_CID, fileSpec);
    var catman = Components.classes["@mozilla.org/categorymanager;1"]
                           .getService(Components.interfaces.nsICategoryManager);
    catman.deleteCategoryEntry("content-policy", ABP_CONTRACTID, true);
  },

  getClassObject: function(compMgr, cid, iid)
  {
    if (!cid.equals(ABP_CID) && !cid.equals(ABP_PROT_CID))
      throw Components.results.NS_ERROR_NO_INTERFACE;

    if (!iid.equals(Components.interfaces.nsIFactory))
      throw Components.results.NS_ERROR_NOT_IMPLEMENTED;

    return factory;
  },

  canUnload: function(compMgr)
  {
    return true;
  }
};

function NSGetModule(comMgr, fileSpec)
{
  return module;
}

/*
 * Factory object
 */

var initialized = false;
const factory = {
  // nsIFactory interface implementation
  createInstance: function(outer, iid) {
    if (outer != null)
      throw Components.results.NS_ERROR_NO_AGGREGATION;

    if (!initialized)
      init();

    return abp.QueryInterface(iid);
  },

  // nsISupports interface implementation
  QueryInterface: function(iid) {
    if (iid.equals(Components.interfaces.nsISupports) ||
        iid.equals(Components.interfaces.nsIFactory))
      return this;

    if (!iid.equals(Components.interfaces.nsIClassInfo))
      dump("Adblock Plus: factory.QI to an unknown interface: " + iid + "\n");

    throw Components.results.NS_ERROR_NO_INTERFACE;
  }
}

/*
 * Constants / Globals
 */

const Node = Components.interfaces.nsIDOMNode;
const Window = Components.interfaces.nsIDOMWindow;

var windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                               .getService(Components.interfaces.nsIWindowMediator);
var windowWatcher= Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                             .getService(Components.interfaces.nsIWindowWatcher);
try {
  var headerParser = Components.classes["@mozilla.org/messenger/headerparser;1"]
                               .getService(Components.interfaces.nsIMsgHeaderParser);
}
catch(e) {
  headerParser = null;
}

/*
 * Content policy class definition
 */

const abp = {
  //
  // nsISupports interface implementation
  //

  QueryInterface: function(iid) {
    if (iid.equals(Components.interfaces.nsIContentPolicy))
      return policy;

    if (iid.equals(Components.interfaces.nsIProtocolHandler))
      return protocol;

    if (iid.equals(Components.interfaces.nsISupports) ||
        iid.equals(Components.interfaces.nsIAdblockPlus))
      return this;

    if (!iid.equals(Components.interfaces.nsIClassInfo) &&
        !iid.equals(Components.interfaces.nsISecurityCheckedComponent) &&
        !iid.equals(Components.interfaces.nsIDOMWindow))
      dump("Adblock Plus: abp.QI to an unknown interface: " + iid + "\n");

    throw Components.results.NS_ERROR_NO_INTERFACE;
  },

  //
  // nsIAdblockPlus interface implementation
  //

  // Return current subscription count
  get subscriptionCount() {
    return prefs.subscriptions.length;
  },

  // Retrieves a subscription
  getSubscription: function(id) {
    if (!prefs.knownSubscriptions.has(id))
      return null;

    return prefs.knownSubscriptions.get(id);
  },

  // Retrieves a subscription by list index
  getSubscriptionAt: function(index) {
    if (index < 0 || index >= prefs.subscriptions.length)
      return null;

    return prefs.subscriptions[index];
  },

  // Updates an external subscription and creates it if necessary
  updateExternalSubscription: function(id, title, patterns, length) {
    var subscription;
    if (prefs.knownSubscriptions.has(id))
      subscription = prefs.knownSubscriptions.get(id);
    else
      subscription = prefs.createExternalSubscription(id, title);

    if (!subscription.external)
      return false;

    subscription.lastDownload = subscription.lastSuccess = parseInt(new Date().getTime() / 1000);
    subscription.downloadStatus = "synchronize_ok";
    subscription.patterns = [];
    for (var i = 0; i < patterns.length; i++) {
      var pattern = prefs.patternFromText(patterns[i]);
      if (pattern)
        subscription.patterns.push(pattern);
    }

    var found = false;
    for (i = 0; i < prefs.subscriptions.length; i++)
      if (prefs.subscriptions[i] == subscription)
        found = true;

    if (!found)
      prefs.subscriptions.push(subscription);

    prefs.initMatching();
    prefs.savePatterns();
    synchronizer.notifyListeners(subscription, "add");

    return true;
  },

  removeExternalSubscription: function(id) {
    var index = -1;
    for (var i = 0; index < 0 && i < prefs.subscriptions.length; i++)
      if (prefs.subscriptions[i].url == id)
        index = i;

    if (index < 0 || !prefs.subscriptions[index].external)
      return false;
    
    synchronizer.notifyListeners(prefs.subscriptions[index], "remove");
    prefs.subscriptions.splice(index, 1);
    prefs.initMatching();
    prefs.savePatterns();

    return true;
  },

  // Returns installed Adblock Plus version
  getInstalledVersion: function() {
    // Try Firefox Extension Manager
    try {
      var item = this.getUpdateItem();
      if (item)
        return item.version;
    } catch (e) {}

    // Try InstallTrigger
    try {
      // FIXME: This shouldn't depend on the browser
      var browser = windowMediator.getMostRecentWindow("navigator:browser");
      if (browser)
        return browser.InstallTrigger.getVersion(ABP_PACKAGE);
    } catch (e) {}
  
    return null;
  },

  //
  // Custom methods
  //

  // Returns update item for Adblock Plus (only when extension manager is available)
  getUpdateItem: function() {
    if (!("@mozilla.org/extensions/manager;1" in Components.classes))
      return null;

    var extensionManager = Components.classes["@mozilla.org/extensions/manager;1"]
                                    .getService(Components.interfaces.nsIExtensionManager);

    // FF 1.1+
    if ('getItemForID' in extensionManager)
      return extensionManager.getItemForID(ABP_EXTENSION_ID);

    // FF 1.0
    var itemList = extensionManager.getItemList(ABP_EXTENSION_ID, Components.interfaces.nsIUpdateItem.TYPE_EXTENSION, {});
    if (itemList && itemList.length > 0)
      return itemList[0];

    return null;
  },

  // Retrieves settings dialog if it is currently open
  getSettingsDialog: function() {
    return windowMediator.getMostRecentWindow("abp:settings");
  },

  // Opens preferences dialog for the supplied window and filter suggestion
  openSettingsDialog: function(insecWnd, location, filter) {
    var dlg = this.getSettingsDialog();
    var func = function() {
      dlg.setContentWindow(insecWnd);
      if (typeof location != "undefined" && location)
        dlg.setLocation(location);
      if (typeof filter != "undefined" && filter)
        dlg.selectPattern(filter);
    }

    if (dlg) {
      func();

      try {
        dlg.focus();
      }
      catch (e) {
        // There must be some modal dialog open
        dlg = windowMediator.getMostRecentWindow("abp:subscription");
        if (!dlg)
          dlg = windowMediator.getMostRecentWindow("abp:about");

        if (dlg)
          dlg.focus();
      }
    }
    else {
      dlg = windowWatcher.openWindow(null, "chrome://adblockplus/content/settings.xul", "_blank", "chrome,centerscreen,resizable,dialog=no", null);
      dlg.addEventListener("post-load", func, false);
    }
  },

  // Loads a URL in the browser window
  loadInBrowser: function(url) {
    var currentWindow = windowMediator.getMostRecentWindow("navigator:browser");
    if (currentWindow) {
      try {
        currentWindow.delayedOpenTab(url);
      }
      catch(e) {
        currentWindow.loadURI(url);
      }
    }
    else {
      var protocolService = Components.classes["@mozilla.org/uriloader/external-protocol-service;1"]
                                      .getService(Components.interfaces.nsIExternalProtocolService);
      protocolService.loadUrl(url);
    }
  },

  params: null,

  // Saves sidebar state before detaching/reattaching
  setParams: function(params) {
    this.params = params;
  },

  // Retrieves sidebar state
  getParams: function() {
    var ret = this.params;
    this.params = null;
    return ret;
  },

  headerParser: headerParser
};
abp.wrappedJSObject = abp;

/*
 * Core Routines
 */

// Initialization and registration
function init() {
  initialized = true;

  abp.versionComparator = Components.classes["@mozilla.org/xpcom/version-comparator;1"]
                                    .createInstance(Components.interfaces.nsIVersionComparator);

  loader.loadSubScript('chrome://adblockplus/content/utils.js');
  loader.loadSubScript('chrome://adblockplus/content/policy.js');
  loader.loadSubScript('chrome://adblockplus/content/data.js');
  loader.loadSubScript('chrome://adblockplus/content/prefs.js');
  loader.loadSubScript('chrome://adblockplus/content/synchronizer.js');
  loader.loadSubScript('chrome://adblockplus/content/flasher.js');
  loader.loadSubScript('chrome://adblockplus/content/protocol.js');

  // Clean up uninstalled files
  var dirService = Components.classes["@mozilla.org/file/directory_service;1"]
                             .getService(Components.interfaces.nsIProperties);
  var dirArray = ["AChrom", "UChrm", "ProfD", "ComsD"];
  for (var i = 0, n ; i < dirArray.length ; i++) {
    try {
      var currentDir = dirService.get(dirArray[i], Components.interfaces.nsIFile);
      var dirEntries = currentDir.directoryEntries;
      while (dirEntries.hasMoreElements()) {
        var file = dirEntries.getNext().QueryInterface(Components.interfaces.nsIFile);
        if (file.path.match(/-uninstalled$/))
          file.remove(false);
      }
    } catch(e) {}
  }

  // Install sidebar in Mozilla Suite if necessary
  installSidebar();
}

// Try to fix selected language (Mozilla and SeaMonkey don't do it correctly)
function fixPackageLocale() {
  try {
    var locale = "en-US";
    try {
      var branch = Components.classes["@mozilla.org/preferences-service;1"]
                             .getService(Components.interfaces.nsIPrefBranch);
      try {
        var complex = branch.getComplexValue("general.useragent.locale", Components.interfaces.nsIPrefLocalizedString);
        locale = complex.data;
      }
      catch (e) {
        locale = branch.getCharPref("general.useragent.locale");
      }
    } catch (e) {}

    var select = null;
    for (var i = 0; i < locales.length; i++) {
      if (!locales[i])
        continue;

      if (locales[i] == locale) {
        select = locales[i];
        break;
      }

      if (locales[i].substr(0, 2) == locale.substr(0, 2))
        select = locales[i];
    }
    if (!select)
      select = locales[0];

    var iface = ("nsIChromeRegistrySea" in Components.interfaces ? Components.interfaces.nsIChromeRegistrySea : Components.interfaces.nsIXULChromeRegistry);
    var registry = Components.classes["@mozilla.org/chrome/chrome-registry;1"]
                             .getService(iface);
    try {
      registry.selectLocaleForPackage(select, "adblockplus", true);
    } catch (e) {}
  } catch(e) {}
}

// Adds the sidebar to the Customize tabs dialog in Mozilla Suite/Seamonkey
function installSidebar() {
  try {
    var branch = prefService.QueryInterface(Components.interfaces.nsIPrefBranch);
    var customizeURL = branch.getCharPref("sidebar.customize.all_panels.url");
    if (/adblockplus/.test(customizeURL))
      return; // Adblock Plus sidebar is already installed

    customizeURL += " chrome://adblockplus/content/local-panels.rdf";
    branch.setCharPref("sidebar.customize.all_panels.url", customizeURL);
  } catch(e) {}
}
