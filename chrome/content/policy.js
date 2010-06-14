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
 * Portions created by the Initial Developer are Copyright (C) 2006-2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * @fileOverview Content policy implementation, responsible for blocking things.
 * This file is included from AdblockPlus.js.
 */

XPCOMUtils.defineLazyServiceGetter(this, "effectiveTLD", "@mozilla.org/network/effective-tld-service;1", "nsIEffectiveTLDService");
XPCOMUtils.defineLazyServiceGetter(this, "netUtils", "@mozilla.org/network/util;1", "nsINetUtil");

const ok = Ci.nsIContentPolicy.ACCEPT;
const block = Ci.nsIContentPolicy.REJECT_REQUEST;

/**
 * nsIContentPolicy implementation, this gets triggered whenever the browser needs
 * to load something to decide whether the request should be blocked.
 * @class
 */
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
   * Lists the non-visual content types.
   * @type Object
   */
  nonVisual: null,

  /**
   * Map containing all schemes that should be ignored by content policy.
   * @type Object
   */
  whitelistSchemes: null,

  /**
   * Randomly generated class for collapsed nodes.
   * @type String
   */
  collapsedClass: null,

  init: function() {
    var types = ["OTHER", "SCRIPT", "IMAGE", "STYLESHEET", "OBJECT", "SUBDOCUMENT", "DOCUMENT", "XBL", "PING", "XMLHTTPREQUEST", "OBJECT_SUBREQUEST", "DTD", "FONT", "MEDIA"];

    // type constant by type description and type description by type constant
    this.type = {};
    this.typeDescr = {};
    this.localizedDescr = {};
    var iface = Ci.nsIContentPolicy;
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

    this.nonVisual = {};
    for each (let type in ["SCRIPT", "STYLESHEET", "XBL", "PING", "XMLHTTPREQUEST", "OBJECT_SUBREQUEST", "DTD", "FONT"])
      this.nonVisual[this.type[type]] = true;

    // whitelisted URL schemes
    this.whitelistSchemes = {};
    for each (var scheme in prefs.whitelistschemes.toLowerCase().split(" "))
      this.whitelistSchemes[scheme] = true;

    // Generate class identifier used to collapse node and register corresponding
    // stylesheet.
    this.collapsedClass = "";
    for (let i = 0; i < 20; i++)
      this.collapsedClass +=  String.fromCharCode("a".charCodeAt(0) + Math.random() * 26);

    let collapseStyle = makeURL("data:text/css," +
                                 encodeURIComponent("." + this.collapsedClass +
                                 "{-moz-binding: url(chrome://global/content/bindings/general.xml#foobarbazdummy) !important;}"));
    styleService.loadAndRegisterSheet(collapseStyle, Ci.nsIStyleSheetService.USER_SHEET);
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
    if (contentType == this.type.OBJECT_SUBREQUEST && node instanceof Element)
      node = node.ownerDocument;

    // Fix type for background images
    if (contentType == this.type.IMAGE && node.nodeType == Node.DOCUMENT_NODE)
      contentType = this.type.BACKGROUND;

    // Fix type for objects misrepresented as frames or images
    if (contentType != this.type.OBJECT && (node instanceof Ci.nsIDOMHTMLObjectElement || node instanceof Ci.nsIDOMHTMLEmbedElement))
      contentType = this.type.OBJECT;

    let originWindow = this.getOriginWindow(wnd);
    let wndLocation = originWindow.location.href;
    let docDomain = this.getHostname(wndLocation);
    if (!match && contentType == this.type.ELEMHIDE)
    {
      match = whitelistMatcher.matchesAny(wndLocation, "ELEMHIDE", docDomain, false);
      if (match)
      {
        filterStorage.increaseHitCount(match);

        let data = RequestList.getDataForWindow(wnd);
        data.addNode(wnd.document, contentType, docDomain, false, wndLocation, match);
        return true;
      }

      match = location;
      locationText = match.text.replace(/^.*?#/, '#');
      location = locationText;

      if (!match.isActiveOnDomain(docDomain))
        return true;
    }

    var data = RequestList.getDataForWindow(wnd);

    let thirdParty = (contentType == this.type.ELEMHIDE ? false : this.isThirdParty(location, docDomain));

    if (!match && prefs.enabled) {
      match = whitelistMatcher.matchesAny(locationText, this.typeDescr[contentType] || "", docDomain, thirdParty);
      if (match == null)
        match = blacklistMatcher.matchesAny(locationText, this.typeDescr[contentType] || "", docDomain, thirdParty);

      if (match instanceof BlockingFilter && node instanceof Element && !(contentType in this.nonVisual))
      {
        var prefCollapse = (match.collapse != null ? match.collapse : !prefs.fastcollapse);
        if (collapse || prefCollapse)
          this.schedulePostProcess(node);
      }

      // Track mouse events for objects
      if (!match && contentType == this.type.OBJECT)
      {
        node.addEventListener("mouseover", objectMouseEventHander, true);
        node.addEventListener("mouseout", objectMouseEventHander, true);
      }
    }

    // Store node data
    var nodeData = data.addNode(node, contentType, docDomain, thirdParty, locationText, match);
    if (match)
      filterStorage.increaseHitCount(match);

    return !match || match instanceof WhitelistFilter;
  },

  /**
   * Nodes scheduled for post-processing (might be null).
   * @type Array of Node
   */
  _scheduledNodes: null,

  /**
   * Schedules a node for post-processing.
   * @type Array of Node
   */
  schedulePostProcess: function(node)
  {
    if (this._scheduledNodes)
      this._scheduledNodes.push(node);
    else
    {
      this._scheduledNodes = [node];
      runAsync(this.postProcessNodes, this);
    }
  },

  /**
   * Processes nodes scheduled for post-processing (typically hides them).
   * @type Array of Node
   */
  postProcessNodes: function()
  {
    let nodes = this._scheduledNodes;
    this._scheduledNodes = null;

    for each (let node in nodes)
    {
      // adjust frameset's cols/rows for frames
      let parentNode = node.parentNode;
      if (parentNode && parentNode instanceof Ci.nsIDOMHTMLFrameSetElement)
      {
        let hasCols = (parentNode.cols && parentNode.cols.indexOf(",") > 0);
        let hasRows = (parentNode.rows && parentNode.rows.indexOf(",") > 0);
        if ((hasCols || hasRows) && !(hasCols && hasRows))
        {
          let index = -1;
          for (let frame = node; frame; frame = frame.previousSibling)
            if (frame instanceof Ci.nsIDOMHTMLFrameElement || frame instanceof Ci.nsIDOMHTMLFrameSetElement)
              index++;
      
          let property = (hasCols ? "cols" : "rows");
          let weights = parentNode[property].split(",");
          weights[index] = "0";
          parentNode[property] = weights.join(",");
        }
      }
      else
        node.className += " " + this.collapsedClass;
    }
  },

  /**
   * Checks whether the location's scheme is blockable.
   * @param location  {nsIURI}
   * @return {Boolean}
   */
  isBlockableScheme: function(location)
  {
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
   * If the window doesn't have its own security context (e.g. about:blank or
   * data: URL) walks up the parent chain until a window is found that has a
   * security context.
   */
  getOriginWindow: function(/**Window*/ wnd) /**Window*/
  {
    while (wnd != wnd.parent)
    {
      let uri = abp.makeURL(wnd.location.href);
      if (uri.spec != "about:blank" && uri.spec != "moz-safe-about:blank" &&
          !netUtils.URIChainHasFlags(uri, Ci.nsIProtocolHandler.URI_INHERITS_SECURITY_CONTEXT))
      {
        break;
      }
      wnd = wnd.parent;
    }
    return wnd;
  },

  /**
   * Checks whether a page is whitelisted.
   * @param url {String}
   * @return {Boolean}
   */
  isWhitelisted: function(url)
  {
    return whitelistMatcher.matchesAny(url, "DOCUMENT", this.getHostname(url), false);
  },

  /**
   * Retrieves the location of a window.
   * @param wnd {nsIDOMWindow}
   * @return {String} window location or null on failure
   */
  getWindowLocation: function(wnd)
  {
    if ("name" in wnd && wnd.name == "messagepane")
    {
      // Thunderbird branch
      try
      {
        let mailWnd = wnd.QueryInterface(Ci.nsIInterfaceRequestor)
                         .getInterface(Ci.nsIWebNavigation)
                         .QueryInterface(Ci.nsIDocShellTreeItem)
                         .rootTreeItem
                         .QueryInterface(Ci.nsIInterfaceRequestor)
                         .getInterface(Ci.nsIDOMWindow);

        // Typically we get a wrapped mail window here, need to unwrap
        try
        {
          mailWnd = mailWnd.wrappedJSObject;
        } catch(e) {}
  
        if ("currentHeaderData" in mailWnd && "content-base" in mailWnd.currentHeaderData)
        {
          return mailWnd.currentHeaderData["content-base"].headerValue;
        }
        else if ("currentHeaderData" in mailWnd && "from" in mailWnd.currentHeaderData)
        {
          let emailAddress = headerParser.extractHeaderAddressMailboxes(mailWnd.currentHeaderData.from.headerValue);
          if (emailAddress)
            return 'mailto:' + emailAddress.replace(/^[\s"]+/, "").replace(/[\s"]+$/, "").replace(/\s/g, '%20');
        }
      } catch(e) {}
    }
    else
    {
      // Firefox branch
      return wnd.location.href;
    }
  },

  /**
   * Checks whether the page loaded in a window is whitelisted.
   * @param wnd {nsIDOMWindow}
   * @return {Filter} matching exception rule or null if not whitelisted
   */
  isWindowWhitelisted: function(wnd)
  {
    let location = this.getWindowLocation(wnd);
    if (!location)
      return null;

    return this.isWhitelisted(location);
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
      return effectiveTLD.getBaseDomain(location) != effectiveTLD.getBaseDomainFromHost(docDomain);
    }
    catch (e)
    {
      // EffectiveTLDService throws on IP addresses, just compare the host name
      let host = "";
      try
      {
        host = location.host;
      } catch (e) {}
      return host != docDomain;
    }
  },

  //
  // nsISupports interface implementation
  //

  QueryInterface: abp.QueryInterface,

  //
  // nsIContentPolicy interface implementation
  //

  shouldLoad: function(contentType, contentLocation, requestOrigin, node, mimeTypeGuess, extra)
  {
    // return unless we are initialized
    if (!this.whitelistSchemes)
      return ok;

    if (!node)
      return ok;

    // Ignore standalone objects
    if (contentType == this.type.OBJECT && node.ownerDocument && !/^text\/|[+\/]xml$/.test(node.ownerDocument.contentType))
      return ok;

    var wnd = getWindow(node);
    if (!wnd)
      return ok;

    var location = unwrapURL(contentLocation);

    // Interpret unknown types as "other"
    if (!(contentType in this.typeDescr))
      contentType = this.type.OTHER;

    // if it's not a blockable type or a whitelisted scheme, use the usual policy
    if (contentType == this.type.DOCUMENT || !this.isBlockableScheme(location))
      return ok;

    return (this.processNode(wnd, node, contentType, location, false) ? ok : block);
  },

  shouldProcess: function(contentType, contentLocation, requestOrigin, insecNode, mimeType, extra)
  {
    return ok;
  },

  //
  // nsIChannelEventSink interface implementation
  //

  onChannelRedirect: function(oldChannel, newChannel, flags)
  {
    try {
      let oldLocation = null;
      let newLocation = null;
      try {
        oldLocation = oldChannel.originalURI.spec;
        newLocation = newChannel.URI.spec;
      }
      catch(e2) {}

      if (!oldLocation || !newLocation || oldLocation == newLocation)
        return;

      // Look for the request both in the origin window and in its parent (for frames)
      let contexts = [getRequestWindow(newChannel)];
      if (!contexts[0])
        contexts.pop();
      else if (contexts[0] && contexts[0].parent != contexts[0])
        contexts.push(contexts[0].parent);

      let info = null;
      for each (let context in contexts)
      {
        // Did we record the original request in its own window?
        let data = RequestList.getDataForWindow(context, true);
        if (data)
          info = data.getURLInfo(oldLocation);

        if (info)
        {
          let nodes = info.nodes;
          let node = (nodes.length > 0 ? nodes[nodes.length - 1] : context.document);

          // HACK: NS_BINDING_ABORTED would be proper error code to throw but this will show up in error console (bug 287107)
          if (!this.processNode(context, node, info.type, newChannel.URI))
            throw Cr.NS_BASE_STREAM_WOULD_BLOCK;
          else
            return;
        }
      }
    }
    catch (e if (e != Cr.NS_BASE_STREAM_WOULD_BLOCK))
    {
      // We shouldn't throw exceptions here - this will prevent the redirect.
      dump("Adblock Plus: Unexpected error in policy.onChannelRedirect: " + e + "\n");
    }
  },

  // Reapplies filters to all nodes of the window
  refilterWindowInternal: function(wnd, start) {
    if (wnd.closed)
      return;

    var wndData = RequestList.getDataForWindow(wnd);
    var data = wndData.getAllLocations();
    for (var i = start; i < data.length; i++) {
      if (i - start >= 20) {
        // Allow events to process
        runAsync(this.refilterWindowInternal, this, wnd, i);
        return;
      }

      if (!data[i].filter || data[i].filter instanceof WhitelistFilter)
      {
        let nodes = data[i].clearNodes();
        for each (let node in nodes)
        {
          if (data[i].type == this.type.OBJECT)
          {
            node.removeEventListener("mouseover", objectMouseEventHander, true);
            node.removeEventListener("mouseout", objectMouseEventHander, true);
          }
          this.processNode(wnd, node, data[i].type, makeURL(data[i].location), true);
        }
      }
    }

    wndData.notifyListeners("invalidate", data);
  },

  // Calls refilterWindowInternal delayed to allow events to process
  refilterWindow: function(wnd) {
    runAsync(this.refilterWindowInternal, this, wnd, 0);
  }
};

abp.policy = policy;
