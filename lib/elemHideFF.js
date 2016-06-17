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

let {port} = require("messaging");
let {ElemHide} = require("elemHide");
let {FilterNotifier} = require("filterNotifier");
let {FilterStorage} = require("filterStorage");
let {Prefs} = require("prefs");
let {Policy} = require("contentPolicy");

FilterNotifier.on("elemhideupdate", () => port.emit("elemhideupdate"));

port.on("getSelectors", () => ElemHide.getSelectors());

port.on("elemhideEnabled", ({frames, isPrivate}) =>
{
  if (!Prefs.enabled)
    return {enabled: false};

  let hit = Policy.isFrameWhitelisted(frames, true);
  if (hit)
  {
    let [frameIndex, contentType, docDomain, thirdParty, location, filter] = hit;
    if (!isPrivate)
      FilterStorage.increaseHitCount(filter);
    return {
      enabled: false,
      contentType, docDomain, thirdParty, location,
      filter: filter.text, filterType: filter.type
    };
  }
  else
    return {enabled: true};
});
