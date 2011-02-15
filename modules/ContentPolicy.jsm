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
Cu.import(baseURL.spec + "RequestNotifier.jsm");

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

    Utils.observerService.addObserver(PolicyPrivate, "http-on-modify-request", true);

    TimeLine.leave("ContentPolicy.startup() done");
  },

  shutdown: function()
  {
    PolicyPrivate.previousRequest = null;
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
      match = defaultMatcher.matchesAny(wndLocation, "ELEMHIDE", docDomain, false);
      if (match && match instanceof WhitelistFilter)
      {
        FilterStorage.increaseHitCount(match);

        RequestNotifier.addNodeData(wnd.document, topWnd, contentType, docDomain, false, wndLocation, match);
        return true;
      }

      match = location;
      locationText = match.text.replace(/^.*?#/, '#');
      location = locationText;

      if (!match.isActiveOnDomain(docDomain))
        return true;
    }

    let thirdParty = (contentType == Policy.type.ELEMHIDE ? false : isThirdParty(location, docDomain));

    if (!match && Prefs.enabled)
    {
      match = defaultMatcher.matchesAny(locationText, Policy.typeDescr[contentType] || "", docDomain, thirdParty);
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
    RequestNotifier.addNodeData(node, topWnd, contentType, docDomain, thirdParty, locationText, match);
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
   * @return {Filter} filter that matched the URL or null if not whitelisted
   */
  isWhitelisted: function(url)
  {
    // Do not allow whitelisting about:. We get a check for about: during
    // startup, it should be dealt with fast - without checking filters which
    // might load patterns.ini.
    if (/^(moz-safe-)?about:/.test(url))
      return null;

    let result = defaultMatcher.matchesAny(url, "DOCUMENT", getHostname(url), false);
    return (result instanceof WhitelistFilter ? result : null);
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
   * Asynchronously re-checks filters for given nodes.
   */
  refilterNodes: function(/**Node[]*/ nodes, /**RequestEntry*/ entry)
  {
    // Ignore nodes that have been blocked already
    if (entry.filter && !(entry.filter instanceof WhitelistFilter))
      return;

    for each (let node in nodes)
      Utils.runAsync(refilterNode, this, node, entry);
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

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIContentPolicy, Ci.nsIObserver,
    Ci.nsIChannelEventSink, Ci.nsIFactory, Ci.nsISupportsWeakReference]),

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

    let result = Policy.processNode(wnd, node, contentType, location, false);
    if (result)
    {
      // We didn't block this request so we will probably see it again in
      // http-on-modify-request. Keep it so that we can associate it with the
      // channel there - will be needed in case of redirect.
      PolicyPrivate.previousRequest = [wnd, node, contentType, location];
    }
    return (result ? Ci.nsIContentPolicy.ACCEPT : Ci.nsIContentPolicy.REJECT_REQUEST);
  },

  shouldProcess: function(contentType, contentLocation, requestOrigin, insecNode, mimeType, extra)
  {
    return Ci.nsIContentPolicy.ACCEPT;
  },

  //
  // nsIObserver interface implementation
  //
  observe: function(subject, topic, data)
  {
    if (topic != "http-on-modify-request"  || !(subject instanceof Ci.nsIHttpChannel))
      return;

    if (Prefs.enabled)
    {
      let match = defaultMatcher.matchesAny(subject.URI.spec, "DONOTTRACK", null, false);
      if (match && match instanceof BlockingFilter)
      {
        FilterStorage.increaseHitCount(match);
        subject.setRequestHeader("DNT", "1", false);
      }
    }

    if (PolicyPrivate.previousRequest && subject.URI == PolicyPrivate.previousRequest[3] &&
        subject instanceof Ci.nsIWritablePropertyBag)
    {
      // We just handled a content policy call for this request - associate
      // the data with the channel so that we can find it in case of a redirect.
      subject.setProperty("abpRequestData", PolicyPrivate.previousRequest);
      PolicyPrivate.previousRequest = null;
    }
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

      // Try to retrieve previously stored request data from the channel
      let requestData = null;
      try
      {
        if (oldChannel instanceof Ci.nsIWritablePropertyBag)
          requestData = oldChannel.getProperty("abpRequestData");
      }
      catch(e) {}  // Ignore exceptions due to non-existing property
      if (!requestData)
        return;
      oldChannel.deleteProperty("abpRequestData");

      // HACK: NS_BINDING_ABORTED would be proper error code to throw but this will show up in error console (bug 287107)
      requestData[3] = newChannel.URI;
      if (!Policy.processNode(requestData[0], requestData[1], requestData[2], requestData[3], false))
        throw Cr.NS_BASE_STREAM_WOULD_BLOCK;
      else
      {
        // We allowed the request to proceed, associate the data with the new channel
        if (newChannel instanceof Ci.nsIWritablePropertyBag)
          newChannel.getProperty("abpRequestData", requestData);
        return;
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
 * Re-checks filters on an element.
 */
function refilterNode(/**Node*/ node, /**RequestEntry*/ entry)
{
  let wnd = Utils.getWindow(node);
  if (!wnd || wnd.closed)
    return;

  if (entry.type == Policy.type.OBJECT)
  {
    node.removeEventListener("mouseover", objectMouseEventHander, true);
    node.removeEventListener("mouseout", objectMouseEventHander, true);
  }
  Policy.processNode(wnd, node, entry.type, Utils.makeURI(entry.location), true);
}
