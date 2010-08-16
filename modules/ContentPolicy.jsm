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
 */

var EXPORTED_SYMBOLS = ["Policy"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import(baseURL.spec + "TimeLine.jsm");
Cu.import(baseURL.spec + "Utils.jsm");
Cu.import(baseURL.spec + "Prefs.jsm");
Cu.import(baseURL.spec + "FilterStorage.jsm");
Cu.import(baseURL.spec + "FilterClasses.jsm");
Cu.import(baseURL.spec + "Matcher.jsm");
Cu.import(baseURL.spec + "ObjectTabs.jsm");
Cu.import(baseURL.spec + "RequestList.jsm");

/**
 * List of explicitly supported content types
 * @type Array of String
 */
const contentTypes = ["OTHER", "SCRIPT", "IMAGE", "STYLESHEET", "OBJECT", "SUBDOCUMENT", "DOCUMENT", "XBL", "PING", "XMLHTTPREQUEST", "OBJECT_SUBREQUEST", "DTD", "FONT", "MEDIA"];

/**
 * List of content types that aren't associated with a visual document area
 * @type Array of String
 */
const nonVisualTypes = ["SCRIPT", "STYLESHEET", "XBL", "PING", "XMLHTTPREQUEST", "OBJECT_SUBREQUEST", "DTD", "FONT"];

/**
 * Randomly generated class for collapsed nodes.
 * @type String
 */
let collapsedClass = "";

/**
 * URL of the global stylesheet used to collapse elements.
 * @type nsIURI
 */
let collapseStyle = null;

/**
 * Public policy checking functions and auxiliary objects
 * @class
 */
var Policy =
{
  /**
   * Map of content type identifiers by their name.
   * @type Object
   */
  type: {},

  /**
   * Map of content type names by their identifiers (reverse of type map).
   * @type Object
   */
  typeDescr: {},

  /**
   * Map of localized content type names by their identifiers.
   * @type Object
   */
  localizedDescr: {},

  /**
   * Lists the non-visual content types.
   * @type Object
   */
  nonVisual: {},

  /**
   * Map containing all schemes that should be ignored by content policy.
   * @type Object
   */
  whitelistSchemes: {},

  /**
   * Called on module startup.
   */
  startup: function()
  {
    TimeLine.enter("Entered ContentPolicy.startup()");
  
    // type constant by type description and type description by type constant
    var iface = Ci.nsIContentPolicy;
    for each (let typeName in contentTypes)
    {
      if ("TYPE_" + typeName in iface)
      {
        let id = iface["TYPE_" + typeName];
        Policy.type[typeName] = id;
        Policy.typeDescr[id] = typeName;
        Policy.localizedDescr[id] = Utils.getString("type_label_" + typeName.toLowerCase());
      }
    }
  
    Policy.type.ELEMHIDE = 0xFFFD;
    Policy.typeDescr[0xFFFD] = "ELEMHIDE";
    Policy.localizedDescr[0xFFFD] = Utils.getString("type_label_elemhide");
  
    for each (let type in nonVisualTypes)
      Policy.nonVisual[Policy.type[type]] = true;
  
    // whitelisted URL schemes
    for each (var scheme in Prefs.whitelistschemes.toLowerCase().split(" "))
      Policy.whitelistSchemes[scheme] = true;
  
    TimeLine.log("done initializing types");
  
    // Generate class identifier used to collapse node and register corresponding
    // stylesheet.
    TimeLine.log("registering global stylesheet");
  
    let offset = "a".charCodeAt(0);
    for (let i = 0; i < 20; i++)
      collapsedClass +=  String.fromCharCode(offset + Math.random() * 26);
  
    collapseStyle = Utils.makeURI("data:text/css," +
                                  encodeURIComponent("." + collapsedClass +
                                  "{-moz-binding: url(chrome://global/content/bindings/general.xml#foobarbazdummy) !important;}"));
    Utils.styleService.loadAndRegisterSheet(collapseStyle, Ci.nsIStyleSheetService.USER_SHEET);
    TimeLine.log("done registering stylesheet");
  
    // Register our content policy
    TimeLine.log("registering component");
  
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    try
    {
      registrar.registerFactory(PolicyPrivate.classID, PolicyPrivate.classDescription, PolicyPrivate.contractID, PolicyPrivate);
    }
    catch (e)
    {
      // Don't stop on errors - the factory might already be registered
      Cu.reportError(e);
    }
  
    let catMan = Utils.categoryManager;
    for each (let category in PolicyPrivate.xpcom_categories)
      catMan.addCategoryEntry(category, PolicyPrivate.classDescription, PolicyPrivate.contractID, false, true);
    TimeLine.leave("ContentPolicy.startup() done");
  },

  /**
   * Called on module shutdown.
   */
  shutdown: function(/**Boolean*/ cleanup)
  {
    if (cleanup)
    {
      TimeLine.enter("Entered ContentPolicy.shutdown()");

      let catMan = Utils.categoryManager;
      for each (let category in PolicyPrivate.xpcom_categories)
        catMan.deleteCategoryEntry(category, PolicyPrivate.classDescription, false);

      Utils.runAsync(function()
      {
        // Remove component asynchronously, otherwise nsContentPolicy won't know
        // which component to remove from the list
        let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
        registrar.unregisterFactory(PolicyPrivate.classID, PolicyPrivate);
      });

      TimeLine.log("done unregistering component");

      Utils.styleService.unregisterSheet(collapseStyle, Ci.nsIStyleSheetService.USER_SHEET);
      TimeLine.log("done removing stylesheet");

      collapsedClass = "";
      Policy.type = {};
      Policy.typeDescr = {};
      Policy.localizedDescr = {};
      Policy.nonVisual = {};
      Policy.whitelistSchemes = {};

      TimeLine.leave("ContentPolicy.shutdown() done");
    }
  },

  /**
   * Checks whether a node should be blocked, hides it if necessary
   * @param wnd {nsIDOMWindow}
   * @param node {nsIDOMElement}
   * @param contentType {String}
   * @param location {nsIURI}
   * @param collapse {Boolean} true to force hiding of the node
   * @return {Boolean} false if the node should be blocked
   */
  processNode: function(wnd, node, contentType, location, collapse)
  {
    let topWnd = wnd.top;
    if (!topWnd || !topWnd.location || !topWnd.location.href)
      return true;

    let match = null;
    if (!match && Prefs.enabled)
    {
      match = Policy.isWindowWhitelisted(topWnd);
      if (match)
      {
        FilterStorage.increaseHitCount(match);
        return true;
      }
    }

    // Data loaded by plugins should be attached to the document
    if (contentType == Policy.type.OBJECT_SUBREQUEST && node instanceof Ci.nsIDOMElement)
      node = node.ownerDocument;

    // Fix type for objects misrepresented as frames or images
    if (contentType != Policy.type.OBJECT && (node instanceof Ci.nsIDOMHTMLObjectElement || node instanceof Ci.nsIDOMHTMLEmbedElement))
      contentType = Policy.type.OBJECT;

    let locationText = location.spec;
    let originWindow = getOriginWindow(wnd);
    let wndLocation = originWindow.location.href;
    let docDomain = getHostname(wndLocation);
    if (!match && contentType == Policy.type.ELEMHIDE)
    {
      match = whitelistMatcher.matchesAny(wndLocation, "ELEMHIDE", docDomain, false);
      if (match)
      {
        FilterStorage.increaseHitCount(match);

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

    let data = RequestList.getDataForWindow(wnd);

    let thirdParty = (contentType == Policy.type.ELEMHIDE ? false : isThirdParty(location, docDomain));

    if (!match && Prefs.enabled)
    {
      match = whitelistMatcher.matchesAny(locationText, Policy.typeDescr[contentType] || "", docDomain, thirdParty);
      if (match == null)
        match = blacklistMatcher.matchesAny(locationText, Policy.typeDescr[contentType] || "", docDomain, thirdParty);

      if (match instanceof BlockingFilter && node instanceof Ci.nsIDOMElement && !(contentType in Policy.nonVisual))
      {
        let prefCollapse = (match.collapse != null ? match.collapse : !Prefs.fastcollapse);
        if (collapse || prefCollapse)
          schedulePostProcess(node);
      }

      // Track mouse events for objects
      if (!match && contentType == Policy.type.OBJECT)
      {
        node.addEventListener("mouseover", objectMouseEventHander, true);
        node.addEventListener("mouseout", objectMouseEventHander, true);
      }
    }

    // Store node data
    data.addNode(node, contentType, docDomain, thirdParty, locationText, match);
    if (match)
      FilterStorage.increaseHitCount(match);

    return !match || match instanceof WhitelistFilter;
  },

  /**
   * Checks whether the location's scheme is blockable.
   * @param location  {nsIURI}
   * @return {Boolean}
   */
  isBlockableScheme: function(location)
  {
    return !(location.scheme in Policy.whitelistSchemes);
  },

  /**
   * Checks whether a page is whitelisted.
   * @param url {String}
   * @return {Boolean}
   */
  isWhitelisted: function(url)
  {
    return whitelistMatcher.matchesAny(url, "DOCUMENT", getHostname(url), false);
  },

  /**
   * Checks whether the page loaded in a window is whitelisted.
   * @param wnd {nsIDOMWindow}
   * @return {Filter} matching exception rule or null if not whitelisted
   */
  isWindowWhitelisted: function(wnd)
  {
    let location = getWindowLocation(wnd);
    if (!location)
      return null;

    return Policy.isWhitelisted(location);
  },


  /**
   * Asynchronously re-checks filters for all elements of a window.
   */
  refilterWindow: function(/**Window*/ wnd)
  {
    Utils.runAsync(refilterWindow, this, wnd, 0);
  }
};

/**
 * Private nsIContentPolicy and nsIChannelEventSink implementation
 * @class
 */
var PolicyPrivate =
{
  classDescription: "Adblock Plus content policy",
  classID: Components.ID("cfeaabe6-1dd1-11b2-a0c6-cb5c268894c9"),
  contractID: "@adblockplus.org/abp/policy;1",
  xpcom_categories: ["content-policy", "net-channel-event-sinks"],

  //
  // nsISupports interface implementation
  //

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIContentPolicy, Ci.nsIChannelEventSink, Ci.nsIFactory]),

  //
  // nsIContentPolicy interface implementation
  //

  shouldLoad: function(contentType, contentLocation, requestOrigin, node, mimeTypeGuess, extra)
  {
    // Ignore requests without context and top-level documents
    if (!node || contentType == Policy.type.DOCUMENT)
      return Ci.nsIContentPolicy.ACCEPT;

    // Ignore standalone objects
    if (contentType == Policy.type.OBJECT && node.ownerDocument && !/^text\/|[+\/]xml$/.test(node.ownerDocument.contentType))
      return Ci.nsIContentPolicy.ACCEPT;

    let wnd = Utils.getWindow(node);
    if (!wnd)
      return Ci.nsIContentPolicy.ACCEPT;

    // Ignore whitelisted schemes
    let location = Utils.unwrapURL(contentLocation);
    if (!Policy.isBlockableScheme(location))
      return Ci.nsIContentPolicy.ACCEPT;

    // Interpret unknown types as "other"
    if (!(contentType in Policy.typeDescr))
      contentType = Policy.type.OTHER;

    return (Policy.processNode(wnd, node, contentType, location, false) ? Ci.nsIContentPolicy.ACCEPT : Ci.nsIContentPolicy.REJECT_REQUEST);
  },

  shouldProcess: function(contentType, contentLocation, requestOrigin, insecNode, mimeType, extra)
  {
    return Ci.nsIContentPolicy.ACCEPT;
  },

  //
  // nsIChannelEventSink interface implementation
  //

  // Old (Gecko 1.9.x) version
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
      let contexts = [Utils.getRequestWindow(newChannel)];
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
          if (!Policy.processNode(context, node, info.type, newChannel.URI))
            throw Cr.NS_BASE_STREAM_WOULD_BLOCK;
          else
            return;
        }
      }
    }
    catch (e if (e != Cr.NS_BASE_STREAM_WOULD_BLOCK))
    {
      // We shouldn't throw exceptions here - this will prevent the redirect.
      Cu.reportError(e);
    }
  },

  // New (Gecko 2.0) version
  asyncOnChannelRedirect: function(oldChannel, newChannel, flags, callback)
  {
    this.onChannelRedirect(oldChannel, newChannel, flags);

    // If onChannelRedirect didn't throw an exception indicate success
    callback.onRedirectVerifyCallback(Cr.NS_OK);
  },

  //
  // nsIFactory interface implementation
  //

  createInstance: function(outer, iid)
  {
    if (outer)
      throw Cr.NS_ERROR_NO_AGGREGATION;
    return this.QueryInterface(iid);
  }
};

/**
 * Nodes scheduled for post-processing (might be null).
 * @type Array of Node
 */
let scheduledNodes = null;

/**
 * Schedules a node for post-processing.
 */
function schedulePostProcess(node)
{
  if (scheduledNodes)
    scheduledNodes.push(node);
  else
  {
    scheduledNodes = [node];
    Utils.runAsync(postProcessNodes);
  }
}

/**
 * Processes nodes scheduled for post-processing (typically hides them).
 */
function postProcessNodes()
{
  let nodes = scheduledNodes;
  scheduledNodes = null;

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
      node.className += " " + collapsedClass;
  }
}

/**
 * Extracts the hostname from a URL (might return null).
 */
function getHostname(/**String*/ url) /**String*/
{
  try
  {
    return Utils.unwrapURL(url).host;
  }
  catch(e)
  {
    return null;
  }
}

/**
 * If the window doesn't have its own security context (e.g. about:blank or
 * data: URL) walks up the parent chain until a window is found that has a
 * security context.
 */
function getOriginWindow(/**Window*/ wnd) /**Window*/
{
  while (wnd != wnd.parent)
  {
    let uri = Utils.makeURI(wnd.location.href);
    if (uri.spec != "about:blank" && uri.spec != "moz-safe-about:blank" &&
        !Utils.netUtils.URIChainHasFlags(uri, Ci.nsIProtocolHandler.URI_INHERITS_SECURITY_CONTEXT))
    {
      break;
    }
    wnd = wnd.parent;
  }
  return wnd;
}

/**
 * Retrieves the location of a window.
 * @param wnd {nsIDOMWindow}
 * @return {String} window location or null on failure
 */
function getWindowLocation(wnd)
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
        let emailAddress = Utils.headerParser.extractHeaderAddressMailboxes(mailWnd.currentHeaderData.from.headerValue);
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
}

/**
 * Checks whether the location's origin is different from document's origin.
 */
function isThirdParty(/**nsIURI*/location, /**String*/ docDomain) /**Boolean*/
{
  if (!location || !docDomain)
    return true;

  try
  {
    return Utils.effectiveTLD.getBaseDomain(location) != Utils.effectiveTLD.getBaseDomainFromHost(docDomain);
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
}

/**
 * Re-checks elements in a window starting at a particular index.
 */
function refilterWindow(/**Window*/ wnd, /**Integer*/ start)
{
  if (wnd.closed)
    return;

  var wndData = RequestList.getDataForWindow(wnd);
  var data = wndData.getAllLocations();
  for (var i = start; i < data.length; i++) {
    if (i - start >= 20) {
      // Allow events to process
      Utils.runAsync(refilterWindow, this, wnd, i);
      return;
    }

    if (!data[i].filter || data[i].filter instanceof WhitelistFilter)
    {
      let nodes = data[i].clearNodes();
      for each (let node in nodes)
      {
        if (data[i].type == Policy.type.OBJECT)
        {
          node.removeEventListener("mouseover", objectMouseEventHander, true);
          node.removeEventListener("mouseout", objectMouseEventHander, true);
        }
        Policy.processNode(wnd, node, data[i].type, Utils.makeURI(data[i].location), true);
      }
    }
  }

  wndData.notifyListeners("invalidate", data);
}
