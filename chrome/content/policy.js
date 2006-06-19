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

/*
 * Content policy implementation, responsible for blocking things.
 * This file is included from nsAdblockPlus.js.
 */

var type, typeDescr, localizedDescr, whitelistSchemes, linkTypes, nonCollapsableTypes;
var blockTypes = null;

const ok = Components.interfaces.nsIContentPolicy.ACCEPT;
const block = Components.interfaces.nsIContentPolicy.REJECT_REQUEST;

var policy = {
  init: function() {
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
  
    // blockable content policy types
    blockTypes = this.translateTypeList(prefs.blocktypes);

    // whitelisted URL schemes
    whitelistSchemes = this.translateList(prefs.whitelistschemes);

    // whitelisted URL schemes
    localSchemes = this.translateList(prefs.localschemes);

    // types that should be searched for links
    linkTypes = this.translateTypeList(prefs.linktypes);

    // types that shouldn't be collapsed
    nonCollapsableTypes = this.translateTypeList(prefs.noncollapsabletypes);
  },

  // Checks whether a node should be blocked, hides it if necessary, return value false means that the node is blocked
  processNode: function(node, contentType, location, collapse) {
    var wnd = getWindow(node);
    if (!wnd)
      return true;

    var topWnd = wnd.top;
    if (!topWnd || !topWnd.location || !topWnd.location.href)
      return true;

    var topLocation = unwrapURL(topWnd.location.href);
    var blockable = this.isBlockableScheme(topLocation);
    if (!blockable && prefs.blocklocalpages && this.isLocalScheme(topLocation))
      blockable = true;
    if (!blockable)
      return true;

    var pageMatch = this.isWhitelisted(topLocation);
    if (pageMatch) {
      prefs.increaseHitCount(pageMatch);
      return true;
    }

    var data = DataContainer.getDataForWindow(wnd);

    var match = null;
    var linksOk = true;
    if (prefs.enabled) {
      match = prefs.whitePatterns.matchesAny(location);
      if (match == null)
        match = prefs.filterPatterns.matchesAny(location);

      if (match)
        prefs.increaseHitCount(match);

      if (!(node instanceof Window)) {
        // Check links in parent nodes
        if (node && prefs.linkcheck && this.shouldCheckLinks(contentType))
          linksOk = this.checkLinks(node);
  
        // Show object tabs unless this is a standalone object
        // XXX: We will never recognize objects loading from jar: as standalone!
        if (!match && prefs.frameobjects &&
            contentType == type.OBJECT && wnd.location && location != wnd.location.href)
          wnd.setTimeout(addObjectTab, 0, node, location, topWnd);
      }
    }

    // Fix type for background images
    if (contentType == type.IMAGE && (node instanceof Window || node.nodeType == Node.DOCUMENT_NODE)) {
      contentType = type.BACKGROUND;
      if (node instanceof Window)
        node = node.document;
    }

    // Store node data (must set storedLoc parameter so that frames are added immediately when refiltering)
    data.addNode(topWnd, node, contentType, location, match, collapse ? true : undefined);

    if (match && match.type != "whitelist" && node) {
      // hide immediately if fastcollapse is off but not base types
      collapse = collapse || !prefs.fastcollapse;
      collapse = collapse && !(contentType in nonCollapsableTypes);
      hideNode(node, wnd, collapse);
    }

    return (match && match.type == "whitelist") || (!match && linksOk);
  },

  // Tests whether some parent of the node is a link matching a filter
  checkLinks: function(node) {
    while (node) {
      if ("href" in node) {
        var nodeLocation = unwrapURL(node.href);
        if (nodeLocation && this.isBlockableScheme(nodeLocation))
          break;
      }
  
      node = node.parentNode;
    }

    if (node)
      return this.processNode(node, type.LINK, nodeLocation, false);
    else
      return true;
  },

  // Checks whether the location's scheme is blockable
  isBlockableScheme: function(location) {
    var url = makeURL(location);
    return (url && !(url.scheme.replace(/[^\w\-]/,"").toUpperCase() in whitelistSchemes));
  },

  // Checks whether the location's scheme is local
  isLocalScheme: function(location) {
    var url = makeURL(location);
    return (url && url.scheme.replace(/[^\w\-]/,"").toUpperCase() in localSchemes);
  },

  // Checks whether links should be checked for the specified type
  shouldCheckLinks: function(type) {
    return (type in linkTypes);
  },

  // Checks whether a page is whitelisted
  isWhitelisted: function(url) {
    return prefs.whitePatternsPage.matchesAny(url);
  },

  // Translates a space separated list of types into an object where properties corresponding
  // to the types listed are set to true
  translateTypeList: function(str) {
    var ret = {};
    var types = str.toUpperCase().split(" ");
    for (var i = 0; i < types.length; i++)
      if (types[i] in type)
        ret[type[types[i]]] = true;
    return ret;
  },

  // Translates a space separated list into an object where properties corresponding
  // to list entries are set to true
  translateList: function(str) {
    var ret = {};
    var list = str.toUpperCase().split(" ");
    for (var i = 0; i < list.length; i++)
      ret[list[i]] = true;
    return ret;
  },

  // nsIContentPolicy interface implementation
  shouldLoad: function(contentType, contentLocation, requestOrigin, insecNode, mimeTypeGuess, extra) {
    // return unless we are initialized
    if (!blockTypes)
      return ok;

    // if it's not a blockable type or a whitelisted scheme, use the usual policy
    var location = unwrapURL(contentLocation.spec);
    if (!(contentType in blockTypes && this.isBlockableScheme(location)))
      return ok;

    if (!insecNode)
      return ok;

    // This shouldn't be necessary starting with Gecko 1.8.0.5 (bug 337095)
    var node = new XPCNativeWrapper(insecNode);

    // New API will return the frame element, make it a window
    if (contentType == type.SUBDOCUMENT && node.contentWindow)
      node = node.contentWindow;

    return (this.processNode(node, contentType, location, false) ? ok : block);
  },

  shouldProcess: function(contentType, contentLocation, requestOrigin, insecNode, mimeType, extra) {
    return ok;
  }
};

abp.policy = policy;
