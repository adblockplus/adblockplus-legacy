/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2016 Eyeo GmbH
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
let {port} = require("messaging");
let {Prefs} = require("prefs");
let {FilterStorage} = require("filterStorage");
let {BlockingFilter, WhitelistFilter, RegExpFilter} = require("filterClasses");
let {defaultMatcher} = require("matcher");

/**
 * Public policy checking functions and auxiliary objects
 * @class
 */
var Policy = exports.Policy =
{
  /**
   * Map of content types reported by Firefox to the respecitve content types
   * used by Adblock Plus. Other content types are simply mapped to OTHER.
   * @type Map.<string,string>
   */
  contentTypes: new Map(function* ()
  {
    // Treat navigator.sendBeacon() the same as <a ping>,
    // it's essentially the same concept - merely generalized.
    yield ["BEACON", "PING"];

    // Treat <img srcset> and <picture> the same as other images.
    yield ["IMAGESET", "IMAGE"];

    // Treat fetch() the same as XMLHttpRequest,
    // it's essentially the same - merely a more modern API.
    yield ["FETCH", "XMLHTTPREQUEST"];

    // Everything else is mapped to itself
    for (let contentType of ["OTHER", "SCRIPT", "IMAGE", "STYLESHEET", "OBJECT",
                             "SUBDOCUMENT", "DOCUMENT", "XMLHTTPREQUEST",
                             "OBJECT_SUBREQUEST", "FONT", "MEDIA", "PING",
                             "WEBSOCKET", "ELEMHIDE", "POPUP", "GENERICHIDE",
                             "GENERICBLOCK"])
      yield [contentType, contentType];
  }()),

  /**
   * Set of content types that aren't associated with a visual document area
   * @type Set.<string>
   */
  nonVisualTypes: new Set([
    "SCRIPT", "STYLESHEET", "XMLHTTPREQUEST", "OBJECT_SUBREQUEST", "FONT",
    "PING", "WEBSOCKET", "ELEMHIDE", "POPUP", "GENERICHIDE", "GENERICBLOCK"
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

    port.on("shouldAllow", (message, sender) => this.shouldAllow(message));

    // Generate class identifier used to collapse nodes and register
    // corresponding stylesheet.
    let collapsedClass = "";
    let offset = "a".charCodeAt(0);
    for (let i = 0; i < 20; i++)
      collapsedClass +=  String.fromCharCode(offset + Math.random() * 26);
    port.on("getCollapsedClass", (message, sender) => collapsedClass);

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
   * @param {String} data.location  location of the request
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
    if (contentType != "POPUP" && !this.isBlockableScheme(location))
      return response(true, false);

    // Interpret unknown types as "other"
    contentType = this.contentTypes.get(contentType) || "OTHER";

    let nogeneric = false;
    if (Prefs.enabled)
    {
      let whitelistHit =
          this.isFrameWhitelisted(frames, false);
      if (whitelistHit)
      {
        let [frameIndex, matchType, docDomain, thirdParty, location, filter] = whitelistHit;
        addHit(frameIndex, matchType, docDomain, thirdParty, location, filter);
        if (matchType == "DOCUMENT")
          return response(true, false);
        else
          nogeneric = true;
      }
    }

    let match = null;
    let wndLocation = frames[0].location;
    let docDomain = getHostname(wndLocation);
    let [sitekey, sitekeyFrame] = getSitekey(frames);

    let thirdParty = isThirdParty(location, docDomain);
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
   * Checks whether a top-level window is whitelisted.
   * @param {String} url
   *    URL of the document loaded into the window
   * @return {?WhitelistFilter}
   *    exception rule that matched the URL if any
   */
  isWhitelisted: function(url)
  {
    if (!url)
      return null;

    // Do not apply exception rules to schemes on our whitelistschemes list.
    if (!this.isBlockableScheme(url))
      return null;

    // Ignore fragment identifier
    let index = url.indexOf("#");
    if (index >= 0)
      url = url.substring(0, index);

    let result = defaultMatcher.matchesAny(url, RegExpFilter.typeMap.DOCUMENT,
        getHostname(url), false, null);
    return (result instanceof WhitelistFilter ? result : null);
  },

  /**
   * Checks whether a frame is whitelisted.
   * @param {Array} frames
   *    frame structure as returned by getFrames() in child/utils module.
   * @param {boolean} isElemHide
   *    true if element hiding whitelisting should be considered
   * @return {?Array}
   *    An array with the hit parameters: frameIndex, contentType, docDomain,
   *    thirdParty, location, filter. Note that the filter could be a
   *    genericblock/generichide exception rule. If nothing matched null is
   *    returned.
   */
  isFrameWhitelisted: function(frames, isElemHide)
  {
    let [sitekey, sitekeyFrame] = getSitekey(frames);
    let nogenericHit = null;

    let typeMap = RegExpFilter.typeMap.DOCUMENT;
    if (isElemHide)
      typeMap = typeMap | RegExpFilter.typeMap.ELEMHIDE;
    let genericType = (isElemHide ? "GENERICHIDE" : "GENERICBLOCK");

    for (let i = 0; i < frames.length; i++)
    {
      let frame = frames[i];
      let wndLocation = frame.location;
      let parentWndLocation = frames[Math.min(i + 1, frames.length - 1)].location;
      let parentDocDomain = getHostname(parentWndLocation);

      let match = defaultMatcher.matchesAny(wndLocation, typeMap, parentDocDomain, false, sitekey);
      if (match instanceof WhitelistFilter)
      {
        let whitelistType = (match.contentType & RegExpFilter.typeMap.DOCUMENT) ? "DOCUMENT" : "ELEMHIDE";
        return [i, whitelistType, parentDocDomain, false, wndLocation, match];
      }

      if (!nogenericHit)
      {
        match = defaultMatcher.matchesAny(wndLocation,
            RegExpFilter.typeMap[genericType], parentDocDomain, false, sitekey);
        if (match instanceof WhitelistFilter)
          nogenericHit = [i, genericType, parentDocDomain, false, wndLocation, match];
      }

      if (frame == sitekeyFrame)
        [sitekey, sitekeyFrame] = getSitekey(frames.slice(i + 1));
    }

    return nogenericHit;
  },

  /**
   * Deletes nodes that were previously stored with a
   * RequestNotifier.storeNodesForEntries() call or similar.
   * @param {string} id  unique ID of the nodes
   */
  deleteNodes: function(id)
  {
    port.emit("deleteNodes", id);
  },

  /**
   * Asynchronously re-checks filters for nodes given by an ID previously
   * returned by a RequestNotifier.storeNodesForEntries() call or similar.
   * @param {string} id  unique ID of the nodes
   * @param {RequestEntry} entry
   */
  refilterNodes: function(id, entry)
  {
    port.emit("refilterNodes", {
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
