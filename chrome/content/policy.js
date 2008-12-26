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
 * Portions created by the Initial Developer are Copyright (C) 2006-2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * Content policy implementation, responsible for blocking things.
 * This file is included from nsAdblockPlus.js.
 */

var effectiveTLD = null;
if ("nsIEffectiveTLDService" in Components.interfaces)
{
  effectiveTLD = Components.classes["@mozilla.org/network/effective-tld-service;1"]
                           .getService(Components.interfaces.nsIEffectiveTLDService);
}

const ok = Components.interfaces.nsIContentPolicy.ACCEPT;
const block = Components.interfaces.nsIContentPolicy.REJECT_SERVER;

var policy =
{
  /**
   * Map of content type identifiers by their name.
   * @type Object
   */
  type: null,
  /**
   * Map of content type names by their identifiers (reverse of type map).
   * @type Object
   */
  typeDescr: null,
  /**
   * Map of localized content type names by their identifiers.
   * @type Object
   */
  localizedDescr: null,

  /**
   * Map containing all schemes that should be ignored by content policy.
   * @type Object
   */
  whitelistSchemes: null,

  init: function() {
    var types = ["OTHER", "SCRIPT", "IMAGE", "STYLESHEET", "OBJECT", "SUBDOCUMENT", "DOCUMENT", "XBL", "PING", "XMLHTTPREQUEST", "OBJECT_SUBREQUEST", "DTD", "MEDIA"];

    // type constant by type description and type description by type constant
    this.type = {};
    this.typeDescr = {};
    this.localizedDescr = {};
    var iface = Components.interfaces.nsIContentPolicy;
    for each (let typeName in types)
    {
      if ("TYPE_" + typeName in iface)
      {
        this.type[typeName] = iface["TYPE_" + typeName];
        this.typeDescr[this.type[typeName]] = typeName;
        this.localizedDescr[this.type[typeName]] = abp.getString("type_label_" + typeName.toLowerCase());
      }
    }
  
    this.type.BACKGROUND = 0xFFFE;
    this.typeDescr[0xFFFE] = "BACKGROUND";
    this.localizedDescr[0xFFFE] = abp.getString("type_label_background");

    this.type.ELEMHIDE = 0xFFFD;
    this.typeDescr[0xFFFD] = "ELEMHIDE";
    this.localizedDescr[0xFFFD] = abp.getString("type_label_elemhide");

    // whitelisted URL schemes
    this.whitelistSchemes = {};
    for each (var scheme in prefs.whitelistschemes.toLowerCase().split(" "))
      this.whitelistSchemes[scheme] = true;
  },

  /**
   * Checks whether a node should be blocked, hides it if necessary
   * @param wnd {nsIDOMWindow}
   * @param node {nsIDOMElement}
   * @param contentType {String}
   * @param location {nsIURI}
   * @param collapse {Boolean} true to force hiding of the node
   * @return {Boolean} false if the node is blocked
   */
  processNode: function(wnd, node, contentType, location, collapse) {
    var topWnd = wnd.top;
    if (!topWnd || !topWnd.location || !topWnd.location.href)
      return true;

    var match = null;
    var locationText = location.spec;
    if (!match && prefs.enabled)
    {
      match = this.isWindowWhitelisted(topWnd);
      if (match)
      {
        filterStorage.increaseHitCount(match);
        return true;
      }
    }

    // Data loaded by plugins should be attached to the document
    if ((contentType == this.type.OTHER || contentType == this.type.OBJECT_SUBREQUEST) && node instanceof Element)
      node = node.ownerDocument;

    // Fix type for background images
    if (contentType == this.type.IMAGE && node.nodeType == Node.DOCUMENT_NODE)
      contentType = this.type.BACKGROUND;

    // Fix type for objects misrepresented as frames or images
    if (contentType != this.type.OBJECT && (node instanceof Components.interfaces.nsIDOMHTMLObjectElement || node instanceof Components.interfaces.nsIDOMHTMLEmbedElement))
      contentType = this.type.OBJECT;

    var data = DataContainer.getDataForWindow(wnd);

    var objTab = null;
    let docDomain = this.getHostname(wnd.location.href);
    let thirdParty = this.isThirdParty(location, docDomain);

    if (!match && location.scheme == "chrome" && location.host == "global" && /abphit:(\d+)#/.test(location.path) && RegExp.$1 in elemhide.keys)
    {
      match = elemhide.keys[RegExp.$1];
      contentType = this.type.ELEMHIDE;
      locationText = match.text.replace(/^.*?#/, '#');
    }

    if (!match && prefs.enabled) {
      match = whitelistMatcher.matchesAny(locationText, this.typeDescr[contentType] || "", docDomain, thirdParty);
      if (match == null)
        match = blacklistMatcher.matchesAny(locationText, this.typeDescr[contentType] || "", docDomain, thirdParty);

      if (match instanceof BlockingFilter && node)
      {
        var prefCollapse = (match.collapse != null ? match.collapse : !prefs.fastcollapse);
        if (collapse || prefCollapse)
          wnd.setTimeout(postProcessNode, 0, node);
      }

      // Show object tabs unless this is a standalone object
      if (!match && prefs.frameobjects && contentType == this.type.OBJECT &&
          node.ownerDocument && /^text\/|[+\/]xml$/.test(node.ownerDocument.contentType)) {
        // Before adding object tabs always check whether one exist already
        var hasObjectTab = false;
        var loc = data.getLocation(this.type.OBJECT, locationText);
        if (loc)
          for (var i = 0; i < loc.nodes.length; i++)
            if (loc.nodes[i] == node && i < loc.nodes.length - 1 && "abpObjTab" in loc.nodes[i+1])
              hasObjectTab = true;

        if (!hasObjectTab) {
          objTab = node.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml", "a");
          objTab.abpObjTab = true;
        }
      }
    }

    // Store node data
    var nodeData = data.addNode(topWnd, node, contentType, docDomain, thirdParty, locationText, match, objTab);
    if (match)
      filterStorage.increaseHitCount(match);
    if (objTab)
      wnd.setTimeout(addObjectTab, 0, topWnd, node, nodeData, objTab);

    return !match || match instanceof WhitelistFilter;
  },

  /**
   * Checks whether the location's scheme is blockable.
   * @param location  {nsIURI}
   * @return {Boolean}
   */
  isBlockableScheme: function(location) {
    // HACK: Allow blocking element hiding hits
    if (location.scheme == "chrome" && location.host == "global" && /abphit:(\d+)#/.test(location.path) && RegExp.$1 in elemhide.keys)
      return true;

    return !(location.scheme in this.whitelistSchemes);
  },

  /**
   * Extracts the hostname from a URL (might return null).
   */
  getHostname: function(/**String*/ url) /**String*/
  {
    try
    {
      return unwrapURL(url).host;
    }
    catch(e)
    {
      return null;
    }
  },

  /**
   * Checks whether a page is whitelisted.
   * @param url {String}
   * @return {Boolean}
   */
  isWhitelisted: function(url) {
    return whitelistMatcher.matchesAny(url, "DOCUMENT", this.getHostname(url), false);
  },

  /**
   * Checks whether the page loaded in a window is whitelisted.
   * @param wnd {nsIDOMWindow}
   * @return {Boolean}
   */
  isWindowWhitelisted: function(wnd)
  {
    if ("name" in wnd && wnd.name == "messagepane")
    {
      // Thunderbird branch
      try
      {
        let mailWnd = wnd.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                         .getInterface(Components.interfaces.nsIWebNavigation)
                         .QueryInterface(Components.interfaces.nsIDocShellTreeItem)
                         .rootTreeItem
                         .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                         .getInterface(Components.interfaces.nsIDOMWindow);

        // Typically we get a wrapped mail window here, need to unwrap
        try
        {
          mailWnd = mailWnd.wrappedJSObject;
        } catch(e) {}
  
        if ("currentHeaderData" in mailWnd && "content-base" in mailWnd.currentHeaderData)
        {
          return this.isWhitelisted(mailWnd.currentHeaderData["content-base"].headerValue);
        }
        else if ("gDBView" in mailWnd)
        {
          let msgHdr = mailWnd.gDBView.hdrForFirstSelectedMessage;
          let emailAddress = headerParser.extractHeaderAddressMailboxes(null, msgHdr.author);
          if (emailAddress)
          {
            emailAddress = 'mailto:' + emailAddress.replace(/^[\s"]+/, "").replace(/[\s"]+$/, "").replace(' ', '%20');
            return this.isWhitelisted(emailAddress);
          }
        }
      } catch(e) {}
    }
    else
    {
      // Firefox branch
      return this.isWhitelisted(wnd.location.href);
    }
    return null;
  },

  /**
   * Checks whether the location's origin is different from document's origin.
   */
  isThirdParty: function(/**nsIURI*/location, /**String*/ docDomain) /**Boolean*/
  {
    if (!location || !docDomain)
      return true;

    try 
    {
      if (effectiveTLD)
      {
        try {
          return effectiveTLD.getBaseDomain(location) != effectiveTLD.getBaseDomainFromHost(docDomain);
        }
        catch (e) {
          // EffectiveTLDService throws on IP addresses
          return location.host != docDomain;
        }
      }
      else
      {
        // Stupid fallback algorithm for Gecko 1.8
        return location.host.replace(/.*?((?:[^.]+\.)?[^.]+\.?)$/, "$1") != docDomain.replace(/.*?((?:[^.]+\.)?[^.]+\.?)$/, "$1");
      }
    }
    catch (e2)
    {
      // nsSimpleURL.host will throw, treat those URLs as third-party
      return true;
    }
  },

  // nsIContentPolicy interface implementation
  shouldLoad: function(contentType, contentLocation, requestOrigin, node, mimeTypeGuess, extra) {
    // return unless we are initialized
    if (!this.whitelistSchemes)
      return ok;

    if (!node)
      return ok;

    var wnd = getWindow(node);
    if (!wnd)
      return ok;

    var location = unwrapURL(contentLocation);

    // Only block in content windows (Gecko 1.8 compatibility)
    var wndType = wnd.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                     .getInterface(Components.interfaces.nsIWebNavigation)
                     .QueryInterface(Components.interfaces.nsIDocShellTreeItem)
                     .itemType;
    if (wndType != Components.interfaces.nsIDocShellTreeItem.typeContent && !(location.scheme == "chrome" && location.host == "global" && /abphit:(\d+)#/.test(location.path)))
      return ok;

    // Interpret unknown types as "other"
    if (!(contentType in this.typeDescr))
      contentType = this.type.OTHER;

    // if it's not a blockable type or a whitelisted scheme, use the usual policy
    if (contentType == this.type.DOCUMENT || !this.isBlockableScheme(location))
      return ok;

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

      if (!data[i].filter || data[i].filter instanceof WhitelistFilter) {
        var nodes = data[i].nodes;
        data[i].nodes = [];
        for (var j = 0; j < nodes.length; j++) {
          if ("abpObjTab" in nodes[j]) {
            // Remove object tabs
            if (nodes[j].parentNode)
              nodes[j].parentNode.removeChild(nodes[j]);
          }
          else
            this.processNode(wnd, nodes[j], data[i].type, makeURL(data[i].location), true);
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
