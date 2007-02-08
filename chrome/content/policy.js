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
 * Portions created by the Initial Developer are Copyright (C) 2006-2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Content policy implementation, responsible for blocking things.
 * This file is included from nsAdblockPlus.js.
 */

var type, typeDescr, localizedDescr, whitelistSchemes;
var blockTypes = null;

const ok = Components.interfaces.nsIContentPolicy.ACCEPT;
const block = Components.interfaces.nsIContentPolicy.REJECT_REQUEST;

var policy = {
  allowOnce: null,

  init: function() {
    var types = ["OTHER", "SCRIPT", "IMAGE", "STYLESHEET", "OBJECT", "SUBDOCUMENT", "DOCUMENT"];

    // type constant by type description and type description by type constant
    this.type = type = {};
    typeDescr = {};
    localizedDescr = {};
    blockTypes = {};
    var iface = Components.interfaces.nsIContentPolicy;
    for (var k = 0; k < types.length; k++) {
      var typeName = types[k];
      type[typeName] = iface["TYPE_" + typeName];
      typeDescr[type[typeName]] = typeName;
      localizedDescr[type[typeName]] = abp.getString("type_label_" + typeName.toLowerCase());

      if (types[k] != "DOCUMENT")
        blockTypes[type[typeName]] = 1;
    }
  
    type.LINK = 0xFFFF;
    typeDescr[0xFFFF] = "LINK";
    localizedDescr[0xFFFF] = abp.getString("type_label_link");
  
    type.BACKGROUND = 0xFFFE;
    typeDescr[0xFFFE] = "BACKGROUND";
    localizedDescr[0xFFFE] = abp.getString("type_label_background");

    type.ELEMHIDE = 0xFFFD;
    typeDescr[0xFFFD] = "ELEMHIDE";
    localizedDescr[0xFFFD] = abp.getString("type_label_elemhide");

    // whitelisted URL schemes
    whitelistSchemes = this.translateList(prefs.whitelistschemes);
  },

  // Checks whether a node should be blocked, hides it if necessary, return value false means that the node is blocked
  processNode: function(wnd, node, contentType, location, collapse) {
    var topWnd = wnd.top;
    if (!topWnd || !topWnd.location || !topWnd.location.href)
      return true;

    var match = null;
    if (/^abp:\/*registerhit\/*\?(\d+)$/.test(location) && RegExp.$1 in prefs.elemhidePatterns.keys) {
      match = prefs.elemhidePatterns.keys[RegExp.$1];
      prefs.increaseHitCount(match);
      contentType = type.ELEMHIDE;
      location = match.text.replace(/^.*?#/, '#');
    }

    if (!match) {
      var pageMatch = this.isWindowWhitelisted(topWnd);
      if (pageMatch) {
        prefs.increaseHitCount(pageMatch);
        return true;
      }
    }

    // Fix type for background images
    if (contentType == type.IMAGE && node.nodeType == Node.DOCUMENT_NODE)
      contentType = type.BACKGROUND;

    // Fix type for objects misrepresented as frames or images
    if (contentType != type.OBJECT && node instanceof Components.interfaces.nsIDOMHTMLObjectElement)
      contentType = type.OBJECT;

    var data = DataContainer.getDataForWindow(wnd);

    var objTab = null;
    var linksOk = true;

    if (!match && prefs.enabled) {
      match = prefs.whitePatterns.matchesAny(location, typeDescr[contentType] || "");
      if (match == null)
        match = prefs.filterPatterns.matchesAny(location, typeDescr[contentType] || "");

      if (match)
        prefs.increaseHitCount(match);

      // Check links in parent nodes
      if (node && prefs.linkcheck && node instanceof Components.interfaces.nsIImageLoadingContent)
        linksOk = this.checkLinks(wnd, node);
  
      if (match && match.type != "whitelist" && node) {
        var prefCollapse = ("collapse" in match ? match.collapse : !prefs.fastcollapse);
        if (collapse || prefCollapse)
          wnd.setTimeout(hideNode, 0, node);
      }

      // Show object tabs unless this is a standalone object
      if (!match && prefs.frameobjects && contentType == type.OBJECT &&
          node.ownerDocument && /^text\/|[+\/]xml$/.test(node.ownerDocument.contentType)) {
        // Before adding object tabs always check whether one exist already
        var hasObjectTab = false;
        var loc = data.getLocation(type.OBJECT, location);
        if (loc)
          for (var i = 0; i < loc.nodes.length; i++)
            if (loc.nodes[i] == node && i < loc.nodes.length - 1 && "abpObjTab" in loc.nodes[i+1])
              hasObjectTab = true;

        if (!hasObjectTab) {
          objTab = node.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml", "a");
          objTab.abpObjTab = true;
          wnd.setTimeout(addObjectTab, 0, node, location, objTab, topWnd);
        }
      }
    }

    // Store node data (must set storedLoc parameter so that frames are added immediately when refiltering)
    data.addNode(topWnd, node, contentType, location, match, collapse ? true : undefined, objTab);

    return (match && match.type == "whitelist") || (!match && linksOk);
  },

  // Tests whether some parent of the node is a link matching a filter
  checkLinks: function(wnd, node) {
    while (node) {
      if ("href" in node) {
        var nodeLocation = unwrapURL(node.href);
        if (nodeLocation && this.isBlockableScheme(nodeLocation))
          break;
      }
  
      node = node.parentNode;
    }

    if (node)
      return this.processNode(wnd, node, type.LINK, nodeLocation, false);
    else
      return true;
  },

  // Checks whether the location's scheme is blockable
  isBlockableScheme: function(location) {
    if (location.indexOf(":") < 0)
      return true;

    var scheme = location.replace(/:.*/, "").toUpperCase();
    return !(scheme in whitelistSchemes);
  },

  // Checks whether a page is whitelisted
  isWhitelisted: function(url) {
    return prefs.whitePatternsPage.matchesAny(url, "DOCUMENT");
  },

  // Checks whether the page loaded in a window is whitelisted
  isWindowWhitelisted: function(wnd) {
    if ("name" in wnd && wnd.name == "messagepane") {
      // Thunderbird branch

      try {
        var mailWnd = wnd.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                         .getInterface(Components.interfaces.nsIWebNavigation)
                         .QueryInterface(Components.interfaces.nsIDocShellTreeItem)
                         .rootTreeItem
                         .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                         .getInterface(Components.interfaces.nsIDOMWindow);

        // Typically we get a wrapped mail window here, need to unwrap
        try {
          mailWnd = mailWnd.wrappedJSObject;
        } catch(e) {}
  
        if ("currentHeaderData" in mailWnd && "content-base" in mailWnd.currentHeaderData) {
          var location = unwrapURL(mailWnd.currentHeaderData["content-base"].headerValue);
          return this.isWhitelisted(location);
        }
        else if ("gDBView" in mailWnd) {
          var msgHdr = mailWnd.gDBView.hdrForFirstSelectedMessage;
          var emailAddress = headerParser.extractHeaderAddressMailboxes(null, msgHdr.author);
          if (emailAddress) {
            emailAddress = 'mailto:' + emailAddress.replace(/^[\s"]+/, "").replace(/[\s"]+$/, "").replace(' ', '%20');
            return this.isWhitelisted(emailAddress);
          }
        }
      }
      catch(e) {
      }
    }
    else {
      // Firefox branch

      var topLocation = unwrapURL(wnd.location.href);
      return this.isWhitelisted(topLocation);
    }
    return null;
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

    if (!insecNode)
      return ok;

    // HACKHACK: Pass the node though XPCOM to work around bug 337095
    var node = wrapNode(insecNode);
    var wnd = getWindow(node);
    if (!wnd)
      return ok;

    // Only block in content windows
    var wndType = wnd.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                     .getInterface(Components.interfaces.nsIWebNavigation)
                     .QueryInterface(Components.interfaces.nsIDocShellTreeItem)
                     .itemType;
    if (wndType != Components.interfaces.nsIDocShellTreeItem.typeContent)
      return ok;

    var location = unwrapURL(contentLocation.spec);
    if (location == this.allowOnce) {
      this.allowOnce = null;
      return ok;
    }

    if (/^chrome:\/\/([^\/]+)/.test(location) && "protectchrome" in prefs) {
      // Disallow chrome requests for protected namespaces
      var name = RegExp.$1;
      for (var n = 0; n < prefs.protectchrome.length; n++)
        if (prefs.protectchrome[n] == name)
          return block;
    }

    // if it's not a blockable type or a whitelisted scheme, use the usual policy
    if (!(contentType in blockTypes && this.isBlockableScheme(location)))
      return ok;

    // For frame elements go to their window
    if (contentType == type.SUBDOCUMENT && node.contentWindow) {
      node = node.contentWindow;
      wnd = node;
    }

    return (this.processNode(wnd, node, contentType, location, false) ? ok : block);
  },

  shouldProcess: function(contentType, contentLocation, requestOrigin, insecNode, mimeType, extra) {
    return ok;
  },

  // Reapplies filters to all nodes of the window
  refilterWindowInternal: function(wnd, start) {
    if (wnd.closed)
      return;

    var wndData = abp.getDataForWindow(wnd);
    var data = wndData.getAllLocations();
    for (var i = start; i < data.length; i++) {
      if (i - start >= 20) {
        // Allow events to process
        createTimer(function() {policy.refilterWindowInternal(wnd, i)}, 0);
        return;
      }

      var nodes = data[i].nodes;
      data[i].nodes = [];

      // Clear filter for now
      var origFilter = data[i].filter;
      if (origFilter && origFilter.type == "whitelist")
        origFilter = null;
      else
        data[i].filter = null;

      for (var j = 0; j < nodes.length; j++) {
        if ("abpObjTab" in nodes[j]) {
          // Remove object tabs
          if (nodes[j].parentNode)
            nodes[j].parentNode.removeChild(nodes[j]);
        }
        else {
          if (nodes[j] instanceof Element) {
            if (nodes[j].parentNode) {
              // Reinsert the node to make sure it runs through the filters again
              nodes[j].style.display = '';    // XXX: this might cause problems if we weren't the ones settings display in the first place
              if (nodes[j].nextSibling)
                nodes[j].parentNode.insertBefore(nodes[j], nodes[j].nextSibling);
              else
                nodes[j].parentNode.appendChild(nodes[j]);
            }
          }
          else {
            data[i].nodes.push(nodes[j]);
            data[i].filter = origFilter
          }
        }
      }
    }

    abp.DataContainer.notifyListeners(wnd, "invalidate", data);
  },

  // Calls refilterWindowInternal delayed to allow events to process
  refilterWindow: function(wnd) {
    createTimer(function() {policy.refilterWindowInternal(wnd, 0)}, 0);
  }
};

abp.policy = policy;
