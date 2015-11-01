/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2015 Eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * @fileOverview Content policy implementation, responsible for blocking things.
 */

"use strict";

let {XPCOMUtils} = Cu.import("resource://gre/modules/XPCOMUtils.jsm", {});
let {Services} = Cu.import("resource://gre/modules/Services.jsm", {});
let {PrivateBrowsingUtils} = Cu.import("resource://gre/modules/PrivateBrowsingUtils.jsm", {});

let {Utils} = require("utils");
let {Prefs} = require("prefs");
let {FilterStorage} = require("filterStorage");
let {BlockingFilter, WhitelistFilter, RegExpFilter} = require("filterClasses");
let {defaultMatcher} = require("matcher");
let {objectMouseEventHander} = require("objectTabs");
let {RequestNotifier} = require("requestNotifier");
let {ElemHide} = require("elemHide");

/**
 * Randomly generated class name, to be applied to collapsed nodes.
 */
let collapsedClass = "";

/**
 * Maps numerical content type IDs to strings.
 * @type Map
 */
let types = new Map();

/**
 * Public policy checking functions and auxiliary objects
 * @class
 */
var Policy = exports.Policy =
{
  /**
   * Set of explicitly supported content types
   * @type Set
   */
  contentTypes: new Set([
    "OTHER", "SCRIPT", "IMAGE", "STYLESHEET", "OBJECT", "SUBDOCUMENT", "DOCUMENT",
    "XMLHTTPREQUEST", "OBJECT_SUBREQUEST", "FONT", "MEDIA", "ELEMHIDE", "POPUP",
    "GENERICHIDE", "GENERICBLOCK"
  ]),

  /**
   * Set of content types that aren't associated with a visual document area
   * @type Set
   */
  nonVisualTypes: new Set([
    "SCRIPT", "STYLESHEET", "XMLHTTPREQUEST", "OBJECT_SUBREQUEST", "FONT",
    "ELEMHIDE", "POPUP", "GENERICHIDE", "GENERICBLOCK"
  ]),

  /**
   * Map containing all schemes that should be ignored by content policy.
   * @type Set
   */
  whitelistSchemes: new Set(),

  /**
   * Called on module startup, initializes various exported properties.
   */
  init: function()
  {
    // Populate types map
    let iface = Ci.nsIContentPolicy;
    for (let name in iface)
      if (name.indexOf("TYPE_") == 0 && name != "TYPE_DATAREQUEST")
        types.set(iface[name], name.substr(5));

    // whitelisted URL schemes
    for (let scheme of Prefs.whitelistschemes.toLowerCase().split(" "))
      this.whitelistSchemes.add(scheme);

    // Generate class identifier used to collapse node and register corresponding
    // stylesheet.
    let offset = "a".charCodeAt(0);
    for (let i = 0; i < 20; i++)
      collapsedClass +=  String.fromCharCode(offset + Math.random() * 26);

    let collapseStyle = Services.io.newURI("data:text/css," +
        encodeURIComponent("." + collapsedClass +
        "{-moz-binding: url(chrome://global/content/bindings/general.xml#foobarbazdummy) !important;}"), null, null);
    Utils.styleService.loadAndRegisterSheet(collapseStyle, Ci.nsIStyleSheetService.USER_SHEET);
    onShutdown.add(() =>
    {
      Utils.styleService.unregisterSheet(collapseStyle, Ci.nsIStyleSheetService.USER_SHEET);
    });
  },

  /**
   * Checks whether a node should be blocked, hides it if necessary
   * @param wnd {nsIDOMWindow}
   * @param node {nsIDOMElement}
   * @param contentType {String}
   * @param location {String}
   * @param collapse {Boolean} true to force hiding of the node
   * @return {Boolean} false if the node should be blocked
   */
  processNode: function(wnd, node, contentType, location, collapse)
  {
    let topWnd = wnd.top;
    if (!topWnd || !topWnd.location || !topWnd.location.href)
      return true;

    // Ignore whitelisted schemes
    if (!this.isBlockableScheme(location))
      return true;

    // Interpret unknown types as "other"
    if (!this.contentTypes.has(contentType))
      contentType = "OTHER";

    let originWindow = Utils.getOriginWindow(wnd);
    let wndLocation = originWindow.location.href;
    let docDomain = getHostname(wndLocation);
    let match = null;
    let [sitekey, sitekeyWnd] = getSitekey(wnd);
    let nogeneric = false;

    function cleanWindowLocation(wnd)
    {
      let url = getWindowLocation(wnd);
      let index = url.indexOf("#");
      if (index >= 0)
        url = url.substring(0, index);

      return url;
    }

    function addHit(match)
    {
      if (!PrivateBrowsingUtils.isContentWindowPrivate(wnd))
        FilterStorage.increaseHitCount(match);
    }

    if (!match && Prefs.enabled)
    {
      let testWnd = wnd;
      let testSitekey = sitekey;
      let testSitekeyWnd = sitekeyWnd;
      let parentWndLocation = cleanWindowLocation(testWnd);
      while (true)
      {
        let testWndLocation = parentWndLocation;
        parentWndLocation = (testWnd == testWnd.parent ? testWndLocation : cleanWindowLocation(testWnd.parent));
        let parentDocDomain = getHostname(parentWndLocation);

        let typeMap = RegExpFilter.typeMap.DOCUMENT;
        if (contentType == "ELEMHIDE")
          typeMap = typeMap | RegExpFilter.typeMap.ELEMHIDE;
        let whitelistMatch = defaultMatcher.matchesAny(testWndLocation, typeMap, parentDocDomain, false, testSitekey);
        if (whitelistMatch instanceof WhitelistFilter)
        {
          addHit(whitelistMatch);
          RequestNotifier.addNodeData(testWnd.document, topWnd,
            (whitelistMatch.contentType & RegExpFilter.typeMap.DOCUMENT) ? "DOCUMENT" : "ELEMHIDE",
            parentDocDomain, false, testWndLocation, whitelistMatch);
          return true;
        }

        let genericType = (contentType == "ELEMHIDE" ? "GENERICHIDE" : "GENERICBLOCK");
        let nogenericMatch = defaultMatcher.matchesAny(testWndLocation,
            RegExpFilter.typeMap[genericType], parentDocDomain, false, testSitekey);
        if (nogenericMatch instanceof WhitelistFilter)
        {
          nogeneric = true;

          addHit(nogenericMatch);
          RequestNotifier.addNodeData(testWnd.document, topWnd, genericType,
                                      parentDocDomain, false, testWndLocation,
                                      nogenericMatch);
        }

        if (testWnd.parent == testWnd)
          break;

        if (testWnd == testSitekeyWnd)
          [testSitekey, testSitekeyWnd] = getSitekey(testWnd.parent);
        testWnd = testWnd.parent;
      }
    }

    // Data loaded by plugins should be attached to the document
    if (contentType == "OBJECT_SUBREQUEST" && node instanceof Ci.nsIDOMElement)
      node = node.ownerDocument;

    // Fix type for objects misrepresented as frames or images
    if (contentType != "OBJECT" && (node instanceof Ci.nsIDOMHTMLObjectElement || node instanceof Ci.nsIDOMHTMLEmbedElement))
      contentType = "OBJECT";

    if (!match && contentType == "ELEMHIDE")
    {
      match = location;
      location = match.text.replace(/^.*?#/, '#');

      if (!match.isActiveOnDomain(docDomain))
        return true;

      let exception = ElemHide.getException(match, docDomain);
      if (exception)
      {
        addHit(exception);
        RequestNotifier.addNodeData(node, topWnd, contentType, docDomain, false, location, exception);
        return true;
      }

      if (nogeneric && match.isGeneric())
        return true;
    }

    let thirdParty = (contentType == "ELEMHIDE" ? false : isThirdParty(location, docDomain));

    if (!match && Prefs.enabled && RegExpFilter.typeMap.hasOwnProperty(contentType))
    {
      match = defaultMatcher.matchesAny(location, RegExpFilter.typeMap[contentType],
                                        docDomain, thirdParty, sitekey, nogeneric);
      if (match instanceof BlockingFilter && node.ownerDocument && !this.nonVisualTypes.has(contentType))
      {
        let prefCollapse = (match.collapse != null ? match.collapse : !Prefs.fastcollapse);
        if (collapse || prefCollapse)
          schedulePostProcess(node);
      }

      // Track mouse events for objects
      if (!match && contentType == "OBJECT" && node.nodeType == Ci.nsIDOMNode.ELEMENT_NODE)
      {
        node.addEventListener("mouseover", objectMouseEventHander, true);
        node.addEventListener("mouseout", objectMouseEventHander, true);
      }
    }

    // Store node data
    RequestNotifier.addNodeData(node, topWnd, contentType, docDomain, thirdParty, location, match);
    if (match)
      addHit(match);

    return !match || match instanceof WhitelistFilter;
  },

  /**
   * Checks whether the location's scheme is blockable.
   * @param location  {nsIURI|String}
   * @return {Boolean}
   */
  isBlockableScheme: function(location)
  {
    let scheme;
    if (typeof location == "string")
    {
      let match = /^([\w\-]+):/.exec(location);
      scheme = match ? match[1] : null;
    }
    else
      scheme = location.scheme;
    return !this.whitelistSchemes.has(scheme);
  },

  /**
   * Checks whether a page is whitelisted.
   * @param {String} url
   * @param {String} [parentUrl] location of the parent page
   * @param {String} [sitekey] public key provided on the page
   * @return {Filter} filter that matched the URL or null if not whitelisted
   */
  isWhitelisted: function(url, parentUrl, sitekey)
  {
    if (!url)
      return null;

    // Do not apply exception rules to schemes on our whitelistschemes list.
    if (!this.isBlockableScheme(url))
      return null;

    if (!parentUrl)
      parentUrl = url;

    // Ignore fragment identifier
    let index = url.indexOf("#");
    if (index >= 0)
      url = url.substring(0, index);

    let result = defaultMatcher.matchesAny(url, RegExpFilter.typeMap.DOCUMENT, getHostname(parentUrl), false, sitekey);
    return (result instanceof WhitelistFilter ? result : null);
  },

  /**
   * Checks whether the page loaded in a window is whitelisted for indication in the UI.
   * @param wnd {nsIDOMWindow}
   * @return {Filter} matching exception rule or null if not whitelisted
   */
  isWindowWhitelisted: function(wnd)
  {
    return this.isWhitelisted(getWindowLocation(wnd));
  },

  /**
   * Asynchronously re-checks filters for given nodes.
   * @param {Node[]} nodes
   * @param {RequestEntry} entry
   */
  refilterNodes: function(nodes, entry)
  {
    // Ignore nodes that have been blocked already
    if (entry.filter && !(entry.filter instanceof WhitelistFilter))
      return;

    for (let node of nodes)
      Utils.runAsync(() => refilterNode(node, entry));
  }
};
Policy.init();

/**
 * Actual nsIContentPolicy and nsIChannelEventSink implementation
 * @class
 */
var PolicyImplementation =
{
  classDescription: "Adblock Plus content policy",
  classID: Components.ID("cfeaabe6-1dd1-11b2-a0c6-cb5c268894c9"),
  contractID: "@adblockplus.org/abp/policy;1",
  xpcom_categories: ["content-policy", "net-channel-event-sinks"],

  /**
   * Registers the content policy on startup.
   */
  init: function()
  {
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(this.classID, this.classDescription, this.contractID, this);

    let catMan = Utils.categoryManager;
    for (let category of this.xpcom_categories)
      catMan.addCategoryEntry(category, this.contractID, this.contractID, false, true);

    Services.obs.addObserver(this, "content-document-global-created", true);

    onShutdown.add(() =>
    {
      Services.obs.removeObserver(this, "content-document-global-created");

      for (let category of this.xpcom_categories)
        catMan.deleteCategoryEntry(category, this.contractID, false);

      registrar.unregisterFactory(this.classID, this);
    });
  },

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
    if (!node || contentType == Ci.nsIContentPolicy.TYPE_DOCUMENT)
      return Ci.nsIContentPolicy.ACCEPT;

    // Ignore standalone objects
    if (contentType == Ci.nsIContentPolicy.TYPE_OBJECT && node.ownerDocument && !/^text\/|[+\/]xml$/.test(node.ownerDocument.contentType))
      return Ci.nsIContentPolicy.ACCEPT;

    let wnd = Utils.getWindow(node);
    if (!wnd)
      return Ci.nsIContentPolicy.ACCEPT;

    let location = Utils.unwrapURL(contentLocation);
    let result = Policy.processNode(wnd, node, types.get(contentType), location.spec, false);
    return (result ? Ci.nsIContentPolicy.ACCEPT : Ci.nsIContentPolicy.REJECT_REQUEST);
  },

  shouldProcess: function(contentType, contentLocation, requestOrigin, insecNode, mimeType, extra)
  {
    return Ci.nsIContentPolicy.ACCEPT;
  },

  //
  // nsIObserver interface implementation
  //
  observe: function(subject, topic, data, additional)
  {
    switch (topic)
    {
      case "content-document-global-created":
      {
        if (!(subject instanceof Ci.nsIDOMWindow) || !subject.opener)
          return;

        let uri = additional || subject.location.href;
        if (!Policy.processNode(subject.opener, subject.opener.document, "POPUP", uri, false))
        {
          subject.stop();
          Utils.runAsync(() => subject.close());
        }
        else if (uri == "about:blank")
        {
          // An about:blank pop-up most likely means that a load will be
          // initiated asynchronously. Wait for that.
          Utils.runAsync(() =>
          {
            let channel = subject.QueryInterface(Ci.nsIInterfaceRequestor)
                                 .getInterface(Ci.nsIDocShell)
                                 .QueryInterface(Ci.nsIDocumentLoader)
                                 .documentChannel;
            if (channel)
              this.observe(subject, topic, data, channel.URI.spec);
          });
        }
        break;
      }
    }
  },

  //
  // nsIChannelEventSink interface implementation
  //

  asyncOnChannelRedirect: function(oldChannel, newChannel, flags, callback)
  {
    let result = Cr.NS_OK;
    try
    {
      // nsILoadInfo.contentPolicyType was introduced in Gecko 35, then
      // renamed to nsILoadInfo.externalContentPolicyType in Gecko 44.
      let loadInfo = oldChannel.loadInfo;
      let contentType = ("externalContentPolicyType" in loadInfo ?
          loadInfo.externalContentPolicyType : loadInfo.contentPolicyType);
      if (!contentType)
        return;

      let wnd = Utils.getRequestWindow(newChannel);
      if (!wnd)
        return;

      if (contentType == Ci.nsIContentPolicy.TYPE_DOCUMENT)
      {
        if (wnd.history.length <= 1 && wnd.opener)
        {
          // Special treatment for pop-up windows - this will close the window
          // rather than preventing the redirect. Note that we might not have
          // seen the original channel yet because the redirect happened before
          // the async code in observe() had a chance to run.
          this.observe(wnd, "content-document-global-created", null, oldChannel.URI.spec);
          this.observe(wnd, "content-document-global-created", null, newChannel.URI.spec);
        }
        return;
      }

      if (!Policy.processNode(wnd, wnd.document, types.get(contentType), newChannel.URI.spec, false))
        result = Cr.NS_BINDING_ABORTED;
    }
    catch (e)
    {
      // We shouldn't throw exceptions here - this will prevent the redirect.
      Cu.reportError(e);
    }
    finally
    {
      callback.onRedirectVerifyCallback(result);
    }
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
PolicyImplementation.init();

/**
 * Nodes scheduled for post-processing (might be null).
 * @type Node[]
 */
let scheduledNodes = null;

/**
 * Schedules a node for post-processing.
 */
function schedulePostProcess(/**Element*/ node)
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

  for (let node of nodes)
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
      node.classList.add(collapsedClass);
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
 * Retrieves the sitekey of a window.
 */
function getSitekey(wnd)
{
  let sitekey = null;

  while (true)
  {
    if (wnd.document && wnd.document.documentElement)
    {
      let keydata = wnd.document.documentElement.getAttribute("data-adblockkey");
      if (keydata && keydata.indexOf("_") >= 0)
      {
        let [key, signature] = keydata.split("_", 2);
        key = key.replace(/=/g, "");

        // Website specifies a key but is the signature valid?
        let uri = Services.io.newURI(getWindowLocation(wnd), null, null);
        let host = uri.asciiHost;
        if (uri.port > 0)
          host += ":" + uri.port;
        let params = [
          uri.path.replace(/#.*/, ""),  // REQUEST_URI
          host,                         // HTTP_HOST
          Utils.httpProtocol.userAgent  // HTTP_USER_AGENT
        ];
        if (Utils.verifySignature(key, signature, params.join("\0")))
          return [key, wnd];
      }
    }

    if (wnd === wnd.parent)
      break;

    wnd = wnd.parent;
  }

  return [sitekey, wnd];
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

  // Firefox branch
  return wnd.location.href;
}

/**
 * Checks whether the location's origin is different from document's origin.
 */
function isThirdParty(/**String*/location, /**String*/ docDomain) /**Boolean*/
{
  if (!location || !docDomain)
    return true;

  let uri = Utils.makeURI(location);
  try
  {
    return Utils.effectiveTLD.getBaseDomain(uri) != Utils.effectiveTLD.getBaseDomainFromHost(docDomain);
  }
  catch (e)
  {
    // EffectiveTLDService throws on IP addresses, just compare the host name
    let host = "";
    try
    {
      host = uri.host;
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

  if (entry.type == "OBJECT")
  {
    node.removeEventListener("mouseover", objectMouseEventHander, true);
    node.removeEventListener("mouseout", objectMouseEventHander, true);
  }
  Policy.processNode(wnd, node, entry.type, entry.location, true);
}
