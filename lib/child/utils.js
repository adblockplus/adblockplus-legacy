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

"use strict";

let {PrivateBrowsingUtils} = Cu.import("resource://gre/modules/PrivateBrowsingUtils.jsm", {});

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
      location: window.location.href,
      sitekey: null
    };

    let documentElement = window.document && window.document.documentElement;
    if (documentElement)
      frame.sitekey = documentElement.getAttribute("data-adblockkey")

    frames.push(frame);
    window = (window != window.parent ? window.parent : null);
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
