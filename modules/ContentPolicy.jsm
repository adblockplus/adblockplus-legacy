/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

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
const contentTypes = ["OTHER", "SCRIPT", "IMAGE", "STYLESHEET", "OBJECT", "SUBDOCUMENT", "DOCUMENT", "XMLHTTPREQUEST", "OBJECT_SUBREQUEST", "FONT", "MEDIA"];

/**
 * List of content types that aren't associated with a visual document area
 * @type Array of String
 */
const nonVisualTypes = ["SCRIPT", "STYLESHEET", "XMLHTTPREQUEST", "OBJECT_SUBREQUEST", "FONT"];

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
  
    Policy.type.POPUP = 0xFFFE;
    Policy.typeDescr[0xFFFE] = "POPUP";
    Policy.localizedDescr[0xFFFE] = Utils.getString("type_label_popup");

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
    Utils.collapsedClass = "";
    for (let i = 0; i < 20; i++)
      Utils.collapsedClass +=  String.fromCharCode(offset + Math.random() * 26);
  
    let collapseStyle = Utils.makeURI("data:text/css," +
                                      encodeURIComponent("." + Utils.collapsedClass +
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
    Utils.observerService.addObserver(PolicyPrivate, "content-document-global-created", true);

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

    let originWindow = Utils.getOriginWindow(wnd);
    let wndLocation = originWindow.location.href;
    let docDomain = getHostname(wndLocation);
    let match = null;
    if (!match && Prefs.enabled)
    {
      let testWnd = wnd;
      let parentWndLocation = getWindowLocation(testWnd);
      while (true)
      {
        let testWndLocation = parentWndLocation;
        parentWndLocation = (testWnd == testWnd.parent ? testWndLocation : getWindowLocation(testWnd.parent));
        match = Policy.isWhitelisted(testWndLocation, parentWndLocation);

        if (!(match instanceof WhitelistFilter))
        {
          let keydata = (testWnd.document && testWnd.document.documentElement ? testWnd.document.documentElement.getAttribute("data-adblockkey") : null);
          if (keydata && keydata.indexOf("_") >= 0)
          {
            let [key, signature] = keydata.split("_", 2);
            let keyMatch = defaultMatcher.matchesByKey(testWndLocation, key.replace(/=/g, ""), docDomain);
            if (keyMatch && Utils.crypto)
            {
              // Website specifies a key that we know but is the signature valid?
              let uri = Utils.makeURI(testWndLocation);
              let params = [
                uri.path.replace(/#.*/, ""),  // REQUEST_URI
                uri.asciiHost,                // HTTP_HOST
                Utils.httpProtocol.userAgent  // HTTP_USER_AGENT
              ];
              if (Utils.verifySignature(key, signature, params.join("\0")))
                match = keyMatch;
            }
          }
        }

        if (match instanceof WhitelistFilter)
        {
          FilterStorage.increaseHitCount(match);
          RequestNotifier.addNodeData(testWnd.document, topWnd, Policy.type.DOCUMENT, getHostname(parentWndLocation), false, testWndLocation, match);
          return true;
        }

        if (testWnd.parent == testWnd)
          break;
        else
          testWnd = testWnd.parent;
      }
    }

    // Data loaded by plugins should be attached to the document
    if (contentType == Policy.type.OBJECT_SUBREQUEST && node instanceof Ci.nsIDOMElement)
      node = node.ownerDocument;

    // Fix type for objects misrepresented as frames or images
    if (contentType != Policy.type.OBJECT && (node instanceof Ci.nsIDOMHTMLObjectElement || node instanceof Ci.nsIDOMHTMLEmbedElement))
      contentType = Policy.type.OBJECT;

    let locationText = location.spec;
    if (!match && contentType == Policy.type.ELEMHIDE)
    {
      let testWnd = wnd;
      let parentWndLocation = getWindowLocation(testWnd);
      while (true)
      {
        let testWndLocation = parentWndLocation;
        parentWndLocation = (testWnd == testWnd.parent ? testWndLocation : getWindowLocation(testWnd.parent));
        let parentDocDomain = getHostname(parentWndLocation);
        match = defaultMatcher.matchesAny(testWndLocation, "ELEMHIDE", parentDocDomain, false);
        if (match instanceof WhitelistFilter)
        {
          FilterStorage.increaseHitCount(match);
          RequestNotifier.addNodeData(testWnd.document, topWnd, contentType, parentDocDomain, false, testWndLocation, match);
          return true;
        }

        if (testWnd.parent == testWnd)
          break;
        else
          testWnd = testWnd.parent;
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
      if (match instanceof BlockingFilter && node.ownerDocument && !(contentType in Policy.nonVisual))
      {
        let prefCollapse = (match.collapse != null ? match.collapse : !Prefs.fastcollapse);
        if (collapse || prefCollapse)
          Utils.schedulePostProcess(node);
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
   * @param {String} url
   * @param {String} [parentUrl] location of the parent page
   * @return {Filter} filter that matched the URL or null if not whitelisted
   */
  isWhitelisted: function(url, parentUrl)
  {
    // Do not apply exception rules to schemes on our whitelistschemes list.
    if (!url || (/^([\w\-]+):/.test(url) && RegExp.$1 in Policy.whitelistSchemes))
      return null;

    if (!parentUrl)
      parentUrl = url;

    // Ignore fragment identifier
    let index = url.indexOf("#");
    if (index >= 0)
      url = url.substring(0, index);

    let result = defaultMatcher.matchesAny(url, "DOCUMENT", getHostname(parentUrl), false);
    return (result instanceof WhitelistFilter ? result : null);
  },

  /**
   * Checks whether the page loaded in a window is whitelisted.
   * @param wnd {nsIDOMWindow}
   * @return {Filter} matching exception rule or null if not whitelisted
   */
  isWindowWhitelisted: function(wnd)
  {
    return Policy.isWhitelisted(getWindowLocation(wnd));
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
      PolicyPrivate.previousRequest = [location, contentType];
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
  observe: function(subject, topic, data, additional)
  {
    switch (topic)
    {
      case "content-document-global-created":
      {
        if (!(subject instanceof Ci.nsIDOMWindow) || !subject.opener)
          return;

        let uri = additional || Utils.makeURI(subject.location.href);
        if (!Policy.processNode(subject.opener, subject.opener.document, Policy.type.POPUP, uri, false))
        {
          subject.stop();
          Utils.runAsync(subject.close, subject);
        }
        else if (uri.spec == "about:blank")
        {
          // An about:blank pop-up most likely means that a load will be
          // initiated synchronously. Set a flag for our "http-on-modify-request"
          // handler.
          PolicyPrivate.expectingPopupLoad = true;
          Utils.runAsync(function()
          {
            PolicyPrivate.expectingPopupLoad = false;
          });
        }
        break;
      }
      case "http-on-modify-request":
      {
        if (!(subject instanceof Ci.nsIHttpChannel))
          return;

        if (Prefs.enabled)
        {
          let match = defaultMatcher.matchesAny(subject.URI.spec, "DONOTTRACK", null, false);
          if (match && match instanceof BlockingFilter)
          {
            FilterStorage.increaseHitCount(match);
            subject.setRequestHeader("DNT", "1", false);

            // Bug 23845 - Some routers are broken and cannot handle DNT header
            // following Connection header. Make sure Connection header is last.
            try
            {
              let connection = subject.getRequestHeader("Connection");
              subject.setRequestHeader("Connection", null, false);
              subject.setRequestHeader("Connection", connection, false);
            } catch(e) {}
          }
        }

        if (PolicyPrivate.previousRequest && subject.URI == PolicyPrivate.previousRequest[0] &&
            subject instanceof Ci.nsIWritablePropertyBag)
        {
          // We just handled a content policy call for this request - associate
          // the data with the channel so that we can find it in case of a redirect.
          subject.setProperty("abpRequestType", PolicyPrivate.previousRequest[1]);
          PolicyPrivate.previousRequest = null;
        }

        if (PolicyPrivate.expectingPopupLoad)
        {
          let wnd = Utils.getRequestWindow(subject);
          if (wnd && wnd.opener && wnd.location.href == "about:blank")
            PolicyPrivate.observe(wnd, "content-document-global-created", null, subject.URI);
        }

        break;
      }
    }
  },

  //
  // nsIChannelEventSink interface implementation
  //

  // Old (Gecko 1.9.x) version
  onChannelRedirect: function(oldChannel, newChannel, flags)
  {
    try
    {
      // Try to retrieve previously stored request data from the channel
      let contentType;
      if (oldChannel instanceof Ci.nsIWritablePropertyBag)
      {
        try
        {
          contentType = oldChannel.getProperty("abpRequestType");
        }
        catch(e)
        {
          // No data attached, ignore this redirect
          return;
        }
      }

      let newLocation = null;
      try
      {
        newLocation = newChannel.URI;
      } catch(e2) {}
      if (!newLocation)
        return;

      let wnd = Utils.getRequestWindow(newChannel);
      if (!wnd)
        return;

      // HACK: NS_BINDING_ABORTED would be proper error code to throw but this will show up in error console (bug 287107)
      if (!Policy.processNode(wnd, wnd.document, contentType, newLocation, false))
        throw Cr.NS_BASE_STREAM_WOULD_BLOCK;
      else
        return;
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
