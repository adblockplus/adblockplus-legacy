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

    return abp;
  },

  // nsISupports interface implementation
  QueryInterface: function(iid) {
    if (!iid.equals(Components.interfaces.nsISupports) &&
        !iid.equals(Components.interfaces.nsIFactory)) {

      if (!iid.equals(Components.interfaces.nsIClassInfo))
        dump("Adblock Plus: factory.QI to an unknown interface: " + iid + "\n");

      throw Components.results.NS_ERROR_NO_INTERFACE;
    }

    return this;
  }
}

/*
 * Constants / Globals
 */

var initialized = false;

const Node = Components.interfaces.nsIDOMNode;

var type, typeDescr, localizedDescr, blockTypes, blockSchemes, linkTypes, linkSchemes, baseTypes, baseNames;

const ok = ("ACCEPT" in Components.interfaces.nsIContentPolicy ? Components.interfaces.nsIContentPolicy.ACCEPT : true);
const block = ("REJECT_REQUEST" in Components.interfaces.nsIContentPolicy ? Components.interfaces.nsIContentPolicy.REJECT_REQUEST : false);
const oldStyleAPI = (typeof ok == "boolean");

const windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator);
var lastBrowser = null;
var lastWindow  = null;

var cache = null;

/*
 * Content policy class definition
 */

const abp = {
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

  // nsISupports interface implementation
  QueryInterface: function(iid) {
    if (!iid.equals(Components.interfaces.nsISupports) &&
        !iid.equals(Components.interfaces.nsIContentPolicy)) {

      if (!iid.equals(Components.interfaces.nsIClassInfo) &&
          !iid.equals(Components.interfaces.nsISecurityCheckedComponent))
        dump("Adblock Plus: policy.QI to an unknown interface: " + iid + "\n");

      throw Components.results.NS_ERROR_NO_INTERFACE;
    }

    return this;
  },

  // Custom methods

  // Checks whether a node should be blocked, hides it if necessary, return value false means that the node is blocked
  processNode: function(insecNode, contentType, location, collapse) {
    var insecWnd = getTopWindow(insecNode);
    if (!insecWnd || (!prefs.blocklocalpages && !this.isBlockableScheme(secureGet(insecWnd, "location"))))
      return true;

    if (this.isWhitelisted(secureGet(insecWnd, "location", "href")))
      return true;

    var data = this.getDataForWindow(insecWnd);
    if (!collapse)
      insecNode = elementInterface(contentType, insecNode);

    var match = null;
    var linksOk = true;
    if (prefs.enabled) {
      // Try to use previous results - if there were any
      match = cache.get(location);

      if (typeof match == "undefined") {
        // If we didn't cache the result yet:
        // check whether we want to block the node and store the result
        match = matchesAny(location, prefs.whitelist);

        if (match == null)
          match = matchesAny(location, prefs.regexps);

        cache.put(location, match);
      }

      // Check links in parent nodes
      if (insecNode && prefs.linkcheck && contentType in linkTypes)
        linksOk = checkLinks(insecNode);

      // If the node wasn't blocked we still might want to add a frame to it
      if (!match && prefs.frameobjects
          && (contentType == type.OBJECT || secureGet(insecNode, "nodeName").toLowerCase() == "embed") // objects and raw-embeds
          && location != secureGet(insecNode, "ownerDocument", "defaultView", "location", "href")) // it's not a standalone object
        secureLookup(insecWnd, "setTimeout")(addObjectTab, 0, insecNode, location, insecWnd);
    }

    // Fix type for background images
    if (contentType == type.IMAGE && secureGet(insecNode, "nodeType") == Node.DOCUMENT_NODE)
      contentType = type.BACKGROUND;

    // Store node data
    data.addNode(insecNode, contentType, location, match);

    if (match && !match.isWhite && insecNode) {
      // hide immediately if fastcollapse is off but not base types
      collapse = collapse || !prefs.fastcollapse;
      collapse = collapse && !(contentType in baseTypes || secureGet(insecNode, "nodeName").toLowerCase() in baseNames);
      hideNode(insecNode, insecWnd, collapse);
    }

    return (match && match.isWhite) || (!match && linksOk);
  },

  // Opens preferences dialog for the supplied window and filter suggestion
  openSettingsDialog: function(insecWnd, location, filter) {
    var dlg = windowMediator.getMostRecentWindow("abp:settings");
    if (dlg)
      dlg.focus();
    else {
      var browser = windowMediator.getMostRecentWindow("navigator:browser");
      browser.openDialog("chrome://adblockplus/content/settings.xul", "_blank", "chrome,centerscreen,all", insecWnd, location, filter);
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

  // Checks whether the location object's scheme is blockable
  isBlockableScheme: function(insecLoc) {
    var protocol = secureGet(insecLoc, "protocol");
    return (protocol && protocol.replace(/\W/,"").toLowerCase() in blockSchemes);
  },

  // Checks whether a page is whitelisted
  isWhitelisted: function(url) {
    return matchesAny(url, prefs.whitelist);
  }
};
abp.wrappedJSObject = abp;

/*
 * Core Routines
 */

// Initialization and registration
function init() {
  initialized = true;

  loader.loadSubScript('chrome://adblockplus/content/security.js');
  loader.loadSubScript('chrome://adblockplus/content/utils.js');
  loader.loadSubScript('chrome://adblockplus/content/data.js');
  loader.loadSubScript('chrome://adblockplus/content/prefs.js');
  loader.loadSubScript('chrome://adblockplus/content/synchronizer.js');
  loader.loadSubScript('chrome://adblockplus/content/flasher.js');

  // Filter cache initialization
  cache = new HashTable();
  prefs.addListener(function() {cache.clear()});

  // Variable initialization

  var types = ["OTHER", "SCRIPT", "IMAGE", "STYLESHEET", "OBJECT", "SUBDOCUMENT", "DOCUMENT"];

  // type constant by type description and type description by type constant
  type = {};
  typeDescr = {};
  localizedDescr = {};
  var iface = Components.interfaces.nsIContentPolicy;
  for (var k = 0; k < types.length; k++) {
    var typeName = types[k];
    type[typeName] = typeName in iface ? iface[typeName] : iface["TYPE_" + typeName];
    typeDescr[type[typeName]] = typeName;
    localizedDescr[type[typeName]] = abp.getString("type_label_" + typeName.toLowerCase());
  }

  type.LINK = 0xFFFF;
  typeDescr[0xFFFF] = "LINK";
  localizedDescr[0xFFFF] = abp.getString("type_label_link");

  type.BACKGROUND = 0xFFFE;
  typeDescr[0xFFFE] = "BACKGROUND";
  localizedDescr[0xFFFE] = abp.getString("type_label_background");

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

  // Install sidebar in Mozilla Suite if necessary
  installSidebar();
}

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
function checkLinks(insecNode) {
  while (insecNode && (secureGet(insecNode, "href") == null || !abp.isBlockableScheme(insecNode)))
    insecNode = secureGet(insecNode, "parentNode");

  if (insecNode)
    return abp.processNode(insecNode, type.LINK, secureGet(insecNode, "href"), false);
  else
    return true;
}

// Tests if a given URL matches any of the regexps from the list, returns the matching pattern
function matchesAny(location, list) {
  for (var i = 0; i < list.length; i++)
    if (list[i].test(location))
      return list[i];

  return null; // if no matches, return null
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
    abp.openSettingsDialog(insecWnd, location);
  }, false);

  // Insert tab into the document
  var nextSibling = secureGet(insecNode, "nextSibling");
  if (nextSibling)
    secureLookup(insecNode, "parentNode", "insertBefore")(tab, nextSibling);
  else
    secureLookup(insecNode, "parentNode", "appendChild")(tab);
}
