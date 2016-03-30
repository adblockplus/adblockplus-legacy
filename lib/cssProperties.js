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
 * @fileOverview This is merely forwarding messages from the content script to
 * message responder, these will hopefully be received directly soon.
 */

"use strict";

let {port} = require("messaging");
let {onMessage} = require("ext_background");

port.on("cssPropertiesRequest", ({payload, frames}) =>
{
  let result = undefined;

  // HACK: Message responder doesn't care about sender.page but it passes
  // sender.frame to whitelisting.checkWhitelisted(). Instead of converting
  // our frame list into the format used in Chrome we keep it as is, then our
  // whitelisting.checkWhitelisted() implementation won't need to convert it
  // back. We merely have to set frames.url, message responder needs it.
  frames.url = new URL(frames[0].location);
  let sender = {
    page: null,
    frame: frames
  };

  onMessage._dispatch(payload, sender, data => {
    result = data;
  });
  return result;
});
