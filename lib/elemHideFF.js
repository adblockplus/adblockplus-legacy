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

let {Services} = Cu.import("resource://gre/modules/Services.jsm", {});

let {port} = require("messaging");
let {ElemHide} = require("elemHide");
let {FilterNotifier} = require("filterNotifier");
let {FilterStorage} = require("filterStorage");
let {Prefs} = require("prefs");
let {Policy} = require("contentPolicy");
let {Utils} = require("utils");

let isDirty = false;
FilterNotifier.on("elemhideupdate", () =>
{
  // Notify content process asynchronously, only one message per update batch.
  if (!isDirty)
  {
    isDirty = true;
    Utils.runAsync(() => {
      isDirty = false;
      port.emit("elemhideupdate")
    });
  }
});

port.on("getUnconditionalSelectors", () =>
{
  return [
    ElemHide.getUnconditionalSelectors(),
    ElemHide.getUnconditionalFilterKeys()
  ];
});

port.on("getSelectorsForDomain", ([domain, specificOnly]) =>
{
  let type = specificOnly ? ElemHide.SPECIFIC_ONLY : ElemHide.NO_UNCONDITIONAL;
  return ElemHide.getSelectorsForDomain(domain, type, true);
});

port.on("elemhideEnabled", ({frames, isPrivate}) =>
{
  if (!Prefs.enabled || !Policy.isBlockableScheme(frames[0].location))
    return {enabled: false};

  let hit = Policy.isFrameWhitelisted(frames, true);
  if (hit)
  {
    let [frameIndex, contentType, docDomain, thirdParty, location, filter] = hit;
    if (!isPrivate)
      FilterStorage.increaseHitCount(filter);
    return {
      enabled: contentType == "GENERICHIDE",
      contentType, docDomain, thirdParty, location,
      filter: filter.text, filterType: filter.type
    };
  }

  return {enabled: true};
});

port.on("registerElemHideHit", ({key, frames, isPrivate}) =>
{
  let filter = ElemHide.getFilterByKey(key);
  if (!filter)
    return null;

  if (!isPrivate)
    FilterStorage.increaseHitCount(filter);

  let docDomain;
  try
  {
    docDomain = Utils.unwrapURL(frames[0].location).host;
  }
  catch(e)
  {
    docDomain = null;
  }

  return {
    contentType: "ELEMHIDE",
    docDomain,
    thirdParty: false,
    location: filter.text.replace(/^.*?#/, '#'),
    filter: filter.text,
    filterType: filter.type
  };
});
