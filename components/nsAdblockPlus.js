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

const ADBLOCK_CONTRACTID = "@mozilla.org/adblockplus;1";
const ADBLOCK_CID = Components.ID("{79c889f6-f5a2-abba-8b27-852e6fec4d56}");

const loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                       .getService(Components.interfaces.mozIJSSubScriptLoader);
loader.loadSubScript('chrome://adblockplus/content/security.js');

/*
 * Module object
 */

const module =
{
  factoryLoaded: false,

  registerSelf: function(compMgr, fileSpec, location, type)
  {
    compMgr = compMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);
    compMgr.registerFactoryLocation(ADBLOCK_CID, 
                    "Adblock content policy",
                    ADBLOCK_CONTRACTID,
                    fileSpec, location, type);

    var catman = Components.classes["@mozilla.org/categorymanager;1"]
                           .getService(Components.interfaces.nsICategoryManager);
    catman.addCategoryEntry("content-policy", ADBLOCK_CONTRACTID,
              ADBLOCK_CONTRACTID, true, true);
  },

  unregisterSelf: function(compMgr, fileSpec, location)
  {
    compMgr = compMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);

    compMgr.unregisterFactoryLocation(ADBLOCK_CID, fileSpec);
    var catman = Components.classes["@mozilla.org/categorymanager;1"]
                           .getService(Components.interfaces.nsICategoryManager);
    catman.deleteCategoryEntry("content-policy", ADBLOCK_CONTRACTID, true);
  },

  getClassObject: function(compMgr, cid, iid)
  {
    if (!cid.equals(ADBLOCK_CID))
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

const factory = {
  // nsIFactory interface implementation
  createInstance: function(outer, iid) {
    if (outer != null)
      throw Components.results.NS_ERROR_NO_AGGREGATION;

    if (!initialized)
      init();

    return adblock;
  },

  // nsISupports interface implementation
  QueryInterface: function(iid) {
    if (!iid.equals(Components.interfaces.nsISupports) &&
        !iid.equals(Components.interfaces.nsIFactory)) {
      dump("Adblock Plus: factory.QI to an unknown interface: " + iid + "\n");
      throw Components.results.NS_ERROR_NO_INTERFACE;
    }

    return this;
  }
}

/*
 * Filter cache
 */

function HashTable() {}
HashTable.prototype = {
  data: {},
  get: function(key)
  {
    key = " " + key;
    if (key in this.data)
      return this.data[key];
    else
      return null;
  },
  put: function(key, value)
  {
    key = " " + key;
    this.data[key] = value;
  },
  clear: function()
  {
    this.data = {};
  }
}
const cache = new HashTable();

/*
 * Constants / Globals
 */

var initialized = false;

const Node = Components.interfaces.nsIDOMNode;

var type, typeDescr, blockTypes, blockSchemes, linkTypes, linkSchemes, baseTypes, baseNames;

const ok = ("ACCEPT" in Components.interfaces.nsIContentPolicy ? Components.interfaces.nsIContentPolicy.ACCEPT : true);
const block = ("REJECT_REQUEST" in Components.interfaces.nsIContentPolicy ? Components.interfaces.nsIContentPolicy.REJECT_REQUEST : false);
const oldStyleAPI = (typeof ok == "boolean");

const boolPrefs = ["enabled", "linkcheck", "fastcollapse", "frameobjects", "listsort", "warnregexp", "checkedadblockprefs"];
const prefs = {}
const prefListeners = [];
var disablePrefObserver = false;

const prefService = Components.classes["@mozilla.org/preferences-service;1"]
                        .getService(Components.interfaces.nsIPrefService);
const adblockBranch = prefService.getBranch("extensions.adblockplus.");

const windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator);
var lastBrowser = null;
var lastWindow  = null;

/*
 * Content policy class definition
 */

const adblock = {
  // nsIContentPolicy interface implementation
  shouldLoad: function(contentType, contentLocation, requestOrigin, insecRequestingNode, mimeTypeGuess, extra) {
    // if it's not a blockable type or not the HTTP protocol, use the usual policy
    if (!(contentType in blockTypes && contentLocation.scheme in blockSchemes))
      return ok;

    // handle old api
    if (oldStyleAPI)
      insecRequestingNode = requestOrigin;  // oldStyleAPI @params: function(contentType, contentLocation, context, wnd)

    if (!insecRequestingNode)
      return ok;

    return (this.processNode(insecRequestingNode, contentType, contentLocation.spec, false) ? ok : block);
  },

  shouldProcess: function(contentType, contentLocation, requestOrigin, insecRequestingNode, mimeType, extra) {
    return ok;
  },

  // nsIObserver implementation
  observe: function(subject, topic, prefName) { 
    if (!disablePrefObserver)
      loadSettings();
  },

  // nsISupports interface implementation
  QueryInterface: function(iid) {
    if (!iid.equals(Components.interfaces.nsISupports) &&
        !iid.equals(Components.interfaces.nsIContentPolicy) &&
        !iid.equals(Components.interfaces.nsIObserver)) {
      dump("Adblock Plus: policy.QI to an unknown interface: " + iid + "\n");
      throw Components.results.NS_ERROR_NO_INTERFACE;
    }

    return this;
  },

  // Custom methods

  // Checks whether a node should be blocked, hides it if necessary, return value false means that the node is blocked
  processNode: function(insecNode, contentType, location, collapse) {
    var insecWnd = getTopWindow(insecNode);
    if (!insecWnd || !insecBlockableScheme(secureGet(insecWnd, "location")))
      return true;

    if (matchesAny(secureGet(insecWnd, "location", "href"), prefs.whitelist))
      return true;

    var data = this.getDataForWindow(insecWnd);
    if (!collapse)
      insecNode = elementInterface(contentType, insecNode);

    var match = null;
    if (prefs.enabled) {
      // Try to use previous results - if there were any
      match = cache.get(location);

      // If we didn't cache the result yet:
      // check whether we want to block the node and store the result
      if (match == null) {
        match = matchesAny(location, prefs.regexps);
        if (match)
          cache.put(match);
        else
          cache.put(false);
      }

      // Check links in parent nodes
      if (!match && insecNode && prefs.linkcheck && contentType in linkTypes)
        match = checkLinks(contentType, insecNode);

      // If the node wasn't blocked we still might want to add a frame to it
      if (!match && prefs.frameobjects
          && (contentType == type.OBJECT || secureGet(insecNode, "nodeName").toLowerCase() == "embed") // objects and raw-embeds
          && location != secureGet(insecNode, "ownerDocument", "defaultView", "location", "href")) // it's not a standalone object
        secureLookup(insecWnd, "setTimeout")(addObjectTab, 0, insecNode, location, insecWnd);
    }

    // Store node data
    data.addNode(insecNode, contentType, location, match);

    if (match && insecNode) {
      // hide immediately if fastcollapse is off but not base types
      collapse = collapse || !prefs.fastcollapse;
      collapse = collapse && !(contentType in baseTypes || secureGet(insecNode, "nodeName").toLowerCase() in baseNames);
      hideNode(insecNode, insecWnd, collapse);
    }

    return !match;
  },

  getPrefs: function() {
    return prefs;
  },

  savePrefs: function() {
    saveSettings();
  },

  addPrefListener: function(handler) {
    prefListeners.push(handler);
  },

  // Loads Adblock data associated with a window object
  getDataForWindow: function(insecWnd) {
    var data = secureLookup(insecWnd, "controllers", "getControllerForCommand")("adblock");
    while (data && !("validate" in data))
      data = data.wrappedJSObject;
  
    if (!data) {
      data = new FakeController();
      data.install(insecWnd);
    }
    else
      data.validate(insecWnd);
  
    return data;
  },

  // Loads Adblock data associated with a node object
  getDataForNode: function(insecNode) {
    var insecWnd = getTopWindow(insecNode);
    if (!insecWnd)
      return null;

    var data = this.getDataForWindow(insecWnd).getAllLocations();
    while (insecNode) {
      for (var i = 0; i < data.length; i++)
        for (var j = 0; j < data[i].inseclNodes.length; j++)
          if (data[i].inseclNodes[j] == insecNode)
            return data[i];

      // If we don't have any information on the node, then maybe on its parent
      insecNode = secureGet(insecNode, "parentNode");
    }

    return null;
  },

  // Opens preferences dialog for the supplied window and filter suggestion
  openSettingsDialog: function(insecWnd, location) {
    var dlg = windowMediator.getMostRecentWindow("adblock:settings");
    if (dlg)
      dlg.focus();
    else {
      var browser = windowMediator.getMostRecentWindow("navigator:browser");
      browser.openDialog("chrome://adblockplus/content/settings.xul", "_blank", "chrome,resizable,centerscreen", insecWnd, location);
    }
  },

  // Loads a URL in the browser window
  loadInBrowser: function(url) {
    var windowService = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator);
    var currentWindow = windowService.getMostRecentWindow("navigator:browser");
    if (currentWindow) {
      try {
        currentWindow.delayedOpenTab(url);
      }
      catch(e) {
        currentWindow.loadURI(url);
      }
    }
  },

  getFlasher: function() {
    return flasher;
  }
};

adblock.wrappedJSObject = adblock;

/*
 * Fake nsIController object - data container
 */

function FakeController() {
  this.locations = {};
  this.locationListeners = [];
  this.wrappedJSObject = this;
}
FakeController.prototype = {
  insecDoc: null,

  // nsIController interface implementation
  insecCommandEnabled: function(command) {
    return false;
  },
  supportsCommand: function(command) {
    return (command == "adblock");
  },

  // nsISupports interface implementation
  QueryInterface: function(iid) {
    if (!iid.equals(Components.interfaces.nsISupports) &&
        !iid.equals(Components.interfaces.nsIController)) {
      dump("Adblock Plus: FakeController.QI to an unknown interface: " + iid + "\n");
      throw Components.results.NS_ERROR_NO_INTERFACE;
    }

    return this;
  },

  // Custom methods
  clear: function() {
    this.notifyLocationListeners(null, false);
    this.locations = {};
  },
  install: function(insecWnd) {
    // Remove any previously installed controllers first
    var controller;
    while ((controller = secureLookup(insecWnd, "controllers", "getControllerForCommand")("adblock")) != null)
      secureLookup(insecWnd, "controllers", "removeController")(controller);

    this.insecDoc = secureGet(insecWnd, "document");
    secureLookup(insecWnd, "controllers", "appendController")(this);
  },
  validate: function(insecWnd) {
    var insecDoc = secureGet(insecWnd, "document");
    if (this.insecDoc != insecDoc) {
      // We have data for the wrong document
      this.clear();
      this.insecDoc = insecDoc;
    }
  },
  addNode: function(insecNode, contentType, location, filter) {
    // for images repeated on page store node for each repeated image
    var key = " " + location;
    if (key in this.locations) {
      // Always override the filter just in case a known node has been blocked
      this.locations[key].filter = filter;

      // Do not add the same node twice
      for (var i = 0; i < this.locations[key].inseclNodes.length; i++)
        if (this.locations[key].inseclNodes[i] == insecNode)
          return;

      this.locations[key].inseclNodes.push(insecNode);
    }
    else {
      // Before adding a new location we have to check existing nodes so the
      // listener can remove them if necessary
      if (this.locationListeners.length > 0) {
        // Need a timeout here - nodes might not be invalidated immediately
        var me = this;
        createTimer(function() {me.getAllLocations()}, 0);
      }

      // Add a new location and notify the listeners
      this.locations[key] = {
        inseclNodes: [insecNode],
        location: location,
        type: contentType,
        typeDescr: typeDescr[contentType],
        filter: filter
      };
      this.notifyLocationListeners(this.locations[key], true);
    }
  },
  getLocation: function(location) {
    var key = " " + location;
    return this.checkNodes(key);
  },
  getAllLocations: function() {
    var results = [];
    for (var key in this.locations) {
      if (key.match(/^ /)) {
        var data = this.checkNodes(key);
        if (data)
          results.push(data);
      }
    }
    return results;
  },

  // Adds a new handler to be notified whenever the location list is added
  addLocationListener: function(handler) {
    this.locationListeners.push(handler);
  },
  
  // Removes a handler
  removeLocationListener: function(handler) {
    for (var i = 0; i < this.locationListeners.length; i++)
      if (this.locationListeners[i] == handler)
        return this.locationListeners.splice(i, 1);

    return null;
  },

  // Calls all location listeners
  notifyLocationListeners: function(location, added) {
    for (var i = 0; i < this.locationListeners.length; i++)
      this.locationListeners[i](location, added);
  },

  // Makes sure that all nodes still valid (have a view associated with them)
  checkNodes: function(key) {
    if (!(key in this.locations))
      return null;

    var data = this.locations[key];
    for (var i = 0; i < data.inseclNodes.length; i++) {
      var insecNode = data.inseclNodes[i];
      var valid = true;
      
      // Special handling for subdocuments - those nodes might be still valid,
      // but the have been readded for another URL
      if (data.type == type.SUBDOCUMENT)
        valid = (secureGet(insecNode, "contentWindow", "location", "href") == data.location);
      else if (secureGet(insecNode, "nodeType") == Node.ELEMENT_NODE)
        valid = secureGet(insecNode, "ownerDocument", "defaultView");
      else if (secureGet(insecNode, "nodeType") == Node.DOCUMENT_NODE)
        valid = secureGet(insecNode, "defaultView");

      if (!valid) {
        data.inseclNodes.splice(i, 1);
        i--;
      }
    }

    if (data.inseclNodes.length > 0)
      return data;
    else {
      this.notifyLocationListeners(data, false);
      delete this.locations[key];
      return null;
    }
  }
}

/*
 * Core Routines
 */

// Initialization and registration
function init() {
  initialized = true;

  // Preferences observer registration
  try {
    var prefInternal = Components.classes["@mozilla.org/preferences-service;1"]
                                 .getService(Components.interfaces.nsIPrefBranchInternal);
    prefInternal.addObserver("extensions.adblockplus.", adblock, false);
  }
  catch (e) {
    dump("Adblock Plus: exception registering pref observer: " + e + "\n");
  }
  
  // Variable initialization

  var types = ["OTHER", "SCRIPT", "IMAGE", "STYLESHEET", "OBJECT", "SUBDOCUMENT", "DOCUMENT"];

  // type constant by type description and type description by type constant
  type = {};
  typeDescr = {};
  var iface = Components.interfaces.nsIContentPolicy;
  for (var k = 0; k < types.length; k++) {
    var typeName = types[k];
    type[typeName] = typeName in iface ? iface[typeName] : iface["TYPE_" + typeName];
    typeDescr[type[typeName]] = typeName;
  }

  // blockable content-policy types
  blockTypes = {
    SCRIPT: true,
    STYLESHEET: true,
    IMAGE: true,
    OBJECT: true,
    SUBDOCUMENT: true
  };
  translateTypes(blockTypes);

  // blockable schemes
  blockSchemes = {http: true, https: true};

  // link-searchable types + href-protocols
  linkTypes = {
    IMAGE: true,
    OBJECT: true
  };
  translateTypes(linkTypes);

  linkSchemes = {http: true, https: true, javascript: true};

  // unalterable content-policy types + nodeNames -- root-elements
  baseTypes = {
    SCRIPT: true,
    STYLESHEET: true
  };
  translateTypes(baseTypes);

  baseNames = {html: true, body: true, script: true};

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

  // Load settings
  loadSettings();
}

// Loads the preferences
function loadSettings() {
  cache.clear();
  for (var i = 0; i < boolPrefs.length; i++)
    prefs[boolPrefs[i]] = adblockBranch.getBoolPref(boolPrefs[i]);

  // Load filter list -- on init or pref change
  prefs.patterns = [];
  prefs.regexps = [];
  prefs.whitelist = [];
  var url = Components.classes["@mozilla.org/network/standard-url;1"]
                      .createInstance(Components.interfaces.nsIURI);

  var list = adblockBranch.getCharPref("patterns");
  if (list) {
    list = list.split(" ");

    // The list should be sorted here but rue insists on keeping the ordering
    // Load list into memory and remove duplicate entries at the same time
    for (i = 0; i < list.length; i++) {
      if (list[i] != "" && typeof prefs.patterns[" " + list[i]] == "undefined") {
        prefs.patterns.push(list[i]);
        prefs.patterns[" " + list[i]] = null;
        addPattern(list[i]);
      }
    }

    if (list.length != prefs.patterns.length) {
      adblockBranch.setCharPref("patterns", prefs.patterns.join(" "));
      prefService.savePrefFile(null); // save the prefs to disk 
    }
  }

  for (i = 0; i < prefListeners.length; i++)
    prefListeners[i](prefs);

  if (!prefs.checkedadblockprefs)
    importAdblockSettings();
}

// Imports preferences from classic Adblock
function importAdblockSettings() {
  var importBranch = prefService.getBranch("adblock.");
  for (var i = 0; i < boolPrefs.length; i++) {
    try {
      if (importBranch.prefHasUserValue(boolPrefs[i]) && !adblockBranch.prefHasUserValue(boolPrefs[i]))
        prefs[boolPrefs[i]] = importBranch.getBoolPref(boolPrefs[i])
    } catch (e) {}
  }

  try {
    if (importBranch.prefHasUserValue("patterns") && !adblockBranch.prefHasUserValue("patterns"))
      prefs.patterns = importBranch.getCharPref("patterns").split(" ");
  } catch (e) {}

  prefs.checkedadblockprefs = true;
  saveSettings();
}

// Saves the preferences
function saveSettings()
{
  disablePrefObserver = true;

  try {
    for (var i = 0; i < boolPrefs.length; i++)
      adblockBranch.setBoolPref(boolPrefs[i], prefs[boolPrefs[i]]);
  
    var str = prefs.patterns.join(" ");
    adblockBranch.setCharPref("patterns", str);
    prefService.savePrefFile(null); // save the prefs to disk 
  } catch (e) {}

  disablePrefObserver = false;
  loadSettings();
}

// returns the queryInterface to a dom-object or frame / iframe -- for 'shouldload' policy-check
function elementInterface(contentType, insecNode) {
  try {
    if (!oldStyleAPI)
      return insecNode;
    else if (contentType == type.SUBDOCUMENT)
      return secureGet(insecNode, "ownerDocument", "defaultView", "frameElement");
    else
      return secureLookup(insecNode, "QueryInterface")(Components.interfaces.nsIDOMElement);
  }
  catch(e) {
    return insecNode;
  }
}

// hides a blocked element and collapses it if necessary
function hideNode(insecNode, insecWnd, collapse) {
  // hide object tab
  var insecTab = secureGet(insecNode, "nextSibling");
  if (insecTab && secureGet(insecTab, "nodeType") == Node.ELEMENT_NODE &&
      secureLookup(insecTab, "hasAttribute")("AdblockTab"))
    secureSet(insecTab, "style", "display", "none");

  // special handling for applets -- disable by specifying the Applet base class
  var nodeName = secureGet(insecNode, "nodeName");
  if (nodeName && nodeName.toLowerCase() == "applet")
    secureLookup(insecNode, "setAttribute")("code", "java.applet.Applet");

  // Empty iframes to avoid a graphics glitch -- old api only
  if (oldStyleAPI && nodeName && nodeName.toLowerCase() == "iframe") {
    var insecRoot = secureGet(insecWnd, "document", "documentElement");
    var removeFunc = secureLookup(insecRoot, "removeChild");
    var insecChild;
    while ((insecChild = secureGet(insecRoot, "firstChild")) != null)
      removeFunc(insecChild);
  }

  if (collapse) {
    // adjust frameset's cols/rows for frames
    var attrFunc = secureLookup(insecNode, "parentNode", "hasAttribute");
    if (nodeName.toLowerCase() == "frame" &&
        secureGet(insecNode, "parentNode", "nodeName").toLowerCase() == "frameset" &&
        (attrFunc("cols") ^ attrFunc("rows"))) {
      var frameTags = {FRAME: true, FRAMESET: true};
      var index = -1;
      for (var insecFrame = insecNode; insecFrame; insecFrame = secureGet(insecFrame, "previousSibling"))
        if (secureGet(insecFrame, "nodeName").toUpperCase() in frameTags)
          index++;
  
      var attr = (attrFunc("rows") ? "rows" : "cols");
      secureLookup(insecWnd, "setTimeout")(hideFrameCallback, 0, secureGet(insecNode, "parentNode"), attr, index);
    }
    else
      secureLookup(insecWnd, "setTimeout")(hideCallback, 0, insecNode);
  }
}

function hideCallback(insecNode) {
  secureSet(insecNode, "style", "display", "none");
}

function hideFrameCallback(insecFrameset, attr, index) {
  var weights = secureLookup(insecFrameset, "getAttribute")(attr).split(",");
  weights[index] = "0";
  secureLookup(insecFrameset, "setAttribute")(attr, weights.join(","));
}

/*
 * Filter matching
 */

// Tests if some parent of the node is a link matching a filter
function checkLinks(contentType, insecNode) {
  while (insecNode && (secureGet(insecNode, "href") == null || !insecBlockableScheme(insecNode)))
    insecNode = secureGet(insecNode, "parentNode");

  if (insecNode)
    return matchesAny(secureGet(insecNode, "href"), prefs.regexps);
  else
    return null;
}

// Tests if a given URL matches any of the regexps from the list, returns the matching pattern
function matchesAny(location, list) {
  for (i = 0; i < list.length; i++)
    if (list[i].test(location))
      return list[i];

  return null; // if no matches, return null
}

/*
 * Filter management
 */

// Converts a pattern into RegExp and adds it to the list
function addPattern(pattern) {
  var regexp;

  var list = prefs.regexps;
  if (pattern.indexOf("@@") == 0) {
    // Adblock Plus compatible whitelisting
    pattern = pattern.substr(2);
    list = prefs.whitelist;
  }

  if (pattern.charAt(0) == "/" && pattern.charAt(pattern.length - 1) == "/")  // pattern is a regexp already
    regexp = pattern.substr(1, pattern.length - 2);
  else {
    regexp = pattern.replace(/^\*+/,"").replace(/\*+$/,"").replace(/\*+/, "*").replace(/([^\w\*])/g, "\\$1").replace(/\*/g, ".*");
    if (pattern.match(/^https?:\/\//))
      regexp = "^" + regexp;
  }
  try {
    regexp = new RegExp(regexp, "i");
    regexp.origPattern = pattern;
    list.push(regexp);
  } catch(e) {}
}

/*
 * Object tabs
 */

// Creates a tab above/below the new object node
function addObjectTab(insecNode, location, insecWnd) {
  // Prevent readding tabs to elements that already have one
  if (secureGet(insecNode, "nextSibling", "nodeType") == Node.ELEMENT_NODE &&
      secureLookup(insecNode, "nextSibling", "hasAttribute")("AdblockTab"))
    return;

  // Tab dimensions
  var tabWidth = 70;
  var tabHeight = 18;

  // Decide whether to display the tab on top or the bottom of the object
  var offsetTop = 0;
  for (var insecOffsetNode = insecNode; insecOffsetNode; insecOffsetNode = secureGet(insecOffsetNode, "offsetParent"))
    offsetTop += secureGet(insecOffsetNode, "offsetTop");

  var onTop = (offsetTop > 40);

  // Compose tab
  var insecDoc = secureGet(insecNode, "ownerDocument");
  if (!insecDoc)
    return;

  var label = secureLookup(insecDoc, "createElement")("div");
  label.appendChild(secureLookup(insecDoc, "createTextNode")("Adblock"));
  label.style.display = "block";
  label.style.position = "relative";
  label.style.left = -tabWidth + "px";
  label.style.top = (onTop ? -tabHeight + "px" :  "0px");
  label.style.width = (tabWidth - 4) + "px";
  label.style.height = (tabHeight - 2) + "px";
  label.style.borderStyle = "ridge";
  label.style.borderWidth = (onTop ? "2px 2px 0px 2px" : "0px 2px 2px 2px");
  label.style.MozBorderRadiusTopleft = label.style.MozBorderRadiusTopright = (onTop ? "10px" : "0px");
  label.style.MozBorderRadiusBottomleft = label.style.MozBorderRadiusBottomright = (onTop ? "0px" : "10px");
  label.style.backgroundColor = "white";
  label.style.color = "black";
  label.style.cursor = "pointer";
  label.style.fontFamily = "Arial,Helvetica,Sans-serif";
  label.style.fontSize = "12px";
  label.style.fontStyle = "normal";
  label.style.fontVariant = "normal";
  label.style.fontWeight = "normal";
  label.style.letterSpacing = "normal";
  label.style.lineHeight = "normal";
  label.style.textAlign = "center";
  label.style.textDecoration = "none";
  label.style.textIndent = "0px";
  label.style.textTransform = "none";
  label.style.direction = "ltr";

  var tab = secureLookup(insecDoc, "createElement")("div");
  tab.appendChild(label);
  tab.style.display = "block";
  tab.style.position = "relative"
  tab.style.overflow = "visible";
  tab.style.width = "0px";
  tab.style.height = "0px";
  tab.style.left = "0px";
  tab.style.paddingLeft = secureGet(insecNode, "offsetWidth") + "px";
  tab.style.top = (onTop ? -secureGet(insecNode, "offsetHeight") + "px" : "0px");
  tab.style.zIndex = 65535;
  tab.style.MozOpacity = "0.5";

  // Prevent object tab from being added multiple times
  tab.setAttribute("AdblockTab", "true");
  
  // Click event handler
  label.addEventListener("click", function() {
    adblock.openSettingsDialog(insecWnd, location);
  }, false);

  // Insert tab into the document
  var nextSibling = secureGet(insecNode, "nextSibling");
  if (nextSibling)
    secureLookup(insecNode, "parentNode", "insertBefore")(tab, nextSibling);
  else
    secureLookup(insecNode, "parentNode", "appendChild")(tab);
}

/*
 * Utility functions
 */

// Retrieves the main window object for a node or returns null if it isn't possible
function getTopWindow(insecNode) {
  if (secureGet(insecNode, "nodeType") != Node.DOCUMENT_NODE)
    insecNode = secureGet(insecNode, "ownerDocument");

  if (!insecNode || secureGet(insecNode, "nodeType") != Node.DOCUMENT_NODE)
    return null;

  return secureGet(insecNode, "defaultView", "top");
}

function translateTypes(hash) {
  for (var key in hash)
    if (!key.match(/[^A-Z]/) && key in type)
      hash[type[key]] = hash[key];
}

function insecBlockableScheme(insecLoc) {
  var protocol = secureGet(insecLoc, "protocol");
  return (protocol && protocol.replace(/\W/,"").toLowerCase() in blockSchemes);
}

// Sets a timeout, compatible with both nsITimer and nsIScriptableTimer
function createTimer(callback, delay) {
  var timer = Components.classes["@mozilla.org/timer;1"];
  var handler = {
    observe: callback
  };

  if ('nsITimer' in Components.interfaces) {
    timer = timer.createInstance(Components.interfaces.nsITimer);
    timer.init(handler, 300, timer.TYPE_ONE_SHOT);
  }
  else
  {
    timer = timer.createInstance(Components.interfaces.nsIScriptableTimer);
    timer.init(handler, 300, timer.PRIORITY_LOWEST, timer.TYPE_ONE_SHOT);
  }
  return timer;
}

// Makes a blinking border for a list of matching nodes
var flasher = {
  inseclNodes: null,
  count: 0,
  timer: null,

  flash: function(inseclNodes)
  {
    this.stop();
    if (!inseclNodes)
      return;

    this.inseclNodes = inseclNodes;
    this.count = 0;

    this.doFlash();
  },

  doFlash: function()
  {
    if (this.count >= 6)
    {
      this.switchOff();
      this.inseclNodes = null;
      return;
    }

    if (this.count % 2)
      this.switchOff();
    else
      this.switchOn();

    this.count++;

    this.timer = createTimer(function() {flasher.doFlash()}, 300);
  },

  stop: function()
  {
    if (this.inseclNodes != null)
    {
      if (this.timer)
        this.timer.cancel();
      this.switchOff();
      this.inseclNodes = null;
    }
  },

  setOutline: function(value)
  {
    for (var i = 0; i < this.inseclNodes.length; i++) {
      var insecNode = this.inseclNodes[i];
      var insecContentBody = secureGet(insecNode, "contentDocument", "body");
      if (insecContentBody)
        insecNode = insecContentBody;   // for frames

      secureSet(insecNode, "style", "MozOutline", value);
    }
  },

  switchOn: function()
  {
    this.setOutline("#CC0000 dotted 2px");
  },

  switchOff: function() {
    this.setOutline("none");
  }
};
