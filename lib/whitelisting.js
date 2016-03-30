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
 * @fileOverview This is a dummy to provide a function needed by message
 * responder.
 */

"use strict";

let {Policy} = require("contentPolicy");
let {RegExpFilter} = require("filterClasses");

// NOTE: The function interface is supposed to be compatible with
// checkWhitelisted in adblockpluschrome. That's why there is a typeMask
// parameter here. However, this parameter is only used to decide whether
// elemhide whitelisting should be considered, so only supported values for this
// parameter are RegExpFilter.typeMap.DOCUMENT and
// RegExpFilter.typeMap.DOCUMENT | RegExpFilter.typeMap.ELEMHIDE.
exports.checkWhitelisted = function(page, frames, typeMask)
{
  let match =
      Policy.isFrameWhitelisted(frames, typeMask & RegExpFilter.typeMap.ELEMHIDE);
  if (match)
  {
    let [frameIndex, matchType, docDomain, thirdParty, location, filter] = match;
    if (matchType == "DOCUMENT" || matchType == "ELEMHIDE")
      return filter;
  }

  return null;
};
