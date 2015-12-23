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

let {Utils} = require("utils");
let {Prefs} = require("prefs");
let {FilterStorage} = require("filterStorage");
let {BlockingFilter, WhitelistFilter, RegExpFilter} = require("filterClasses");
let {defaultMatcher} = require("matcher");
let {ElemHide} = require("elemHide");

/**
 * Public policy checking functions and auxiliary objects
 * @class
 */
var Policy = exports.Policy =
{
  /**
   * Set of explicitly supported content types
   * @type Set.<string>
   */
  contentTypes: new Set([
    "OTHER", "SCRIPT", "IMAGE", "STYLESHEET", "OBJECT", "SUBDOCUMENT", "DOCUMENT",
    "XMLHTTPREQUEST", "OBJECT_SUBREQUEST", "FONT", "MEDIA", "PING", "ELEMHIDE",
    "POPUP", "GENERICHIDE", "GENERICBLOCK"
  ]),

  /**
   * Set of content types that aren't associated with a visual document area
   * @type Set.<string>
   */
  nonVisualTypes: new Set([
    "SCRIPT", "STYLESHEET", "XMLHTTPREQUEST", "OBJECT_SUBREQUEST", "FONT",
    "PING", "ELEMHIDE", "POPUP", "GENERICHIDE", "GENERICBLOCK"
  ]),

  /**
   * Map containing all schemes that should be ignored by content policy.
   * @type Set.<string>
   */
  whitelistSchemes: new Set(),

  /**
   * Called on module startup, initializes various exported properties.
   */
  init: function()
  {
    // whitelisted URL schemes
    for (let scheme of Prefs.whitelistschemes.toLowerCase().split(" "))
      this.whitelistSchemes.add(scheme);

    Utils.addChildMessageListener("AdblockPlus:ShouldAllow", message => this.shouldAllow(message));

    // Generate class identifier used to collapse nodes and register
    // corresponding stylesheet.
    let collapsedClass = "";
    let offset = "a".charCodeAt(0);
    for (let i = 0; i < 20; i++)
      collapsedClass +=  String.fromCharCode(offset + Math.random() * 26);
    Utils.addChildMessageListener("AdblockPlus:GetCollapsedClass", () => collapsedClass);

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
   * @param {Object} data  request data
   * @param {String} data.contentType
   * @param {String} data.location  location of the request, filter key if contentType is ELEMHIDE
   * @param {Object[]} data.frames
   * @param {Boolean} data.isPrivate  true if the request belongs to a private browsing window
   * @return {Object} An object containing properties allow, collapse and hits
   *                  indicating how this request should be handled.
   */
  shouldAllow: function({contentType, location, frames, isPrivate})
  {
    let hits = [];

    function addHit(frameIndex, contentType, docDomain, thirdParty, location, filter)
    {
      if (filter && !isPrivate)
        FilterStorage.increaseHitCount(filter);
      hits.push({
        frameIndex, contentType, docDomain, thirdParty, location,
        filter: filter ? filter.text : null,
        filterType: filter ? filter.type : null
      });
    }

    function response(allow, collapse)
    {
      return {allow, collapse, hits};
    }

    // Ignore whitelisted schemes
    if (!this.isBlockableScheme(location))
      return response(true, false);

    // Treat navigator.sendBeacon() the same as <a ping>, it's essentially the
    // same concept - merely generalized.
    if (contentType == "BEACON")
      contentType = "PING";

    // Interpret unknown types as "other"
    if (!this.contentTypes.has(contentType))
      contentType = "OTHER";

    let wndLocation = frames[0].location;
    let docDomain = getHostname(wndLocation);
    let match = null;
    let [sitekey, sitekeyFrame] = getSitekey(frames);
    let nogeneric = false;
    if (!match && Prefs.enabled)
    {
      let testSitekey = sitekey;
      let testSitekeyFrame = sitekeyFrame;
      for (let i = 0; i < frames.length; i++)
      {
        let frame = frames[i];
        let testWndLocation = frame.location;
        let parentWndLocation = frames[Math.min(i + 1, frames.length - 1)].location;
        let parentDocDomain = getHostname(parentWndLocation);

        let typeMap = RegExpFilter.typeMap.DOCUMENT;
        if (contentType == "ELEMHIDE")
          typeMap = typeMap | RegExpFilter.typeMap.ELEMHIDE;
        let whitelistMatch = defaultMatcher.matchesAny(testWndLocation, typeMap, parentDocDomain, false, testSitekey);
        if (whitelistMatch instanceof WhitelistFilter)
        {
          let whitelistType = (whitelistMatch.contentType & RegExpFilter.typeMap.DOCUMENT) ? "DOCUMENT" : "ELEMHIDE";
          addHit(i, whitelistType, parentDocDomain, false, testWndLocation,
              whitelistMatch);
          return response(true, false);
        }

        let genericType = (contentType == "ELEMHIDE" ? "GENERICHIDE" : "GENERICBLOCK");
        let nogenericMatch = defaultMatcher.matchesAny(testWndLocation,
            RegExpFilter.typeMap[genericType], parentDocDomain, false, testSitekey);
        if (nogenericMatch instanceof WhitelistFilter)
        {
          nogeneric = true;
          addHit(i, genericType, parentDocDomain, false, testWndLocation,
              nogenericMatch);
        }

        if (frame == testSitekeyFrame)
          [testSitekey, testSitekeyFrame] = getSitekey(frames.slice(i + 1));
      }
    }

    if (!match && contentType == "ELEMHIDE")
    {
      match = ElemHide.getFilterByKey(location);
      location = match.text.replace(/^.*?#/, '#');

      if (!match.isActiveOnDomain(docDomain))
        return response(true, false);

      let exception = ElemHide.getException(match, docDomain);
      if (exception)
      {
        addHit(null, contentType, docDomain, false, location, exception);
        return response(true, false);
      }

      if (nogeneric && match.isGeneric())
        return response(true, false);
    }

    let thirdParty = (contentType == "ELEMHIDE" ? false : isThirdParty(location, docDomain));
    let collapse = false;
    if (!match && Prefs.enabled && RegExpFilter.typeMap.hasOwnProperty(contentType))
    {
      match = defaultMatcher.matchesAny(location, RegExpFilter.typeMap[contentType],
                                        docDomain, thirdParty, sitekey, nogeneric);
      if (match instanceof BlockingFilter && !this.nonVisualTypes.has(contentType))
        collapse = (match.collapse != null ? match.collapse : !Prefs.fastcollapse);
    }
    addHit(null, contentType, docDomain, thirdParty, location, match);

    return response(!match || match instanceof WhitelistFilter, collapse);
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
   * Deletes nodes that were previously stored with a
   * RequestNotifier.storeNodesForEntries() call or similar.
   * @param {string} id  unique ID of the nodes
   */
  deleteNodes: function(id)
  {
    let messageManager = Cc["@mozilla.org/parentprocessmessagemanager;1"]
                           .getService(Ci.nsIMessageBroadcaster);
    messageManager.broadcastAsyncMessage("AdblockPlus:DeleteNodes", id);
  },

  /**
   * Asynchronously re-checks filters for nodes given by an ID previously
   * returned by a RequestNotifier.storeNodesForEntries() call or similar.
   * @param {string} id  unique ID of the nodes
   * @param {RequestEntry} entry
   */
  refilterNodes: function(id, entry)
  {
    let messageManager = Cc["@mozilla.org/parentprocessmessagemanager;1"]
                           .getService(Ci.nsIMessageBroadcaster);
    messageManager.broadcastAsyncMessage("AdblockPlus:RefilterNodes", {
      nodesID: id,
      entry: entry
    });
  }
};
Policy.init();

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
 * Retrieves and validates the sitekey for a frame structure.
 */
function getSitekey(frames)
{
  for (let frame of frames)
  {
    if (frame.sitekey && frame.sitekey.indexOf("_") >= 0)
    {
      let [key, signature] = frame.sitekey.split("_", 2);
      key = key.replace(/=/g, "");

      // Website specifies a key but is the signature valid?
      let uri = Services.io.newURI(frame.location, null, null);
      let host = uri.asciiHost;
      if (uri.port > 0)
        host += ":" + uri.port;
      let params = [
        uri.path.replace(/#.*/, ""),  // REQUEST_URI
        host,                         // HTTP_HOST
        Utils.httpProtocol.userAgent  // HTTP_USER_AGENT
      ];
      if (Utils.verifySignature(key, signature, params.join("\0")))
        return [key, frame];
    }
  }

  return [null, null];
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
