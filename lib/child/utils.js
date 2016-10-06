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

"use strict";

let {PrivateBrowsingUtils} = Cu.import("resource://gre/modules/PrivateBrowsingUtils.jsm", {});

let {Utils} = require("utils");

/**
 * Retrieves the effective location of a window.
 */
let getWindowLocation = exports.getWindowLocation = function(/**Window*/ window) /**String*/
{
  let result = null;

  // Crazy Thunderbird stuff
  if ("name" in window && window.name == "messagepane")
  {
    try
    {
      let mailWnd = window.QueryInterface(Ci.nsIInterfaceRequestor)
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
        result = mailWnd.currentHeaderData["content-base"].headerValue;
      }
      else if ("currentHeaderData" in mailWnd && "from" in mailWnd.currentHeaderData)
      {
        let emailAddress = Utils.headerParser.extractHeaderAddressMailboxes(mailWnd.currentHeaderData.from.headerValue);
        if (emailAddress)
          result = 'mailto:' + emailAddress.replace(/^[\s"]+/, "").replace(/[\s"]+$/, "").replace(/\s/g, '%20');
      }
    } catch(e) {}
  }

  // Sane branch
  if (!result)
    result = window.location.href;

  // Remove the anchor if any
  let index = result.indexOf("#");
  if (index >= 0)
    result = result.substring(0, index);

  return result;
}

/**
 * Retrieves the frame hierarchy for a window. Returns an array containing
 * the information for all frames, starting with the window itself up to its
 * top-level window. Each entry has a location and a sitekey entry.
 * @return {Array}
 */
let getFrames = exports.getFrames = function(/**Window*/ window)
{
  let frames = [];
  while (window)
  {
    let frame = {
      location: getWindowLocation(window),
      sitekey: null
    };

    let documentElement = window.document && window.document.documentElement;
    if (documentElement)
      frame.sitekey = documentElement.getAttribute("data-adblockkey")

    frames.push(frame);
    window = (window != window.parent ? window.parent : null);
  }

  // URLs like about:blank inherit their security context from upper-level
  // frames, resolve their URLs accordingly.
  for (let i = frames.length - 2; i >= 0; i--)
  {
    let frame = frames[i];
    if (frame.location == "about:blank" || frame.location == "moz-safe-about:blank" ||
        frame.location == "about:srcdoc" ||
        Utils.netUtils.URIChainHasFlags(Utils.makeURI(frame.location), Ci.nsIProtocolHandler.URI_INHERITS_SECURITY_CONTEXT))
    {
      frame.location = frames[i + 1].location;
    }
  }

  return frames;
};

/**
 * Checks whether Private Browsing mode is enabled for a content window.
 * @return {Boolean}
 */
let isPrivate = exports.isPrivate = function(/**Window*/ window)
{
  return PrivateBrowsingUtils.isContentWindowPrivate(window);
};

/**
 * Gets the DOM window associated with a particular request (if any).
 */
let getRequestWindow = exports.getRequestWindow = function(/**nsIChannel*/ channel) /**nsIDOMWindow*/
{
  try
  {
    if (channel.notificationCallbacks)
      return channel.notificationCallbacks.getInterface(Ci.nsILoadContext).associatedWindow;
  } catch(e) {}

  try
  {
    if (channel.loadGroup && channel.loadGroup.notificationCallbacks)
      return channel.loadGroup.notificationCallbacks.getInterface(Ci.nsILoadContext).associatedWindow;
  } catch(e) {}

  return null;
};
